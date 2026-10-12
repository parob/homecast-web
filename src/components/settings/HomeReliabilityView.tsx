import { useState } from 'react';
import { CheckCircle2, Wifi, WifiOff } from 'lucide-react';
import { connectionLabel, checkLabel, checkExplanation, observedDuration, reliabilityPercent, type HomeReliability, type ReliabilityBucket } from '@/lib/reliability';

const dateTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dayKey = (value: string) => new Date(value).toDateString();
function total(buckets: ReliabilityBucket[], key: keyof Omit<ReliabilityBucket, 'bucketStart'>) {
  return buckets.reduce((sum, b) => sum + b[key], 0);
}

export function ConnectionBadge({ evidence }: { evidence: HomeReliability }) {
  const connected = evidence.connectionState === 'served';
  const Icon = connected ? Wifi : WifiOff;
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${connected ? 'bg-green-500/10 text-green-700 dark:text-green-400' : evidence.connectionState === 'offline' ? 'bg-red-500/10 text-red-700 dark:text-red-400' : 'bg-amber-500/10 text-amber-700 dark:text-amber-400'}`}><Icon className="h-3.5 w-3.5" />{connectionLabel(evidence.connectionState)}</span>;
}

function Legend({ entries }: { entries: [string, string][] }) {
  return <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted-foreground">{entries.map(([label, color]) => <span key={label} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-sm ${color}`} />{label}</span>)}</div>;
}

/** Shared by Settings → Reliability and the admin home detail. */
export function HomeReliabilityView({ evidence: r, admin = false }: { evidence: HomeReliability; admin?: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [showAllInterruptions, setShowAllInterruptions] = useState(false);
  const groups = new Map<string, ReliabilityBucket[]>();
  for (const bucket of r.timeline) {
    const key = dayKey(bucket.bucketStart);
    groups.set(key, [...(groups.get(key) ?? []), bucket]);
  }
  const selectedBuckets = selected ? groups.get(selected) : null;
  const week = r.windows.find(w => w.label === '7d');
  const hasHistory = r.windows.some(w => w.availabilityPercent != null);
  const explanation = checkExplanation(r.checkReason);
  const track = (checks: boolean) => <div className="flex gap-1 w-full" role="group" aria-label={checks ? 'Accessory checks by day' : 'Connection by day'}>
    {[...groups].map(([day, buckets]) => <button key={day} type="button" onClick={() => setSelected(selected === day ? null : day)} aria-pressed={selected === day} aria-label={`${checks ? 'Accessory checks' : 'Connection'}, ${day}`} className={`min-w-0 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${selected === day ? 'ring-2 ring-primary ring-offset-1 ring-offset-background' : ''}`} style={{ flex: buckets.length }}>
      <span className="flex h-7 gap-px overflow-hidden rounded-sm">{buckets.map(b => {
        const parts: [number, string][] = checks ? [[b.checksVerified, 'bg-emerald-500'], [b.checksFailed, 'bg-orange-500'], [b.checksInconclusive, 'bg-slate-400']] : [[b.connectedSeconds, 'bg-emerald-500'], [b.offlineSeconds, 'bg-red-500'], [b.unknownSeconds, 'bg-muted']];
        const sum = parts.reduce((n, [v]) => n + v, 0);
        return <span key={b.bucketStart} className="flex flex-1 min-w-0 flex-col bg-muted/40">{parts.map(([n, color], i) => n > 0 && <span key={i} className={color} style={{ height: `${n / sum * 100}%` }} />)}</span>;
      })}</span>
      {!checks && <span className="block truncate pt-1 text-[9px] text-muted-foreground">{new Date(buckets[0].bucketStart).toLocaleDateString(undefined, { weekday: 'short' })}</span>}
    </button>)}
  </div>;
  return <section aria-label="Home reliability" className="space-y-5 text-xs">
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2"><ConnectionBadge evidence={r} /><span className="text-[10px] text-muted-foreground">Updated {dateTime(r.asOf)}</span></div>
      <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className={`h-3.5 w-3.5 ${r.checkStatus === 'verified' ? 'text-emerald-600' : r.checkStatus === 'failed' ? 'text-orange-600' : 'text-muted-foreground'}`} />{checkLabel(r.checkStatus)}{r.checkedAt && <span className="font-normal text-muted-foreground">· {dateTime(r.checkedAt)}</span>}</div>
      {explanation && <p className="text-muted-foreground">{explanation}</p>}
      {r.checkStatus === 'verified' && <p className="text-muted-foreground">One accessory answered a live read. This does not verify every device.</p>}
    </div>
    <div className="space-y-2">
      <h3 className="font-semibold">Connection time</h3>
      <div className="grid grid-cols-3 gap-2">{r.windows.map(w => <div key={w.label} className="rounded-lg border bg-background/60 p-2.5 min-w-0">
        <div className="text-muted-foreground">{w.label}</div><div className="text-xl font-semibold tabular-nums mt-1">{reliabilityPercent(w.availabilityPercent)}</div>
        <div className="mt-1 text-[10px] text-muted-foreground">{w.availabilityPercent == null ? 'No history' : `${observedDuration(w.connectedSeconds + w.offlineSeconds)} observed`}</div>
        {w.availabilityPercent != null && <div className="text-[10px] text-muted-foreground">{reliabilityPercent(w.coveragePercent)} coverage</div>}
      </div>)}</div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">Connected time as a share of observed time. Gaps in recording are unknown and excluded from the percentage.</p>
    </div>
    {!hasHistory ? <div className="rounded-lg border border-dashed p-4 text-muted-foreground">No recorded history yet. Connection history will appear as the relay reports in.</div> : <div className="space-y-4">
      <div className="space-y-2"><div className="flex justify-between"><h3 className="font-semibold">Connection · last 7 days</h3><span className="text-muted-foreground">Tap a day</span></div>{track(false)}<Legend entries={[["Connected", "bg-emerald-500"], ["Disconnected", "bg-red-500"], ["Unknown", "bg-muted"]]} /></div>
      <div className="space-y-2"><h3 className="font-semibold">Accessory checks · last 7 days</h3>{track(true)}<Legend entries={[["Live read", "bg-emerald-500"], ["Failed check", "bg-orange-500"], ["Inconclusive", "bg-slate-400"], ["No check", "bg-muted/40"]]} /><p className="text-[10px] text-muted-foreground">{r.checksVerified} live reads · {r.checksFailed} failed · {r.checksInconclusive} inconclusive. Checks are samples, not downtime.</p></div>
      {selectedBuckets && <div className="rounded-lg border bg-background/60 p-3 space-y-1" aria-live="polite"><div className="flex justify-between gap-2 font-medium"><span>{selected}</span><button type="button" onClick={() => setSelected(null)} className="text-muted-foreground">Close</button></div><p>{observedDuration(total(selectedBuckets, 'connectedSeconds'))} connected · {observedDuration(total(selectedBuckets, 'offlineSeconds'))} disconnected · {observedDuration(total(selectedBuckets, 'unknownSeconds'))} unknown</p><p className="text-muted-foreground">{total(selectedBuckets, 'checksVerified')} live reads · {total(selectedBuckets, 'checksFailed')} failed · {total(selectedBuckets, 'checksInconclusive')} inconclusive</p></div>}
      <div className="space-y-2"><h3 className="font-semibold">Connection interruptions · last 7 days</h3>{r.interruptions.length ? r.interruptions.slice(0, showAllInterruptions ? undefined : 4).map(o => <div key={o.startedAt} className="flex flex-wrap items-center justify-between gap-1 rounded-lg border px-3 py-2"><span>{dateTime(o.startedAt)} → {o.endedAt ? dateTime(o.endedAt) : 'ongoing'}</span><span className="text-muted-foreground">{observedDuration(o.durationSeconds)}</span></div>) : <p className="text-muted-foreground">No disconnections recorded{week && week.coveragePercent < 99.95 ? ' during observed time' : ''}.</p>}{r.interruptions.length > 4 && <button type="button" className="text-primary" onClick={() => setShowAllInterruptions(!showAllInterruptions)}>{showAllInterruptions ? 'Show fewer' : `Show ${r.interruptions.length} most recent interruptions`}</button>}</div>
    </div>}
    {admin && <details className="text-[10px] text-muted-foreground"><summary className="cursor-pointer">Diagnostics</summary><div className="pt-2 space-y-1"><p>Last heard: {r.lastHeardAt ? dateTime(r.lastHeardAt) : 'Unknown'}</p><p>Earliest retained observation: {r.firstObservedAt ? dateTime(r.firstObservedAt) : 'None'}</p><p className="break-all">Check reason: {r.checkReason ?? 'None'}</p></div></details>}
  </section>;
}

/** Compact connection-only history for the fleet list; missing time stays gray. */
export function HomeConnectionStrip({ evidence }: { evidence: HomeReliability }) {
  const days = new Map<string, ReliabilityBucket[]>();
  for (const b of evidence.timeline) {
    const day = dayKey(b.bucketStart);
    days.set(day, [...(days.get(day) ?? []), b]);
  }
  return <div className="flex gap-0.5 h-5" aria-label="Connection history">{[...days].map(([day, buckets]) => {
    const connected = total(buckets, 'connectedSeconds'), offline = total(buckets, 'offlineSeconds'), unknown = total(buckets, 'unknownSeconds');
    const sum = connected + offline + unknown;
    return <div key={day} className="flex-1 rounded-sm overflow-hidden flex flex-col bg-muted" title={`${day}: ${observedDuration(connected)} connected, ${observedDuration(offline)} disconnected, ${observedDuration(unknown)} unknown`}>
      {connected > 0 && <div className="bg-emerald-500" style={{height: `${connected / sum * 100}%`}} />}
      {offline > 0 && <div className="bg-red-500" style={{height: `${offline / sum * 100}%`}} />}
    </div>;
  })}</div>;
}
