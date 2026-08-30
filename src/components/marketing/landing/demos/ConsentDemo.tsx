/** The OAuth consent page: choose homes and permissions, then authorise — or revoke. */
import { useState } from 'react';
import { Asterisk, Home, Eye, Zap, ExternalLink, X, Check } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Panel } from './bits';
import { cx } from './util';

type Perm = 'view' | 'control';
const HOMES = ['My Home', 'Beach House'];

export function ConsentDemo() {
  const [picked, setPicked] = useState<Record<string, boolean>>({ 'My Home': true, 'Beach House': true });
  const [perm, setPerm] = useState<Record<string, Perm>>({ 'My Home': 'control', 'Beach House': 'control' });
  const [status, setStatus] = useState<'pending' | 'authorized' | 'denied'>('pending');

  const chosen = HOMES.filter((h) => picked[h]);
  const control = chosen.filter((h) => perm[h] === 'control');
  const homes = (n: number) => `${n} home${n === 1 ? '' : 's'}`;

  if (status !== 'pending') {
    const ok = status === 'authorized';
    return (
      <Panel className="max-w-[400px] text-center">
        <div className={cx('mx-auto flex h-12 w-12 items-center justify-center rounded-full', ok ? 'bg-emerald-500/15 text-emerald-600' : 'bg-muted text-muted-foreground')}>
          {ok ? <Check className="h-6 w-6" /> : <X className="h-6 w-6" />}
        </div>
        <h3 className="mt-4 text-lg font-semibold">{ok ? 'Claude is connected' : 'Access denied'}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {ok ? `${homes(chosen.length)} shared — ${control.length} with full control. Revoke at any time from Settings → Account.` : 'Nothing was shared.'}
        </p>
        <button type="button" onClick={() => setStatus('pending')} className="mt-5 rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted">
          {ok ? 'Revoke access' : 'Try again'}
        </button>
      </Panel>
    );
  }

  return (
    <Panel className="max-w-[400px] bg-muted/30">
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-orange-100 text-orange-500 dark:bg-orange-950">
        <Asterisk className="h-7 w-7" strokeWidth={2.5} />
      </div>
      <h3 className="mt-3 text-center text-lg font-semibold">Authorize Claude</h3>
      <p className="text-center text-sm text-muted-foreground"><span className="text-foreground">Claude</span> is requesting access to your Homecast account</p>

      <div className="mt-5 text-sm text-muted-foreground">Select homes and permissions:</div>
      <div className="mt-2 divide-y divide-border rounded-lg border border-border bg-background">
        {HOMES.map((h) => (
          <div key={h} className="p-3">
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <Checkbox checked={!!picked[h]} onCheckedChange={(v) => setPicked((p) => ({ ...p, [h]: v === true }))} />
              <Home className="h-4 w-4 text-primary" /> {h}
            </label>
            <div className={cx('ml-11 mt-2 flex gap-1.5 transition-opacity', !picked[h] && 'pointer-events-none opacity-40')}>
              {(['view', 'control'] as Perm[]).map((p) => {
                const on = perm[h] === p;
                return (
                  <button key={p} type="button" onClick={() => setPerm((x) => ({ ...x, [h]: p }))} aria-pressed={on}
                    className={cx('inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors', on ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                    {p === 'view' ? <Eye className="h-3.5 w-3.5" /> : <Zap className="h-3.5 w-3.5" />}
                    {p === 'view' ? 'View only' : 'Full control'}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 text-sm text-muted-foreground">This application will be able to:</div>
      <ul className="mt-1.5 space-y-1 text-sm">
        <li className="flex items-center gap-2"><Eye className="h-4 w-4 text-primary" /> View accessories and states ({homes(chosen.length)})</li>
        <li className={cx('flex items-center gap-2', control.length === 0 && 'text-muted-foreground line-through')}><Zap className="h-4 w-4 text-primary" /> Control accessories ({homes(control.length)})</li>
      </ul>
      <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ExternalLink className="h-3.5 w-3.5" /> Will redirect to: <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700 dark:text-emerald-400">claude.ai</span>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => setStatus('denied')} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary/10 text-sm font-medium hover:bg-primary/15"><X className="h-4 w-4" /> Deny</button>
        <button type="button" onClick={() => setStatus('authorized')} disabled={chosen.length === 0} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"><Check className="h-4 w-4" /> Authorize</button>
      </div>
    </Panel>
  );
}
