import { useState, useEffect } from 'react';
import { Link, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Home, Loader2, Shield, Wifi } from 'lucide-react';
import { useMutation } from '@apollo/client/react';
import { RESEND_VERIFICATION_EMAIL } from '@/lib/graphql/mutations';

import { config, isCommunity, getCommunityMode, getRelayAddress, isRelaySetupComplete } from '@/lib/config';

const API_URL = config.apiUrl;

const isInNativeApp = !!(window as any).webkit?.messageHandlers?.homecast;
const isOnRelayMac = !!(window as any).isHomeKitRelayCapable;

function switchMode() {
  localStorage.clear();
  sessionStorage.clear();
  const win = window as any;
  if (win.webkit?.messageHandlers?.homecast) {
    win.webkit.messageHandlers.homecast.postMessage({ action: 'resetMode' });
  } else {
    // Browser client: reload to show setup flow
    window.location.reload();
  }
}

// On the Cloud login screen, switching goes to Community.
const switchFromCloudLabel = isOnRelayMac
  ? 'Switch to Community Mode'
  : 'Switch to community relay';
// On Community screens, switching goes to Cloud.
const switchFromCommunityLabel = 'Switch to Cloud Mode';

const Login = () => {
  const { login, signup, isAuthenticated, isLoading: authLoading, token } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendMutation] = useMutation(RESEND_VERIFICATION_EMAIL);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  // Community mode state
  const [communityChecked, setCommunityChecked] = useState(!isCommunity);
  const [relayNotReady, setRelayNotReady] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  // Setup flow: relay vs client choice
  const [showSetup, setShowSetup] = useState(false);
  const [connectMode, setConnectMode] = useState(false);
  const [relayAddress, setRelayAddress] = useState('http://localhost:5656');
  const [connectError, setConnectError] = useState('');
  const [connecting, setConnecting] = useState(false);

  const isOnRelayMac = !!(window as any).isHomeKitRelayCapable;
  const isNativeApp = !!(window as any).isHomecastMacApp || !!(window as any).isHomecastIOSApp || !!(window as any).isHomecastAndroidApp;

  useEffect(() => {
    if (!isCommunity) return;

    const mode = getCommunityMode();

    // Mac app only: show setup/connect flow on first launch
    // (iOS handles relay connection natively before loading the web app)
    if (!mode && isNativeApp && !!(window as any).isHomecastMacApp) {
      if (!isOnRelayMac) {
        setConnectMode(true); // Non-relay Mac: straight to connect form
      }
      setShowSetup(true);
      setCommunityChecked(true);
      return;
    }

    // Relay mode + setup complete → AuthContext auto-authenticates
    if (mode === 'relay' && isRelaySetupComplete()) {
      setCommunityChecked(true);
      return;
    }

    // Show the form immediately — don't gate the UI on the relay poll.
    // Only flip to the "Relay not ready" screen after several consecutive
    // failures, so a transient network hiccup doesn't bounce the user
    // away from the form they're trying to use.
    setCommunityChecked(true);

    let cancelled = false;
    const checkRelay = async () => {
      let consecutiveFailures = 0;
      while (!cancelled) {
        try {
          const r = await fetch(config.graphqlUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operationName: 'IsOnboarded', query: '{ isOnboarded }', variables: {} }),
            signal: AbortSignal.timeout(4000),
          });
          const result = await r.json();
          const relayReady = result?.data?.relayReady ?? false;
          if (relayReady) {
            setRelayNotReady(false);
            return;
          }
          consecutiveFailures += 1;
        } catch {
          consecutiveFailures += 1;
        }
        if (consecutiveFailures >= 3) setRelayNotReady(true);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    };
    checkRelay();
    return () => { cancelled = true; };
  }, []);

  // Handle "Start Relay"
  const handleStartRelay = () => {
    localStorage.setItem('homecast-mode', 'relay');
    localStorage.setItem('homecast-relay-setup', 'true');
    const win = window as any;
    win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'authSuccess' });
    window.location.href = '/portal';
  };

  // Handle "Connect to Relay" — validate and save address
  const handleConnectToRelay = async () => {
    if (!relayAddress.trim()) {
      setConnectError('Enter the relay URL (e.g. http://192.168.1.50:5656)');
      return;
    }
    setConnecting(true);
    setConnectError('');
    // Normalize: strip trailing slash, ensure protocol
    let url = relayAddress.trim().replace(/\/+$/, '');
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = `http://${url}`;
    }
    // Extract host:port for storage (config expects host:port, not full URL)
    let addr: string;
    try {
      const parsed = new URL(url);
      addr = parsed.port ? `${parsed.hostname}:${parsed.port}` : `${parsed.hostname}:5656`;
    } catch {
      setConnectError('Invalid URL. Use a format like http://192.168.1.50:5656');
      setConnecting(false);
      return;
    }
    try {
      const resp = await fetch(`http://${addr}/health`, { signal: AbortSignal.timeout(5000) });
      const data = await resp.json();
      if (data.status !== 'ok' || data.mode !== 'community') {
        setConnectError('Not a Homecast Community relay');
        setConnecting(false);
        return;
      }
      localStorage.setItem('homecast-mode', 'client');
      localStorage.setItem('homecast-relay-address', addr);
      window.location.reload(); // Reload with new config pointing to relay
    } catch {
      setConnectError('Could not connect. Check the URL and make sure the relay is running.');
      setConnecting(false);
    }
  };

  // OAuth flow detection
  const isOAuthFlow = searchParams.get('oauth_flow') === 'true';
  const oauthParams = searchParams.get('oauth_params');
  const redirectTo = searchParams.get('redirect');

  useEffect(() => {
    if (isAuthenticated && isOAuthFlow && oauthParams && token) {
      const params = new URLSearchParams(oauthParams);
      params.set('response_type', 'code');
      params.set('_token', token);
      window.location.href = `${API_URL}/oauth/authorize?${params.toString()}`;
    }
  }, [isAuthenticated, isOAuthFlow, oauthParams, token]);

  if (authLoading || !communityChecked) {
    return (
      <div className="relative flex min-h-screen items-center justify-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-primary/10" />
        <Loader2 className="relative z-10 h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Redirect to portal if authenticated
  if (isAuthenticated && !isOAuthFlow) {
    const destination = redirectTo && redirectTo.startsWith('/') ? redirectTo : '/portal';
    return <Navigate to={destination} replace />;
  }

  const isVerificationError = error.toLowerCase().includes('verify your email');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResendMessage('');
    setIsLoading(true);
    const result = await login(email, password);
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setIsLoading(false);
  };

  const handleResend = async () => {
    if (!email || resending) return;
    setResending(true);
    setResendMessage('');
    try {
      await resendMutation({ variables: { email } });
      setResendMessage('Verification email sent. Check your inbox.');
    } catch {
      setResendMessage('Failed to resend. Please try again.');
    }
    setResending(false);
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 overflow-hidden">
      {/* Animated gradient background */}
      <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-background to-primary/10" />
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-to-br from-primary/30 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '8s' }} />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-to-tl from-amber-500/20 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '10s', animationDelay: '2s' }} />
        <div className="absolute top-1/4 right-1/4 w-1/2 h-1/2 bg-gradient-to-bl from-primary/20 to-transparent rounded-full blur-3xl animate-pulse" style={{ animationDuration: '12s', animationDelay: '4s' }} />
      </div>

      {/* Logo */}
      <div className="relative z-10 mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
          <Home className="h-6 w-6 text-primary-foreground" />
        </div>
        <div className="flex flex-col">
          <span className="text-2xl font-bold" style={{ lineHeight: 1.2 }}>Homecast</span>
          {isCommunity && (
            <span className="text-xs text-muted-foreground font-medium">Community Edition</span>
          )}
        </div>
      </div>

      <Card className="relative z-10 w-full max-w-md border-white/20 bg-background/80 backdrop-blur-xl shadow-2xl">
        {/* --- Community: Setup flow (first launch) --- */}
        {isCommunity && showSetup ? (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">{connectMode ? 'Connect to Relay' : 'Get Started'}</CardTitle>
              <CardDescription>
                {connectMode
                  ? 'Enter the address of your Homecast relay'
                  : 'Control your Apple Home devices from anywhere'}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {connectMode ? (
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="relay-address">Relay Address</Label>
                    <Input
                      id="relay-address"
                      type="url"
                      placeholder="http://192.168.1.50:5656"
                      value={relayAddress}
                      onChange={(e) => setRelayAddress(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleConnectToRelay()}
                      autoFocus
                    />
                  </div>
                  {connectError && (
                    <p className="text-sm text-destructive">{connectError}</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center">
                  Set up this Mac as a relay, or connect to an existing one on your network.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex flex-col gap-2">
              {connectMode ? (
                <>
                  <Button className="w-full" onClick={handleConnectToRelay} disabled={connecting}>
                    {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                    Connect
                  </Button>
                  {isOnRelayMac && (
                    <Button variant="ghost" className="w-full" onClick={() => { setConnectMode(false); setConnectError(''); }}>
                      Back
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <Button className="w-full" onClick={handleStartRelay}>
                    <Home className="mr-2 h-4 w-4" />
                    Start Relay
                  </Button>
                  <Button variant="outline" className="w-full" onClick={() => setConnectMode(true)}>
                    <Wifi className="mr-2 h-4 w-4" />
                    Connect to Relay
                  </Button>
                </>
              )}
              {(isInNativeApp || isCommunity) && (
                <div className="w-full border-t pt-3 mt-1">
                  <Button variant="outline" size="sm" className="w-full" onClick={switchMode}>
                    {switchFromCommunityLabel}
                  </Button>
                </div>
              )}
            </CardFooter>
          </>

        /* --- Community: Relay not ready --- */
        ) : isCommunity && relayNotReady ? (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-xl">Relay not ready</CardTitle>
              <CardDescription className="mt-2">
                {(getRelayAddress() || config.apiUrl) && (
                  <span className="font-mono text-foreground block mb-1">{getRelayAddress() || config.apiUrl}</span>
                )}
                {getRelayAddress()
                  ? 'Could not connect. Make sure the relay is running.'
                  : 'The Homecast relay hasn\'t been set up yet. Open the Homecast app on the relay Mac first.'}
              </CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col gap-3 pt-0">
              <div className="w-full border-t pt-3">
                <Button variant="outline" size="sm" className="w-full" onClick={switchMode}>
                  {switchFromCommunityLabel}
                </Button>
              </div>
            </CardFooter>
          </>

        /* --- Community: Auth-enabled login form --- */
        ) : isCommunity ? (
          <>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Sign In</CardTitle>
              <CardDescription>
                {getRelayAddress()
                  ? <>Connected to <span className="font-mono text-foreground">{getRelayAddress()}</span></>
                  : 'Authentication is enabled on this relay'}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4">
                {error && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                    <p>{error}</p>
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Username</Label>
                  <Input
                    id="email"
                    type="text"
                    placeholder="admin"
                    value={email}
                    onChange={(e) => setEmail(e.target.value.replace(/\s/g, ''))}
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sign In
                </Button>
                <div className="w-full border-t pt-3">
                  <Button variant="outline" size="sm" className="w-full" type="button" onClick={switchMode}>
                    {switchFromCommunityLabel}
                  </Button>
                </div>
                {(window as any).isHomeKitRelayCapable && !showResetConfirm && (
                  <button
                    type="button"
                    onClick={() => setShowResetConfirm(true)}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Reset all data
                  </button>
                )}
                {showResetConfirm && (window as any).isHomeKitRelayCapable && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2 text-sm">
                    <p className="text-destructive font-medium">Reset Homecast?</p>
                    <p className="text-xs text-muted-foreground">
                      This will permanently delete all data including users, settings, collections, and automations.
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={isLoading}
                        onClick={async () => {
                          setIsLoading(true);
                          localStorage.clear();
                          sessionStorage.clear();
                          try {
                            const { wipeAllData } = await import('@/server/local-db');
                            await wipeAllData();
                          } catch {}
                          const win = window as any;
                          win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'resetMode' });
                        }}
                      >
                        {isLoading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                        Reset all data
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setShowResetConfirm(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardFooter>
            </form>
          </>

        /* --- Cloud mode --- */
        ) : (
          <>
            {isOAuthFlow ? (
              <CardHeader className="text-center">
                <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                  <Shield className="h-5 w-5 text-primary" />
                </div>
                <CardTitle className="text-2xl">Sign in to continue</CardTitle>
                <CardDescription>An application is requesting access to your Homecast account</CardDescription>
              </CardHeader>
            ) : null}
            <form onSubmit={handleSubmit}>
              <CardContent className={`space-y-4 ${!isOAuthFlow ? 'pt-6' : ''}`}>
                {error && (
                  <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive space-y-2">
                    <p>{error}</p>
                    {isVerificationError && (
                      <div>
                        <button
                          type="button"
                          onClick={handleResend}
                          disabled={resending}
                          className="text-primary hover:underline font-medium"
                        >
                          {resending ? 'Sending...' : 'Resend verification email'}
                        </button>
                        {resendMessage && (
                          <p className="text-xs text-muted-foreground mt-1">{resendMessage}</p>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password">Password</Label>
                    <Link to="/forgot-password" tabIndex={-1} className="text-xs text-muted-foreground hover:text-primary">
                      Forgot password?
                    </Link>
                  </div>
                  <Input
                    id="password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-4">
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Sign In
                </Button>
                <p className="text-sm text-muted-foreground">
                  Don't have an account?{' '}
                  <Link to={redirectTo ? `/signup?redirect=${encodeURIComponent(redirectTo)}` : '/signup'} className="text-primary hover:underline">
                    Sign up
                  </Link>
                </p>
                {isInNativeApp && (
                  <div className="w-full border-t pt-3">
                    <Button variant="outline" size="sm" className="w-full" type="button" onClick={switchMode}>
                      {switchFromCloudLabel}
                    </Button>
                  </div>
                )}
              </CardFooter>
            </form>
          </>
        )}
      </Card>
    </div>
  );
};

export default Login;
