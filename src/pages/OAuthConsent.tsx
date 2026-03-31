import { useState, useEffect } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Home, Loader2, Shield, Check, X, ExternalLink, Eye, Zap } from 'lucide-react';
import { GET_CACHED_HOMES } from '@/lib/graphql/queries';
import { WELL_KNOWN_CLIENTS } from '@/lib/oauth-clients';

import { config } from '@/lib/config';

const API_URL = config.apiUrl;

interface OAuthParams {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
  resource: string;  // RFC 8707 resource indicator
  client_name?: string;
  logo_uri?: string;
  client_uri?: string;
}

function getClientBranding(redirectUri: string, paramClientName?: string, paramLogoUri?: string) {
  // Try well-known clients first (based on redirect_uri domain)
  try {
    const domain = new URL(redirectUri).hostname;
    const wellKnown = WELL_KNOWN_CLIENTS[domain];
    if (wellKnown) {
      return {
        name: paramClientName || wellKnown.name,
        logoUrl: paramLogoUri || wellKnown.logoUrl,
      };
    }
  } catch { /* ignore */ }

  return {
    name: paramClientName || null,
    logoUrl: paramLogoUri || null,
  };
}

interface CachedHome {
  id: string;
  name: string;
  updatedAt: string;
}

interface CachedHomesResponse {
  cachedHomes: CachedHome[];
}

interface HomePermission {
  homeId: string;
  homeName: string;
  enabled: boolean;
  role: 'view' | 'control';
}

const OAuthConsent = () => {
  const { isAuthenticated, isLoading: authLoading, token } = useAuth();
  const [searchParams] = useSearchParams();
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [successRedirectUri, setSuccessRedirectUri] = useState('');
  const [error, setError] = useState('');
  const [oauthParams, setOauthParams] = useState<OAuthParams | null>(null);
  const [clientBranding, setClientBranding] = useState<{ name: string | null; logoUrl: string | null }>({ name: null, logoUrl: null });
  const [homePermissions, setHomePermissions] = useState<HomePermission[]>([]);

  // Fetch cached homes from the database
  const { data: homesData, loading: homesLoading } = useQuery<CachedHomesResponse>(GET_CACHED_HOMES, {
    skip: !isAuthenticated,
    fetchPolicy: 'network-only',
  });

  // Initialize home permissions when homes data loads (default: all enabled with control)
  useEffect(() => {
    if (homesData?.cachedHomes && homesData.cachedHomes.length > 0 && homePermissions.length === 0) {
      setHomePermissions(homesData.cachedHomes.map(h => ({
        homeId: h.id,
        homeName: h.name,
        enabled: true,
        role: 'control'
      })));
    }
  }, [homesData, homePermissions.length]);

  // Parse OAuth params from URL
  useEffect(() => {
    const paramsStr = searchParams.get('oauth_params');
    if (paramsStr) {
      try {
        const params = new URLSearchParams(paramsStr);
        const redirectUri = params.get('redirect_uri') || '';
        const paramClientName = params.get('client_name') || undefined;
        const paramLogoUri = params.get('logo_uri') || undefined;

        setOauthParams({
          client_id: params.get('client_id') || '',
          redirect_uri: redirectUri,
          code_challenge: params.get('code_challenge') || '',
          code_challenge_method: params.get('code_challenge_method') || 'S256',
          scope: params.get('scope') || '',
          state: params.get('state') || '',
          resource: params.get('resource') || '',
        });

        setClientBranding(getClientBranding(redirectUri, paramClientName, paramLogoUri));
      } catch (e) {
        setError('Invalid OAuth parameters');
      }
    }
  }, [searchParams]);

  // If not authenticated, redirect to login
  if (!authLoading && !isAuthenticated) {
    const oauthParamsStr = searchParams.get('oauth_params');
    return <Navigate to={`/login?oauth_flow=true&oauth_params=${encodeURIComponent(oauthParamsStr || '')}`} replace />;
  }

  if (authLoading || homesLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!oauthParams) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle className="text-xl text-destructive">Invalid Request</CardTitle>
            <CardDescription>Missing or invalid OAuth parameters</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const handleApprove = async () => {
    setIsLoading(true);
    setError('');

    // Build home permissions object from enabled homes
    const homePerms = homePermissions
      .filter(hp => hp.enabled)
      .reduce((acc, hp) => ({ ...acc, [hp.homeId]: hp.role }), {} as Record<string, string>);

    try {
      const response = await fetch(`${API_URL}/oauth/authorize/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: token,
          approved: true,
          homePermissions: homePerms,
          ...oauthParams,
        }),
      });

      const data = await response.json();

      if (response.ok && data.redirect_uri) {
        // Show success state immediately
        setIsSuccess(true);
        setSuccessRedirectUri(data.redirect_uri);
        setIsLoading(false);
        // Attempt redirect
        window.location.href = data.redirect_uri;
      } else {
        setError(data.error_description || data.error || 'Authorization failed');
        setIsLoading(false);
      }
    } catch (e) {
      setError('Failed to complete authorization');
      setIsLoading(false);
    }
  };

  const handleDeny = async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`${API_URL}/oauth/authorize/callback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token: token,
          approved: false,
          ...oauthParams,
        }),
      });

      const data = await response.json();

      if (data.redirect_uri) {
        // Redirect to the OAuth client with the error
        window.location.href = data.redirect_uri;
      } else {
        // No redirect, just show error or go back
        window.history.back();
      }
    } catch {
      window.history.back();
    }
  };

  // Get homes list
  const homes = homesData?.cachedHomes || [];

  // Helper functions for home permissions
  const toggleHomeEnabled = (homeId: string) => {
    setHomePermissions(prev => prev.map(hp =>
      hp.homeId === homeId ? { ...hp, enabled: !hp.enabled } : hp
    ));
  };

  const setHomeRole = (homeId: string, role: 'view' | 'control') => {
    setHomePermissions(prev => prev.map(hp =>
      hp.homeId === homeId ? { ...hp, role, enabled: true } : hp
    ));
  };

  // Count enabled homes by role
  const enabledHomes = homePermissions.filter(hp => hp.enabled);
  const controlHomes = enabledHomes.filter(hp => hp.role === 'control');

  // Extract domain from redirect URI for display
  let redirectDomain = '';
  try {
    const url = new URL(oauthParams.redirect_uri);
    redirectDomain = url.hostname;
  } catch {
    redirectDomain = oauthParams.redirect_uri;
  }

  if (isSuccess) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <Home className="h-6 w-6 text-primary-foreground" />
          </div>
          <span className="text-2xl font-bold">Homecast</span>
        </div>

        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
              <Check className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-xl">Authorization Successful</CardTitle>
            <CardDescription>
              You can close this tab and return to your application.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground">
              If you're not redirected automatically,{' '}
              <a href={successRedirectUri} className="text-primary underline underline-offset-4 hover:text-primary/80">
                click here
              </a>.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8 flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
          <Home className="h-6 w-6 text-primary-foreground" />
        </div>
        <span className="text-2xl font-bold">Homecast</span>
      </div>

      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2">
            {clientBranding.logoUrl ? (
              <img
                src={clientBranding.logoUrl}
                alt={clientBranding.name || 'Application'}
                className="h-12 w-12 rounded-xl"
                onError={(e) => {
                  const img = e.currentTarget;
                  img.style.display = 'none';
                  img.parentElement?.querySelector('.logo-fallback')?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div className={`flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 logo-fallback ${clientBranding.logoUrl ? 'hidden' : ''}`}>
              <Shield className="h-6 w-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-xl">
            {clientBranding.name
              ? `Authorize ${clientBranding.name}`
              : 'Authorize Application'}
          </CardTitle>
          <CardDescription>
            <span className="font-medium text-foreground">{clientBranding.name || 'This application'}</span> is requesting access to your Homecast account
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Homes section - Interactive selection */}
          {homes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">
                Select homes and permissions:
              </p>
              <div className="rounded-lg border bg-card divide-y">
                {homePermissions.map((hp) => (
                  <div key={hp.homeId} className="p-3 space-y-2">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id={`home-${hp.homeId}`}
                        checked={hp.enabled}
                        onCheckedChange={() => toggleHomeEnabled(hp.homeId)}
                      />
                      <label
                        htmlFor={`home-${hp.homeId}`}
                        className={`flex items-center gap-2 text-sm font-medium cursor-pointer flex-1 ${!hp.enabled ? 'text-muted-foreground' : ''}`}
                      >
                        <Home className={`h-4 w-4 flex-shrink-0 ${hp.enabled ? 'text-primary' : 'text-muted-foreground'}`} />
                        {hp.homeName}
                      </label>
                    </div>
                    {hp.enabled && (
                      <div className="flex items-center gap-2 ml-7">
                        <button
                          type="button"
                          onClick={() => setHomeRole(hp.homeId, 'view')}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                            hp.role === 'view'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <Eye className="h-3 w-3" />
                          View only
                        </button>
                        <button
                          type="button"
                          onClick={() => setHomeRole(hp.homeId, 'control')}
                          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs transition-colors ${
                            hp.role === 'control'
                              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                              : 'bg-muted text-muted-foreground hover:bg-muted/80'
                          }`}
                        >
                          <Zap className="h-3 w-3" />
                          Full control
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {homes.length === 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-2 dark:border-amber-900 dark:bg-amber-950">
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                No homes connected
              </p>
              <p className="text-sm text-amber-700 dark:text-amber-300">
                You need to connect a home before you can grant access to this application.
              </p>
              <a
                href="/portal"
                className="inline-flex items-center text-sm font-medium text-amber-800 dark:text-amber-200 hover:underline"
              >
                Set up a home
                <ExternalLink className="ml-1 h-3 w-3" />
              </a>
            </div>
          )}

          {/* Permissions summary - based on selected homes */}
          {enabledHomes.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">This application will be able to:</p>
              <ul className="space-y-2">
                {enabledHomes.length > 0 && (
                  <li className="flex items-start gap-2 text-sm">
                    <Eye className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
                    <span>View devices and states ({enabledHomes.length} {enabledHomes.length === 1 ? 'home' : 'homes'})</span>
                  </li>
                )}
                {controlHomes.length > 0 && (
                  <li className="flex items-start gap-2 text-sm">
                    <Zap className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
                    <span>Control devices ({controlHomes.length} {controlHomes.length === 1 ? 'home' : 'homes'})</span>
                  </li>
                )}
              </ul>
            </div>
          )}

          {enabledHomes.length === 0 && homes.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Select at least one home to authorize access.
            </div>
          )}

          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ExternalLink className="h-3 w-3" />
            <span>Will redirect to:</span>
            <span className="inline-flex items-center rounded-md bg-green-100 px-2 py-0.5 text-green-800 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700">
              {redirectDomain}
            </span>
          </div>
        </CardContent>

        <CardFooter className="flex gap-3">
          <Button
            variant="outline"
            className="flex-1"
            onClick={handleDeny}
            disabled={isLoading}
          >
            <X className="mr-2 h-4 w-4" />
            Deny
          </Button>
          <Button
            className="flex-1"
            onClick={handleApprove}
            disabled={isLoading || enabledHomes.length === 0}
          >
            {isLoading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Authorize
          </Button>
        </CardFooter>
      </Card>

      <p className="mt-6 max-w-md text-center text-xs text-muted-foreground">
        By authorizing, you allow this application to access your Homecast account according to the permissions listed above.
        You can revoke access at any time from your account settings.
      </p>
    </div>
  );
};

export default OAuthConsent;
