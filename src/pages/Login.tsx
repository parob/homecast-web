import { useState, useEffect } from 'react';
import { Link, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Home, Loader2, Shield } from 'lucide-react';
import { useMutation } from '@apollo/client/react';
import { RESEND_VERIFICATION_EMAIL } from '@/lib/graphql/mutations';

import { config, isCommunity } from '@/lib/config';

const API_URL = config.apiUrl;

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

  // Community mode: check if this is first-time setup (no owner) or login
  const [communitySetup, setCommunitySetup] = useState(false);
  const [communityChecked, setCommunityChecked] = useState(!isCommunity);
  const [relayNotReady, setRelayNotReady] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  useEffect(() => {
    if (!isCommunity) return;
    // Check onboarding status via HTTP endpoint (always routes to Mac's IndexedDB)
    fetch(config.graphqlUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operationName: 'IsOnboarded', query: '{ isOnboarded }', variables: {} }),
    })
      .then(r => r.json())
      .then(result => {
        const onboarded = result?.data?.isOnboarded ?? false;
        const relayReady = result?.data?.relayReady ?? false;
        setCommunitySetup(!onboarded);
        // External browser: if relay Mac isn't authenticated, block everything
        if (!(window as any).isHomeKitRelayCapable && !relayReady) {
          setRelayNotReady(true);
        }
        setCommunityChecked(true);
      })
      .catch(() => {
        setCommunitySetup(true);
        setCommunityChecked(true);
      });
  }, []);

  // OAuth flow detection
  const isOAuthFlow = searchParams.get('oauth_flow') === 'true';
  const oauthParams = searchParams.get('oauth_params');
  const redirectTo = searchParams.get('redirect');

  // After successful login in OAuth flow, redirect back to authorize endpoint
  // This allows the server to check for existing consent and skip the consent screen
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

  // Normal flow: redirect to portal if authenticated
  // OAuth flow: handled by useEffect above
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

    if (isCommunity && communitySetup) {
      // First-time setup: create owner account
      const result = await signup(email, password);
      if (!result.success) {
        if (result.error?.includes('disabled') || result.error?.includes('already exists')) {
          // Owner already exists — switch to login mode
          setCommunitySetup(false);
          setError('An account already exists. Please sign in.');
        } else {
          setError(result.error || 'Setup failed');
        }
      }
    } else {
      const result = await login(email, password);
      if (!result.success) {
        setError(result.error || 'Login failed');
      }
    }
    // OAuth flow redirect is handled by useEffect
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

      {/* Content */}
      <div className="relative z-10 mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary shadow-lg shadow-primary/25">
          <Home className="h-6 w-6 text-primary-foreground" />
        </div>
        <span className="text-2xl font-bold">Homecast</span>
        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${isCommunity ? 'bg-[hsl(222,47%,8%)] text-[hsl(210,40%,98%)] border border-[hsl(217,32%,17%)]' : 'bg-primary/10 text-primary'}`}>
          {isCommunity ? 'Community' : 'Cloud'}
        </span>
      </div>

      <Card className="relative z-10 w-full max-w-md border-white/20 bg-background/80 backdrop-blur-xl shadow-2xl">
        {isCommunity && relayNotReady ? (
          <CardHeader className="text-center pb-6">
            <CardTitle className="text-xl">Server not ready</CardTitle>
            <CardDescription className="mt-2">
              {communitySetup
                ? 'This Homecast server hasn\'t been configured yet. Set up an account from the Homecast Mac app first.'
                : 'The Homecast Mac app needs to be signed in before other devices can connect.'}
            </CardDescription>
          </CardHeader>
        ) : isCommunity && communitySetup ? (
          <CardHeader className="text-center">
            <CardDescription>Create your account to get started</CardDescription>
          </CardHeader>
        ) : isCommunity ? (
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <CardDescription>Sign in to your Homecast server</CardDescription>
          </CardHeader>
        ) : isOAuthFlow ? (
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Shield className="h-5 w-5 text-primary" />
            </div>
            <CardTitle className="text-2xl">Sign in to continue</CardTitle>
            <CardDescription>An application is requesting access to your Homecast account</CardDescription>
          </CardHeader>
        ) : null}
        {!(isCommunity && relayNotReady) && !(isCommunity && communitySetup && !(window as any).isHomeKitRelayCapable) && (
        <form onSubmit={handleSubmit}>
          <CardContent className={`space-y-4 ${!isOAuthFlow ? 'pt-6' : ''}`}>
            {error && (
              <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive space-y-2">
                <p>{error}</p>
                {!isCommunity && isVerificationError && (
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
              <Label htmlFor="email">{isCommunity ? 'Username' : 'Email'}</Label>
              <Input
                id="email"
                type={isCommunity ? 'text' : 'email'}
                placeholder={isCommunity ? 'admin' : 'you@example.com'}
                value={email}
                onChange={(e) => setEmail(isCommunity ? e.target.value.replace(/\s/g, '') : e.target.value)}
                autoCapitalize={isCommunity ? 'none' : undefined}
                autoCorrect={isCommunity ? 'off' : undefined}
                required
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                {!isCommunity && (
                  <Link to="/forgot-password" className="text-xs text-muted-foreground hover:text-primary">
                    Forgot password?
                  </Link>
                )}
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
              {isCommunity && communitySetup ? 'Create Account' : 'Sign In'}
            </Button>
            {isCommunity && !communitySetup && !showResetConfirm && (window as any).isHomeKitRelayCapable && (
              <button
                type="button"
                onClick={() => setShowResetConfirm(true)}
                className="text-xs text-muted-foreground hover:text-destructive"
              >
                Forgot password? Reset all data
              </button>
            )}
            {isCommunity && showResetConfirm && (window as any).isHomeKitRelayCapable && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2 text-sm">
                <p className="text-destructive font-medium">Reset Homecast?</p>
                <p className="text-xs text-muted-foreground">
                  This will permanently delete all data including users, settings, collections, and automations. This cannot be undone.
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
                      // Now trigger the mode reset
                      const win = window as any;
                      win.webkit?.messageHandlers?.homecast?.postMessage({ action: 'resetMode' });
                    }}
                  >
                    {isLoading ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                    Reset all data
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowResetConfirm(false)}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
            {!isCommunity && (
              <p className="text-sm text-muted-foreground">
                Don't have an account?{' '}
                <Link to={redirectTo ? `/signup?redirect=${encodeURIComponent(redirectTo)}` : '/signup'} className="text-primary hover:underline">
                  Sign up
                </Link>
              </p>
            )}
          </CardFooter>
        </form>
        )}
      </Card>
    </div>
  );
};

export default Login;
