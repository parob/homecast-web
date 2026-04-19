import { useState, useEffect, useCallback } from 'react';
import { Check, Copy, Plus } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { getAuthHeaders, getApiBase } from './util';

export function ConnectDialog({ open, onOpenChange, homes }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homes: Array<{ id: string; name: string }>;
}) {
  const [tokens, setTokens] = useState<Array<{ id: string; name: string; tokenPrefix: string; homePermissions: string; lastUsedAt?: string; expiresAt?: string }>>([]);
  const [newTokenRaw, setNewTokenRaw] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [tokenName, setTokenName] = useState('');
  const [tokenPerms, setTokenPerms] = useState<Record<string, 'view' | 'control'>>({});
  const [tokenExpiry, setTokenExpiry] = useState<string>('never');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const gql = useCallback(async (query: string, variables?: Record<string, unknown>) => {
    const headers = getAuthHeaders();
    if (!headers) return null;
    const r = await fetch(getApiBase() + '/', { method: 'POST', headers, body: JSON.stringify({ query, variables }) });
    return (await r.json())?.data;
  }, []);

  const fetchTokens = useCallback(async () => {
    setLoading(true);
    try {
      const d = await gql('{ accessTokens { id name tokenPrefix homePermissions lastUsedAt expiresAt } }');
      setTokens(d?.accessTokens ?? []);
    } catch {} finally { setLoading(false); }
  }, [gql]);

  useEffect(() => { if (open) { fetchTokens(); setNewTokenRaw(null); } }, [open, fetchTokens]);

  const createToken = async () => {
    if (!tokenName.trim() || Object.keys(tokenPerms).length === 0) return;
    setCreating(true);
    let expiresAt: string | undefined;
    if (tokenExpiry !== 'never') {
      const d = new Date();
      if (tokenExpiry === '30d') d.setDate(d.getDate() + 30);
      if (tokenExpiry === '90d') d.setDate(d.getDate() + 90);
      if (tokenExpiry === '1y') d.setFullYear(d.getFullYear() + 1);
      expiresAt = d.toISOString();
    }
    try {
      const d = await gql(
        'mutation($name: String!, $homePermissions: String!, $expiresAt: String) { createAccessToken(name: $name, homePermissions: $homePermissions, expiresAt: $expiresAt) { success rawToken error } }',
        { name: tokenName.trim(), homePermissions: JSON.stringify(tokenPerms), expiresAt }
      );
      if (d?.createAccessToken?.rawToken) {
        setNewTokenRaw(d.createAccessToken.rawToken);
        await fetchTokens();
      }
    } catch {} finally { setCreating(false); }
  };

  const revokeToken = async (id: string) => {
    await gql('mutation($tokenId: String!) { revokeAccessToken(tokenId: $tokenId) { success } }', { tokenId: id });
    fetchTokens();
  };

  const copyText = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const host = 'mqtt.homecast.cloud';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Connection Details</DialogTitle>
          <DialogDescription className="sr-only">MQTT connection details and access tokens</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Connection Details */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">MQTT Broker</p>
            <div className="rounded-md border bg-muted/30 divide-y text-[12px]">
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-muted-foreground">Host</span>
                <div className="flex items-center gap-1.5">
                  <code className="font-mono">{host}</code>
                  <button onClick={() => copyText(host, 'host')} className="p-0.5 text-muted-foreground hover:text-foreground">
                    {copied === 'host' ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-muted-foreground">Port</span>
                <code className="font-mono">8883 <span className="text-muted-foreground">(TLS)</span> or 1883</code>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-muted-foreground">Username</span>
                <span className="text-muted-foreground italic">any value or leave blank</span>
              </div>
              <div className="flex items-center justify-between px-3 py-1.5">
                <span className="text-muted-foreground">Password</span>
                <span>API access token</span>
              </div>
            </div>
          </div>

          {/* Topic Structure */}
          <div className="space-y-2">
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Topics</p>
            <div className="rounded-md border bg-muted/30 divide-y text-[12px]">
              <div className="px-3 py-2 space-y-1">
                <p className="text-muted-foreground text-[11px]">Read device state — retained JSON per accessory:</p>
                <code className="block font-mono text-[11px] break-all">homecast/{'{home}'}/{'{room}'}/{'{accessory}'}</code>
                <p className="text-muted-foreground text-[11px]">Example payload: <code className="font-mono">{`{"on":true,"brightness":72}`}</code></p>
              </div>
              <div className="px-3 py-2 space-y-1">
                <p className="text-muted-foreground text-[11px]">Control a device — publish JSON to the <code className="font-mono">/set</code> subtopic:</p>
                <code className="block font-mono text-[11px] break-all">homecast/{'{home}'}/{'{room}'}/{'{accessory}'}/set</code>
                <p className="text-muted-foreground text-[11px]">Payload keys map 1:1 to state keys — send only what you want to change: <code className="font-mono">{`{"on":false}`}</code></p>
              </div>
              <div className="px-3 py-2 space-y-1">
                <p className="text-muted-foreground text-[11px]">Other topics you'll see:</p>
                <ul className="text-[11px] space-y-0.5">
                  <li><code className="font-mono">.../availability</code> — <span className="text-muted-foreground">"online" / "offline" per device</span></li>
                  <li><code className="font-mono">.../members</code> — <span className="text-muted-foreground">JSON array of accessory slugs in a service group</span></li>
                  <li><code className="font-mono">homecast/{'{home}'}/status</code> — <span className="text-muted-foreground">home-level online/offline LWT</span></li>
                </ul>
              </div>
              <div className="px-3 py-2">
                <p className="text-muted-foreground text-[11px]">Slugs are lowercase-kebab with a 4-hex UUID suffix (e.g. <code className="font-mono">county-hall-2d10</code>, <code className="font-mono">kitchen-dfee</code>). Subscribe to <code className="font-mono">homecast/#</code> to see everything your token is scoped to.</p>
              </div>
            </div>
          </div>

          {/* Access Tokens */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Access Tokens</p>
              <button onClick={() => { setCreateOpen(true); setTokenName(''); setTokenPerms({}); setTokenExpiry('never'); }} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border hover:bg-muted transition-colors">
                <Plus className="h-3 w-3" /> Create Token
              </button>
            </div>

            {/* Create Token Dialog */}
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogContent className="sm:max-w-sm" style={{ zIndex: 10060 }}>
                <DialogHeader>
                  <DialogTitle>{newTokenRaw ? 'Token Created' : 'Create Access Token'}</DialogTitle>
                  <DialogDescription className="sr-only">{newTokenRaw ? 'Save your token' : 'Create a new access token'}</DialogDescription>
                </DialogHeader>
                {newTokenRaw ? (
                  <div className="space-y-3">
                    <div className="rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/30 p-3 space-y-1.5">
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200">Save this token — it won't be shown again</p>
                      <div className="flex items-center gap-1.5">
                        <code className="flex-1 text-[11px] font-mono break-all select-all">{newTokenRaw}</code>
                        <button onClick={() => copyText(newTokenRaw, 'newtoken')} className="p-1 shrink-0">
                          {copied === 'newtoken' ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                    <button onClick={() => { setCreateOpen(false); setNewTokenRaw(null); }} className="w-full text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90">Done</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Name</label>
                      <input type="text" value={tokenName} onChange={e => setTokenName(e.target.value)} placeholder="e.g., Home Assistant, Node-RED" autoFocus className="w-full text-sm bg-background border rounded-md px-2.5 py-1.5 outline-none focus:border-primary" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Home permissions</label>
                      <div className="rounded-md border divide-y">
                        {homes.map(home => (
                          <div key={home.id} className="flex items-center justify-between px-2.5 py-1.5">
                            <label className="flex items-center gap-2 text-sm cursor-pointer">
                              <input type="checkbox" checked={home.id in tokenPerms} onChange={e => {
                                if (e.target.checked) setTokenPerms(p => ({ ...p, [home.id]: 'control' }));
                                else setTokenPerms(p => { const n = { ...p }; delete n[home.id]; return n; });
                              }} className="rounded" />
                              {home.name}
                            </label>
                            {home.id in tokenPerms && (
                              <select value={tokenPerms[home.id]} onChange={e => setTokenPerms(p => ({ ...p, [home.id]: e.target.value as 'view' | 'control' }))} className="text-xs bg-background border rounded px-1.5 py-0.5">
                                <option value="control">Control</option>
                                <option value="view">View</option>
                              </select>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Expiration</label>
                      <select value={tokenExpiry} onChange={e => setTokenExpiry(e.target.value)} className="w-full text-sm bg-background border rounded-md px-2.5 py-1.5">
                        <option value="never">Never</option>
                        <option value="30d">30 days</option>
                        <option value="90d">90 days</option>
                        <option value="1y">1 year</option>
                      </select>
                    </div>
                    <button onClick={createToken} disabled={creating || !tokenName.trim() || Object.keys(tokenPerms).length === 0} className="w-full text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      {creating ? 'Creating...' : 'Create Token'}
                    </button>
                  </div>
                )}
              </DialogContent>
            </Dialog>

            {/* Token List */}
            {loading ? (
              <p className="text-xs text-muted-foreground text-center py-2">Loading...</p>
            ) : tokens.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">No access tokens yet.</p>
            ) : (
              <div className="rounded-md border divide-y">
                {tokens.map(token => {
                  let permStr = '';
                  try {
                    const perms = JSON.parse(token.homePermissions) as Record<string, string>;
                    permStr = Object.entries(perms).map(([hid, role]) => {
                      const h = homes.find(x => x.id.toLowerCase() === hid.toLowerCase());
                      return `${h?.name || hid.slice(0, 8)} (${role})`;
                    }).join(', ');
                  } catch {}
                  return (
                    <div key={token.id} className="px-3 py-2 text-[12px]">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{token.name}</span>
                          <code className="text-[10px] font-mono text-muted-foreground">{token.tokenPrefix}</code>
                        </div>
                        <button onClick={() => revokeToken(token.id)} className="text-[10px] text-destructive hover:underline">Revoke</button>
                      </div>
                      {permStr && <p className="text-[10px] text-muted-foreground mt-0.5">{permStr}</p>}
                      <p className="text-[10px] text-muted-foreground">
                        {token.expiresAt ? `Expires ${new Date(token.expiresAt).toLocaleDateString()}` : 'Never expires'}
                        {token.lastUsedAt && ` · Last used ${new Date(token.lastUsedAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
