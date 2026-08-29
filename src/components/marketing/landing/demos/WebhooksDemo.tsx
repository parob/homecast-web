/** Settings → Webhooks: the list, a create form, and a test delivery per hook. */
import { useState } from 'react';
import { Webhook, Plus, MoreVertical, Send } from 'lucide-react';
import { Panel, iconBtn } from './bits';
import { cx } from './util';

interface Hook { id: number; name: string; url: string; events: number; ok: number; last: string; enabled: boolean; flash?: string }

const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

export function WebhooksDemo() {
  const [hooks, setHooks] = useState<Hook[]>([
    { id: 1, name: 'Home Assistant Sync', url: 'https://ha.example.com/api/webhook/hc', events: 1, ok: 1, last: '169d ago', enabled: true },
    { id: 2, name: 'Slack Notifications', url: 'https://hooks.slack.com/services/T0/B0/x', events: 5, ok: 4, last: '169d ago', enabled: true },
  ]);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: '', url: '' });

  const add = () => {
    if (!draft.name.trim() || !draft.url.trim()) return;
    setHooks((h) => [...h, { id: Date.now(), name: draft.name.trim(), url: draft.url.trim(), events: 0, ok: 0, last: 'never', enabled: true }]);
    setDraft({ name: '', url: '' });
    setCreating(false);
  };
  const test = (id: number) => {
    setHooks((h) => h.map((x) => (x.id === id ? { ...x, events: x.events + 1, ok: x.ok + 1, last: 'just now', flash: `200 OK · ${40 + Math.floor(Math.random() * 90)} ms` } : x)));
    window.setTimeout(() => setHooks((h) => h.map((x) => (x.id === id ? { ...x, flash: undefined } : x))), 2000);
  };

  return (
    <Panel className="max-w-[440px] p-0">
      <div className="flex items-center gap-2 border-b border-border px-5 py-3 text-sm"><Webhook className="h-4 w-4 text-muted-foreground" /><span className="text-muted-foreground">Settings ›</span> <span className="font-medium">Webhooks</span></div>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">Webhooks</div>
            <div className="text-xs text-muted-foreground">Receive real-time notifications when events occur.</div>
          </div>
          <button type="button" onClick={() => setCreating((c) => !c)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary/10 px-3 text-xs font-medium hover:bg-primary/15"><Plus className="h-3.5 w-3.5" /> Create</button>
        </div>

        {creating && (
          <form onSubmit={(e) => { e.preventDefault(); add(); }} className="mt-3 space-y-2 rounded-lg border border-border bg-muted/30 p-3">
            <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} placeholder="Name" className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm" />
            <input value={draft.url} onChange={(e) => setDraft((d) => ({ ...d, url: e.target.value }))} placeholder="https://your-server.example/hook" className="h-8 w-full rounded-md border border-border bg-background px-2.5 text-sm" />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setCreating(false)} className="h-8 rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-muted">Cancel</button>
              <button type="submit" className="h-8 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:bg-primary/90">Add webhook</button>
            </div>
          </form>
        )}

        <div className="mt-3 divide-y divide-border rounded-lg border border-border">
          {hooks.map((h) => {
            const pct = h.events ? Math.round((h.ok / h.events) * 100) : 0;
            return (
              <div key={h.id} className="p-3">
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setHooks((l) => l.map((x) => (x.id === h.id ? { ...x, enabled: !x.enabled } : x)))} aria-label={h.enabled ? 'Disable' : 'Enable'}
                    className={cx('h-2.5 w-2.5 shrink-0 rounded-full transition-colors', h.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
                  <span className={cx('min-w-0 flex-1 truncate text-sm font-medium', !h.enabled && 'text-muted-foreground')}>{h.name}</span>
                  {h.flash && <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[11px] text-emerald-700 animate-fade-in dark:text-emerald-400">{h.flash}</span>}
                  <button type="button" onClick={() => test(h.id)} disabled={!h.enabled} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"><Send className="h-3 w-3" /> Test</button>
                  <span className={iconBtn}><MoreVertical className="h-4 w-4" /></span>
                </div>
                <div className="mt-1 flex gap-3 pl-[18px] text-xs text-muted-foreground">
                  <span className="truncate">{host(h.url)}</span>
                  <span className="shrink-0">{h.events} events</span>
                  <span className="shrink-0">{h.last}</span>
                </div>
                <div className="mt-2 flex items-center gap-3 pl-[18px]">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${pct}%` }} /></div>
                  <span className="w-9 text-right text-xs text-muted-foreground">{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}
