import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useMutation, useLazyQuery } from '@apollo/client/react';
import { LOGIN, SIGNUP } from '@/lib/graphql/mutations';
import { GET_ME } from '@/lib/graphql/queries';
import { apolloClient } from '@/lib/apollo';
import type { User, GetMeResponse, LoginResponse, SignupResponse } from '@/lib/graphql/types';
import { serverConnection } from '@/server';
import { isRelayCapable } from '@/relay';
import { isCommunity, config, isRelaySetupComplete, isRelayMode } from '@/lib/config';
import { isRelayCapable as checkRelayCapable } from '@/relay';
import { handleGraphQL } from '@/server/local-graphql';
import { diagnoseConnection } from '@/lib/connectionDiagnosis';

// Sync auth token to a cross-subdomain cookie so mqtt.homecast.cloud can read it
function syncTokenCookie(token: string | null) {
  try {
    const domain = location.hostname.includes('homecast.cloud')
      ? '; Domain=.homecast.cloud'
      : '';  // localhost — no cross-domain
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    if (token) {
      document.cookie = `hc_token=${encodeURIComponent(token)}${domain}; Path=/${secure}; SameSite=Lax; Max-Age=86400`;
    } else {
      document.cookie = `hc_token=${domain}; Path=/${secure}; SameSite=Lax; Max-Age=0`;
    }
  } catch { /* ignore cookie errors */ }
}

// Wrapper that keeps localStorage and cookie in sync
function setAuthToken(token: string) {
  localStorage.setItem('homecast-token', token);
  syncTokenCookie(token);
}
function clearAuthToken() {
  localStorage.removeItem('homecast-token');
  syncTokenCookie(null);
}

// Check if we might be in a Mac app (before native bridge is fully ready)
function mightBeMacApp(): boolean {
  return !!(window as any).isHomecastMacApp;
}

// Wait for native bridge to be ready (Mac app only)
// Returns true if relay capable, false if timeout or browser mode
async function waitForNativeBridge(maxWaitMs = 2000): Promise<boolean> {
  if (!mightBeMacApp()) {
    // Browser mode - don't wait
    return false;
  }

  // Already ready?
  if (isRelayCapable()) {
    return true;
  }

  // Wait for isRelayCapable to become true
  const startTime = Date.now();
  const checkInterval = 50; // ms

  return new Promise((resolve) => {
    const check = () => {
      if (isRelayCapable()) {
        console.log(`[Homecast] Native bridge ready after ${Date.now() - startTime}ms`);
        resolve(true);
        return;
      }
      if (Date.now() - startTime >= maxWaitMs) {
        console.warn(`[Homecast] Native bridge not ready after ${maxWaitMs}ms, proceeding as browser mode`);
        resolve(false);
        return;
      }
      setTimeout(check, checkInterval);
    };
    check();
  });
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  isAdmin: boolean;
  hasStagingAccess: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  signup: (email: string, password: string, name?: string) => Promise<{ success: boolean; error?: string; message?: string }>;
  logout: () => void;
  resetAndUninstall?: () => Promise<void>;
  switchAccount: (token: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * In Community mode, auth is handled locally via IndexedDB.
 * HA-style: first user creates owner account, then login required.
 */
const CommunityAuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Stable relay detection — wait for bridge once at mount
  const isRelayRef = React.useRef(false);
  const [bridgeReady, setBridgeReady] = React.useState(false);
  React.useEffect(() => {
    waitForNativeBridge(2000).then(result => {
      isRelayRef.current = result;
      setBridgeReady(true);
    });
  }, []);

  const checkAuth = async () => {
    // Relay Mac: always authenticated as owner — but only after first-launch setup.
    if (isRelayRef.current && isRelaySetupComplete()) {
      setUser({
        id: 'relay-owner',
        email: 'owner',
        name: 'Owner',
        isAdmin: true,
        accountType: 'standard',
        stagingAccess: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });
      setIsLoading(false);
      return;
    }

    // Check if relay requires auth — retry up to 5 times (bridge may still be initializing)
    let status: { data?: { authEnabled?: boolean; relayReady?: boolean } } | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        const r = await fetch(config.graphqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationName: 'IsOnboarded', query: '{ isOnboarded }', variables: {} }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`); // 503 = bridge not ready, retry
        status = await r.json();
        if (status?.data?.relayReady) break; // Got a real response
      } catch {
        // Network error or 503 — retry
      }
      if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!status) {
      // Can't reach relay after retries — stay unauthenticated
      setIsLoading(false);
      return;
    }

    const authEnabled = status?.data?.authEnabled ?? false;
    const relayReady = status?.data?.relayReady ?? false;

    if (!relayReady) {
      // Relay not set up yet — stay unauthenticated (Login page will handle)
      setIsLoading(false);
      return;
    }

    if (!authEnabled) {
      // Auth disabled — everyone gets guest access, straight to Dashboard
      // Ensure relay-setup flag is set so the HTTP server gate passes
      if (isRelayRef.current) {
        localStorage.setItem('homecast-relay-setup', 'true');
        localStorage.setItem('homecast-mode', 'relay');
      }
      setUser({
        id: 'guest',
        email: 'guest',
        name: 'Guest',
        isAdmin: false,
        accountType: 'standard',
        stagingAccess: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });
      setIsLoading(false);
      return;
    }

    // Auth enabled: verify token via HTTP
    const token = localStorage.getItem('homecast-token');
    if (token && token !== 'community') {
      try {
        const result = await fetch(config.graphqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ operationName: 'GetMe', query: '{ me { id email name isAdmin accountType } }', variables: {} }),
        }).then(r => r.json());
        const me = result?.data?.me;
        if (me) {
          setUser({
            id: me.id,
            email: me.email || me.name,
            name: me.name,
            isAdmin: me.isAdmin ?? false,
            accountType: me.accountType || 'standard',
            stagingAccess: false,
            createdAt: new Date().toISOString(),
            lastLoginAt: new Date().toISOString(),
          });
        } else {
          clearAuthToken();
        }
      } catch {
        clearAuthToken();
      }
    }
    setIsLoading(false);
  };

  // Wait for bridge detection before checking auth (ensures correct routing)
  useEffect(() => { if (bridgeReady) checkAuth(); }, [bridgeReady]);

  // Activate WS for external browser clients
  useEffect(() => {
    if (user && serverConnection.shouldActivate()) {
      serverConnection.activate();
    }
    return () => { serverConnection.deactivate(); };
  }, [user]);

  // Route GraphQL to Mac's server (works for both relay Mac and external browsers)
  const communityGraphQL = async (operationName: string, variables: Record<string, unknown>) => {
    if (isRelayRef.current) {
      // Relay Mac: call directly (same IndexedDB)
      return handleGraphQL({ operationName, variables });
    }
    // External browser/iOS client: HTTP POST to the relay server
    // Retry on 503 (bridge still initializing)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await fetch(config.graphqlUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ operationName, query: '', variables }),
        });
        console.log(`[communityGraphQL] ${operationName} attempt ${attempt + 1}: HTTP ${res.status}`);
        if (res.ok) return res.json();
        if (res.status === 503 && attempt < 2) {
          await new Promise(r => setTimeout(r, 1000));
          continue;
        }
        const text = await res.text();
        console.log(`[communityGraphQL] ${operationName} error body: ${text.slice(0, 200)}`);
        try { return JSON.parse(text); } catch { return { errors: [{ message: `HTTP ${res.status}: ${text.slice(0, 100)}` }] }; }
      } catch (e) {
        console.log(`[communityGraphQL] ${operationName} attempt ${attempt + 1} failed: ${e}`);
        if (attempt < 2) { await new Promise(r => setTimeout(r, 1000)); continue; }
        throw e;
      }
    }
  };

  const login = async (email: string, password: string) => {
    let result: any;
    try {
      result = await communityGraphQL('Login', { email, password });
    } catch (e) {
      return { success: false, error: `Network error: ${e}` };
    }
    if (!result) return { success: false, error: 'No response from relay' };
    const loginResult = result?.data?.login;
    if (!loginResult) {
      return { success: false, error: `Relay response: ${JSON.stringify(result).slice(0, 500)}` };
    }
    if (loginResult?.success && loginResult.token) {
      setAuthToken(loginResult.token);
      const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
      win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'authSuccess' });
      // Set user directly — don't re-verify via checkAuth which can fail on flaky connections
      setUser({
        id: 'authenticated',
        email: email,
        name: email,
        isAdmin: false,
        accountType: 'standard',
        stagingAccess: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });
      setIsLoading(false);
      // Fetch full user info in background (non-blocking)
      checkAuth();
      return { success: true };
    }
    return { success: false, error: loginResult?.error || 'Login failed' };
  };

  const signup = async (email: string, password: string) => {
    const result = await communityGraphQL('Signup', { email, password }) as any;
    const signupResult = result?.data?.signup;
    if (signupResult?.success && signupResult.token) {
      setAuthToken(signupResult.token);
      const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
      win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'authSuccess' });
      setUser({
        id: 'authenticated',
        email: email,
        name: email,
        isAdmin: false,
        accountType: 'standard',
        stagingAccess: false,
        createdAt: new Date().toISOString(),
        lastLoginAt: new Date().toISOString(),
      });
      setIsLoading(false);
      checkAuth();
      return { success: true, message: signupResult.message };
    }
    return { success: false, error: signupResult?.error || 'Signup failed' };
  };

  const logout = () => {
    // Simple logout — just clear token, keep data
    clearAuthToken();
    setUser(null);
    // Notify Swift so it shows "Change install type" on the login page
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
    win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'logout' });
    window.location.href = '/login';
  };

  // Full reset — wipe all data and return to mode selector (called from Settings)
  const resetAndUninstall = async () => {
    localStorage.clear();
    sessionStorage.clear();
    try {
      const { wipeAllData } = await import('@/server/local-db');
      await wipeAllData();
    } catch {}
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
    if (win.webkit?.messageHandlers?.homecast) {
      win.webkit.messageHandlers.homecast.postMessage({ action: 'resetMode' });
    } else {
      // Full reload clears cached config (relay URL etc)
      window.location.reload();
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        token: localStorage.getItem('homecast-token'),
        isLoading,
        isAuthenticated: !!user,
        isAdmin: !!user?.isAdmin,
        hasStagingAccess: false,
        login,
        signup,
        logout,
        resetAndUninstall,
        switchAccount: async () => {},
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Community mode: local auth via IndexedDB
  if (isCommunity) {
    return <CommunityAuthProvider>{children}</CommunityAuthProvider>;
  }

  return <CloudAuthProvider>{children}</CloudAuthProvider>;
};

const CloudAuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [loginMutation] = useMutation<LoginResponse>(LOGIN);
  const [signupMutation] = useMutation<SignupResponse>(SIGNUP);
  const [getMe] = useLazyQuery<GetMeResponse>(GET_ME, { fetchPolicy: 'network-only' });

  const checkAuth = async () => {
    const token = localStorage.getItem('homecast-token');
    console.log(`[AuthContext] checkAuth: token=${token ? 'exists' : 'missing'}`);
    if (token) {
      // Re-sync the cross-subdomain cookie on every page load. Without this,
      // a user whose token is in localStorage from a prior session (or one
      // who navigated straight here without re-logging-in) has no cookie on
      // .homecast.cloud, and the MQTT Browser on staging.mqtt.homecast.cloud
      // (which reads document.cookie, not localStorage) thinks they're
      // signed out.
      syncTokenCookie(token);
      try {
        const { data, error } = await getMe();
        console.log(`[AuthContext] getMe result: data=${!!data?.me}, error=${!!error}`);
        if (data?.me) {
          setUser(data.me);
          console.log(`[AuthContext] User set: ${data.me.email}`);
        } else if (error) {
          // Check if it's an auth error vs network error
          const gqlErrors = 'graphQLErrors' in error ? (error.graphQLErrors as Array<{ message?: string }>) : [];
          const isAuthError = gqlErrors?.some(
            (e) => e.message?.toLowerCase().includes('authentication')
          );
          if (isAuthError) {
            console.log('Token invalid, clearing session');
            clearAuthToken();
          } else {
            // Network error - keep token, user might be offline
            console.log('Network error during auth check, keeping token');
          }
        }
      } catch (error: any) {
        console.error('Auth check failed:', error);
        // Only clear token on explicit auth errors
        if (error?.message?.toLowerCase().includes('authentication')) {
          clearAuthToken();
        }
      }
    }
    setIsLoading(false);
  };

  useEffect(() => {
    checkAuth();
  }, [getMe]);

  // Listen for storage events (token changes from Mac app)
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'homecast-token') {
        if (e.newValue && !user) {
          // Token added (e.g., restored from keychain)
          console.log('[Homecast] Token detected from native app, checking auth...');
          checkAuth();
        } else if (!e.newValue && user) {
          // Token removed (e.g., signed out from Mac menu)
          console.log('[Homecast] Token removed by native app, clearing session...');
          setUser(null);
          apolloClient.clearStore();
        }
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [user]);

  // Initialize/deactivate server connection based on auth state
  const connectionActivatedRef = React.useRef(false);
  const activatingRef = React.useRef(false);

  useEffect(() => {
    const actuallyConnected = serverConnection.getState().isActive;
    const shouldActivate = user && !actuallyConnected && !activatingRef.current;

    console.log(`[AuthContext] Connection effect: user=${!!user}, isLoading=${isLoading}, actuallyConnected=${actuallyConnected}, activating=${activatingRef.current}`);

    if (shouldActivate) {
      console.log(`[AuthContext] Starting connection activation...`);
      activatingRef.current = true;

      (async () => {
        console.log(`[AuthContext] Waiting for native bridge...`);
        const isRelay = await waitForNativeBridge();
        console.log(`[AuthContext] Native bridge result: isRelay=${isRelay}`);
        const mode = isRelay ? 'relay' : 'browser';
        console.log(`[Homecast] User authenticated, connecting to server (${mode} mode)...`);
        serverConnection.activate();
        connectionActivatedRef.current = true;
        activatingRef.current = false;
      })();
    } else if (!user && !isLoading && connectionActivatedRef.current) {
      console.log('[Homecast] User not authenticated, disconnecting from server...');
      serverConnection.deactivate();
      connectionActivatedRef.current = false;
    }
  }, [user, isLoading]);

  const cleanupTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (cleanupTimeoutRef.current) {
      clearTimeout(cleanupTimeoutRef.current);
      cleanupTimeoutRef.current = null;
    }

    return () => {
      if (connectionActivatedRef.current) {
        cleanupTimeoutRef.current = setTimeout(() => {
          if (connectionActivatedRef.current) {
            console.log('[Homecast] AuthProvider unmounting, disconnecting from server...');
            serverConnection.deactivate();
            connectionActivatedRef.current = false;
          }
        }, 100);
      }
    };
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const { data } = await loginMutation({ variables: { email, password } });
      if (data?.login?.success && data.login.token) {
        setAuthToken(data.login.token);

        const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; token?: string }) => void } } } };
        if (win.webkit?.messageHandlers?.homecast) {
          win.webkit.messageHandlers.homecast.postMessage({ action: 'login', token: data.login.token });
        }

        const { data: meData } = await getMe();
        if (meData?.me) {
          setUser(meData.me);
        }
        return { success: true };
      }
      return { success: false, error: data?.login?.error || 'Login failed' };
    } catch (error: any) {
      console.error('Login error:', error);
      const msg = error.message || '';
      const isNetwork = msg === 'Failed to fetch' || msg === 'Load failed' || msg === 'NetworkError when attempting to reach resource.' || error.networkError;
      if (isNetwork) {
        const diag = await diagnoseConnection();
        if (diag === 'offline') {
          return { success: false, error: 'You appear to be offline. Check your internet connection and try again.' };
        }
        if (diag === 'backend-down') {
          return { success: false, error: 'Homecast is temporarily unavailable. Please try again in a moment.' };
        }
        return { success: false, error: 'Unable to connect. Please try again.' };
      }
      return { success: false, error: msg || 'Login failed' };
    }
  };

  const signup = async (email: string, password: string, name?: string) => {
    try {
      const { data } = await signupMutation({ variables: { email, password, name } });
      if (data?.signup?.success) {
        if (data.signup.token) {
          setAuthToken(data.signup.token);

          const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; token?: string }) => void } } } };
          if (win.webkit?.messageHandlers?.homecast) {
            win.webkit.messageHandlers.homecast.postMessage({ action: 'login', token: data.signup.token });
          }

          const { data: meData } = await getMe();
          if (meData?.me) {
            setUser(meData.me);
          }
        }
        return { success: true, message: data.signup.message || undefined };
      }
      return { success: false, error: data?.signup?.error || 'Signup failed' };
    } catch (error: any) {
      console.error('Signup error:', error);
      const msg = error.message || '';
      const isNetwork = msg === 'Failed to fetch' || msg === 'Load failed' || msg === 'NetworkError when attempting to reach resource.' || error.networkError;
      if (isNetwork) {
        const diag = await diagnoseConnection();
        if (diag === 'offline') {
          return { success: false, error: 'You appear to be offline. Check your internet connection and try again.' };
        }
        if (diag === 'backend-down') {
          return { success: false, error: 'Homecast is temporarily unavailable. Please try again in a moment.' };
        }
        return { success: false, error: 'Unable to connect. Please try again.' };
      }
      return { success: false, error: msg || 'Signup failed' };
    }
  };

  const switchAccount = async (newToken: string) => {
    if (connectionActivatedRef.current) {
      serverConnection.deactivate();
      connectionActivatedRef.current = false;
    }
    activatingRef.current = false;

    setAuthToken(newToken);
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string; token?: string }) => void } } } };
    if (win.webkit?.messageHandlers?.homecast) {
      win.webkit.messageHandlers.homecast.postMessage({ action: 'login', token: newToken });
    }

    await apolloClient.clearStore();
    const { data } = await getMe();
    if (data?.me) {
      setUser(data.me);
    }
  };

  const logout = () => {
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
    if (win.webkit?.messageHandlers?.homecast) {
      win.webkit.messageHandlers.homecast.postMessage({ action: 'logout' });
    }

    clearAuthToken();
    localStorage.removeItem('homecast-selected-home');
    localStorage.removeItem('homecast-selected-room');
    // Hard redirect — full page reload clears Apollo cache and all React state
    window.location.href = '/login';
  };

  const token = typeof window !== 'undefined' ? localStorage.getItem('homecast-token') : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAuthenticated: !!user,
        isAdmin: !!user?.isAdmin,
        hasStagingAccess: !!user?.stagingAccess,
        login,
        signup,
        logout,
        switchAccount,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    // Return safe defaults for components rendered outside AuthProvider (e.g. shared pages)
    return { user: null, token: null, isLoading: false, isAuthenticated: false, isAdmin: false, hasStagingAccess: false } as AuthContextType;
  }
  return context;
};
