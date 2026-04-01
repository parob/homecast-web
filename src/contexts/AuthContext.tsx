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

// Check if we might be in a Mac app (before native bridge is fully ready)
function mightBeMacApp(): boolean {
  const w = window as Window & {
    isHomecastMacApp?: boolean;
    webkit?: { messageHandlers?: { homecast?: unknown } };
  };
  return !!(w.isHomecastMacApp || w.webkit?.messageHandlers?.homecast);
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

    // External browser: check if relay requires auth
    try {
      const status = await fetch(config.graphqlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationName: 'IsOnboarded', query: '{ isOnboarded }', variables: {} }),
      }).then(r => r.json());

      const authEnabled = status?.data?.authEnabled ?? false;
      const relayReady = status?.data?.relayReady ?? false;

      if (!relayReady) {
        // Relay not set up yet — stay unauthenticated (Login page will handle)
        setIsLoading(false);
        return;
      }

      if (!authEnabled) {
        // Auth disabled — everyone gets guest access, straight to Dashboard
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
    } catch {
      // Can't reach relay — stay unauthenticated
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
          localStorage.removeItem('homecast-token');
        }
      } catch {
        localStorage.removeItem('homecast-token');
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
    // External browser: HTTP POST to the Mac's server
    const res = await fetch(config.graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName, query: '', variables }),
    });
    return res.json();
  };

  const login = async (email: string, password: string) => {
    const result = await communityGraphQL('Login', { email, password }) as any;
    const loginResult = result?.data?.login;
    if (loginResult?.success && loginResult.token) {
      localStorage.setItem('homecast-token', loginResult.token);
      // Notify native app to hide back button
      const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
      win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'authSuccess' });
      await checkAuth();
      return { success: true };
    }
    return { success: false, error: loginResult?.error || 'Login failed' };
  };

  const signup = async (email: string, password: string) => {
    const result = await communityGraphQL('Signup', { email, password }) as any;
    const signupResult = result?.data?.signup;
    if (signupResult?.success && signupResult.token) {
      localStorage.setItem('homecast-token', signupResult.token);
      const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
      win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'authSuccess' });
      await checkAuth();
      return { success: true, message: signupResult.message };
    }
    return { success: false, error: signupResult?.error || 'Signup failed' };
  };

  const logout = () => {
    // Simple logout — just clear token, keep data
    localStorage.removeItem('homecast-token');
    setUser(null);
    window.location.href = '/login';
  };

  // Full reset — wipe all data and return to mode selector (called from Settings)
  const resetAndUninstall = async () => {
    localStorage.clear();
    sessionStorage.clear();
    setUser(null);
    try {
      const { wipeAllData } = await import('@/server/local-db');
      await wipeAllData();
    } catch {}
    const win = window as Window & { webkit?: { messageHandlers?: { homecast?: { postMessage: (msg: { action: string }) => void } } } };
    win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'resetMode' });
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
            localStorage.removeItem('homecast-token');
          } else {
            // Network error - keep token, user might be offline
            console.log('Network error during auth check, keeping token');
          }
        }
      } catch (error: any) {
        console.error('Auth check failed:', error);
        // Only clear token on explicit auth errors
        if (error?.message?.toLowerCase().includes('authentication')) {
          localStorage.removeItem('homecast-token');
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
        localStorage.setItem('homecast-token', data.login.token);

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
      return { success: false, error: isNetwork ? 'Unable to connect. Check your internet connection and try again.' : msg || 'Login failed' };
    }
  };

  const signup = async (email: string, password: string, name?: string) => {
    try {
      const { data } = await signupMutation({ variables: { email, password, name } });
      if (data?.signup?.success) {
        if (data.signup.token) {
          localStorage.setItem('homecast-token', data.signup.token);

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
      return { success: false, error: isNetwork ? 'Unable to connect. Check your internet connection and try again.' : msg || 'Signup failed' };
    }
  };

  const switchAccount = async (newToken: string) => {
    if (connectionActivatedRef.current) {
      serverConnection.deactivate();
      connectionActivatedRef.current = false;
    }
    activatingRef.current = false;

    localStorage.setItem('homecast-token', newToken);
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

    localStorage.removeItem('homecast-token');
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
