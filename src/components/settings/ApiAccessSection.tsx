import { useState, useCallback } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, Copy, Plus, AlertTriangle, Radio, Info } from 'lucide-react';
import { toast } from 'sonner';
import { config, isCommunity } from '@/lib/config';
import { GET_ACCESS_TOKENS } from '@/lib/graphql/queries';
import { CREATE_ACCESS_TOKEN, REVOKE_ACCESS_TOKEN } from '@/lib/graphql/mutations';
import type {
  HomeKitHome,
  GetAccessTokensResponse,
  CreateAccessTokenResponse,
  RevokeAccessTokenResponse,
} from '@/lib/graphql/types';

interface ApiAccessSectionProps {
  homes: HomeKitHome[];
  copyToClipboard: (text: string) => boolean;
  accountType?: string;
}

export function ApiAccessSection({ homes, copyToClipboard, accountType }: ApiAccessSectionProps) {
  const isCloudPlan = accountType === 'cloud';
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [createTokenDialogOpen, setCreateTokenDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [newTokenPermissions, setNewTokenPermissions] = useState<Record<string, 'view' | 'control'>>({});
  const [newTokenExpiry, setNewTokenExpiry] = useState<'never' | '30days' | '90days' | '1year'>('never');
  const [newTokenRawToken, setNewTokenRawToken] = useState<string | null>(null);
  const [revokeTokenId, setRevokeTokenId] = useState<string | null>(null);

  const { data: accessTokensData, refetch: refetchAccessTokens } = useQuery<GetAccessTokensResponse>(
    GET_ACCESS_TOKENS,
    { fetchPolicy: 'cache-and-network' }
  );

  const [createAccessTokenMutation] = useMutation<CreateAccessTokenResponse>(CREATE_ACCESS_TOKEN);
  const [revokeAccessTokenMutation] = useMutation<RevokeAccessTokenResponse>(REVOKE_ACCESS_TOKEN);

  const copyUrl = useCallback((url: string, key: string, label: string) => {
    copyToClipboard(url);
    setCopiedUrl(key);
    setTimeout(() => setCopiedUrl(null), 2000);
    toast.success(`${label} URL copied`);
  }, [copyToClipboard]);

  const resetCreateTokenForm = useCallback(() => {
    setNewTokenName('');
    setNewTokenPermissions({});
    setNewTokenExpiry('never');
    setNewTokenRawToken(null);
  }, []);

  const handleCreateAccessToken = useCallback(async () => {
    if (!newTokenName.trim()) {
      toast.error('Please enter a token name');
      return;
    }
    if (Object.keys(newTokenPermissions).length === 0) {
      toast.error('Please select at least one home');
      return;
    }

    let expiresAt: string | undefined;
    if (newTokenExpiry !== 'never') {
      const now = new Date();
      switch (newTokenExpiry) {
        case '30days': now.setDate(now.getDate() + 30); break;
        case '90days': now.setDate(now.getDate() + 90); break;
        case '1year': now.setFullYear(now.getFullYear() + 1); break;
      }
      expiresAt = now.toISOString();
    }

    try {
      const result = await createAccessTokenMutation({
        variables: {
          name: newTokenName.trim(),
          homePermissions: JSON.stringify(newTokenPermissions),
          expiresAt,
        },
      });

      if (result.data?.createAccessToken.success && result.data.createAccessToken.rawToken) {
        setNewTokenRawToken(result.data.createAccessToken.rawToken);
        refetchAccessTokens();
      } else {
        toast.error(result.data?.createAccessToken.error || 'Failed to create token');
      }
    } catch {
      toast.error('Failed to create token');
    }
  }, [newTokenName, newTokenPermissions, newTokenExpiry, createAccessTokenMutation, refetchAccessTokens]);

  const handleRevokeAccessToken = useCallback(async (tokenId: string) => {
    try {
      const result = await revokeAccessTokenMutation({
        variables: { tokenId },
      });

      if (result.data?.revokeAccessToken.success) {
        toast.success('Token revoked');
        refetchAccessTokens();
        setRevokeTokenId(null);
      } else {
        toast.error(result.data?.revokeAccessToken.error || 'Failed to revoke token');
      }
    } catch {
      toast.error('Failed to revoke token');
    }
  }, [revokeAccessTokenMutation, refetchAccessTokens]);

  return (
    <div className="space-y-6">
      {/* Endpoints Section */}
      <div className="space-y-2">
        <p className="text-sm font-medium">Endpoints</p>
        <div className="rounded-md border bg-muted/30 divide-y">
          {[
            { label: 'MCP', url: `${config.apiUrl}/mcp`, key: 'api-mcp', info: 'Supports OAuth authentication for ChatGPT, Claude Desktop, and other AI assistants.' },
            { label: 'GraphQL', url: `${config.apiUrl}/graphql`, key: 'api-graphql' },
            { label: 'REST', url: `${config.apiUrl}/rest`, key: 'api-rest' },
            ...(!isCommunity ? [{
              label: 'MQTT',
              url: location.hostname.includes('staging') ? 'mqtt.staging.homecast.cloud:8883' : 'mqtt.homecast.cloud:8883',
              key: 'api-mqtt',
              info: isCloudPlan
                ? `Use API access token as password. <a href="https://${location.hostname.includes('staging') ? 'mqtt.staging.homecast.cloud' : 'mqtt.homecast.cloud'}" target="_blank" rel="noopener" style="text-decoration:underline">Open MQTT Browser</a>`
                : 'Available on the Cloud plan. Enable per home in Settings → Homes.',
            }] : []),
          ].map(({ label, url, key, info }) => (
            <div key={key} className="px-2.5 py-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-medium text-muted-foreground w-14 shrink-0">{label}</span>
                <code className="flex-1 text-[11px] font-mono truncate text-foreground/80 selectable">
                  {url}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => copyUrl(url, key, label)}
                >
                  {copiedUrl === key ? (
                    <Check className="h-3 w-3 text-green-500" />
                  ) : (
                    <Copy className="h-3 w-3" />
                  )}
                </Button>
              </div>
              {info && (
                <div className="mt-1.5 ml-14">
                  <span className="inline-flex rounded-md bg-green-100 px-2 py-0.5 text-[10px] text-green-800 border border-green-300 dark:bg-green-900/30 dark:text-green-400 dark:border-green-700" dangerouslySetInnerHTML={{ __html: info }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <Separator />


      {/* Access Tokens Section */}
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium">Access Tokens</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create tokens to authenticate with the API. Use as a Bearer token in the Authorization header.
          </p>
        </div>

        {/* Token List */}
        {accessTokensData?.accessTokens && accessTokensData.accessTokens.length > 0 ? (
          <div className="rounded-lg border divide-y">
            {accessTokensData.accessTokens.map((token) => {
              const permissions = JSON.parse(token.homePermissions) as Record<string, 'view' | 'control'>;
              const homeNames = Object.entries(permissions).map(([homeId, role]) => {
                const home = homes.find(h => h.id === homeId);
                return `${home?.name || homeId.slice(0, 8)} (${role})`;
              });
              return (
                <div key={token.id} className="p-3 space-y-1">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{token.name}</span>
                      <code className="text-xs text-muted-foreground font-mono selectable">{token.tokenPrefix}</code>
                    </div>
                    <AlertDialog open={revokeTokenId === token.id} onOpenChange={(open) => !open && setRevokeTokenId(null)}>
                      <AlertDialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setRevokeTokenId(token.id)}>
                          Revoke
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="z-[10070]">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Revoke access token?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This will immediately revoke <span className="font-medium text-foreground">{token.name}</span>. Any applications using this token will lose access.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90 text-destructive-foreground"
                            onClick={() => handleRevokeAccessToken(token.id)}
                          >
                            Revoke
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <p className="text-xs text-muted-foreground">{homeNames.join(', ')}</p>
                  <p className="text-xs text-muted-foreground">
                    Expires: {token.expiresAt ? new Date(token.expiresAt).toLocaleDateString() : 'Never'}
                    {token.lastUsedAt && ` · Last used: ${new Date(token.lastUsedAt).toLocaleDateString()}`}
                  </p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-2">No access tokens created yet.</p>
        )}

        {/* Create Token Button + Dialog */}
        <Dialog open={createTokenDialogOpen} onOpenChange={(open) => {
          setCreateTokenDialogOpen(open);
          if (!open) resetCreateTokenForm();
        }}>
          <Button variant="outline" size="sm" className="w-full" onClick={() => setCreateTokenDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Create Token
          </Button>
          <DialogContent className="sm:max-w-md" style={{ zIndex: 10030 }}>
            <DialogHeader>
              <DialogTitle>{newTokenRawToken ? 'Token Created' : 'Create Access Token'}</DialogTitle>
              <DialogDescription>
                {newTokenRawToken
                  ? 'Save this token now - it will only be shown once!'
                  : 'Create a token to access the API programmatically.'
                }
              </DialogDescription>
            </DialogHeader>

            {newTokenRawToken ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0 mt-0.5" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Save this token now!</p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">This token will only be shown once. Copy it to a secure location.</p>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Your access token</Label>
                  <div className="flex gap-2">
                    <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono break-all select-all selectable">
                      {newTokenRawToken}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        copyToClipboard(newTokenRawToken);
                        toast.success('Token copied');
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <Button className="w-full" onClick={() => {
                  setCreateTokenDialogOpen(false);
                  resetCreateTokenForm();
                }}>
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="token-name">Token name</Label>
                  <Input
                    id="token-name"
                    placeholder="e.g., Home Assistant, Shortcuts"
                    value={newTokenName}
                    onChange={(e) => setNewTokenName(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label>Home permissions</Label>
                  <div className="rounded-lg border divide-y">
                    {homes.map((home) => (
                      <div key={home.id} className="flex items-center justify-between p-3">
                        <div className="flex items-center gap-3">
                          <Checkbox
                            id={`home-${home.id}`}
                            checked={home.id in newTokenPermissions}
                            onCheckedChange={(checked) => {
                              if (checked) {
                                setNewTokenPermissions(prev => ({ ...prev, [home.id]: 'control' }));
                              } else {
                                setNewTokenPermissions(prev => {
                                  const next = { ...prev };
                                  delete next[home.id];
                                  return next;
                                });
                              }
                            }}
                          />
                          <Label htmlFor={`home-${home.id}`} className="cursor-pointer">{home.name}</Label>
                        </div>
                        {home.id in newTokenPermissions && (
                          <Select
                            value={newTokenPermissions[home.id]}
                            onValueChange={(value: 'view' | 'control') => {
                              setNewTokenPermissions(prev => ({ ...prev, [home.id]: value }));
                            }}
                          >
                            <SelectTrigger className="w-24 h-8">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent style={{ zIndex: 10040 }}>
                              <SelectItem value="view">View</SelectItem>
                              <SelectItem value="control">Control</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    ))}
                    {homes.length === 0 && (
                      <p className="text-sm text-muted-foreground p-3">No homes available. Connect a device first.</p>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Expiration</Label>
                  <Select value={newTokenExpiry} onValueChange={(value: 'never' | '30days' | '90days' | '1year') => setNewTokenExpiry(value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent style={{ zIndex: 10040 }}>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="30days">30 days</SelectItem>
                      <SelectItem value="90days">90 days</SelectItem>
                      <SelectItem value="1year">1 year</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  className="w-full"
                  onClick={handleCreateAccessToken}
                  disabled={!newTokenName.trim() || Object.keys(newTokenPermissions).length === 0}
                >
                  Create Token
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
