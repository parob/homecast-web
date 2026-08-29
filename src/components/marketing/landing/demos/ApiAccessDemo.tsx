/** Settings → API Access: the endpoints, and tokens you can mint and revoke. */
import { useState } from 'react';
import { Key, Plus } from 'lucide-react';
import { Panel, CopyButton, iconBtn } from './bits';

const ENDPOINTS = [
  { label: 'MCP', url: 'https://api.homecast.cloud/mcp', note: 'OAuth for ChatGPT, Claude Desktop and other AI assistants.' },
  { label: 'GraphQL', url: 'https://api.homecast.cloud/graphql' },
  { label: 'REST', url: 'https://api.homecast.cloud/rest' },
  { label: 'MQTT', url: 'mqtt.homecast.cloud:8883', note: 'Cloud plan. Enable per home in Settings → Homes.' },
];

interface Token { id: number; name: string; prefix: string; scope: string; full?: string }
const mint = () => 'hc_' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10);

export function ApiAccessDemo() {
  const [tokens, setTokens] = useState<Token[]>([{ id: 1, name: 'Home Assistant', prefix: 'hc_abc1', scope: 'My Home (control)' }]);

  const create = () => {
    const full = mint();
    setTokens((t) => [...t, { id: Date.now(), name: `Token ${t.length + 1}`, prefix: full.slice(0, 7), scope: 'My Home (view)', full }]);
  };

  return (
    <Panel className="max-w-[440px] p-0">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm"><Key className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Settings ›</span> <span className="font-medium">API Access</span></div>
      <div className="p-5">
        <div className="text-sm font-medium">Endpoints</div>
        <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-muted/30">
          {ENDPOINTS.map((e) => (
            <div key={e.label} className="px-3 py-2.5">
              <div className="flex items-center gap-3">
                <span className="w-14 shrink-0 text-xs text-muted-foreground">{e.label}</span>
                <code className="min-w-0 flex-1 truncate text-xs">{e.url}</code>
                <CopyButton text={e.url} className={iconBtn} />
              </div>
              {e.note && <div className="ml-[68px] mt-1.5 inline-block rounded-md bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-700 dark:text-emerald-400">{e.note}</div>}
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium">Access Tokens</div>
            <div className="text-xs text-muted-foreground">Bearer token in the Authorization header.</div>
          </div>
          <button type="button" onClick={create} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-medium hover:bg-primary/15"><Plus className="h-3.5 w-3.5" /> Create</button>
        </div>
        <div className="mt-2 divide-y divide-border rounded-lg border border-border">
          {tokens.map((t) => (
            <div key={t.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm"><span className="font-medium">{t.name}</span> <code className="text-xs text-muted-foreground">{t.prefix}</code></div>
                <button type="button" onClick={() => setTokens((list) => list.filter((x) => x.id !== t.id))} className="text-xs font-medium text-red-500 hover:underline">Revoke</button>
              </div>
              <div className="text-xs text-muted-foreground">{t.scope}</div>
              {t.full && (
                <div className="mt-2 flex items-center gap-2 rounded-md bg-emerald-500/10 px-2 py-1.5">
                  <code className="min-w-0 flex-1 truncate text-[11px] text-emerald-700 dark:text-emerald-400">{t.full}</code>
                  <CopyButton text={t.full} className={iconBtn} />
                </div>
              )}
            </div>
          ))}
          {tokens.length === 0 && <div className="px-3 py-3 text-xs text-muted-foreground">No tokens. Create one to use the API.</div>}
        </div>
      </div>
    </Panel>
  );
}
