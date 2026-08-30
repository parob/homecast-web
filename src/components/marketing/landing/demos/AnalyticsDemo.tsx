/** The Analytics temperature chart: pick a range, toggle a series, hover a reading. */
import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ChevronRight } from 'lucide-react';
import { cx } from './util';

const RANGES = [
  { id: '6h', points: 36, label: (i: number) => `${String((14 + Math.floor(i / 6)) % 24).padStart(2, '0')}:${String((i % 6) * 10).padStart(2, '0')}` },
  { id: '24h', points: 48, label: (i: number) => `${String((20 + Math.floor(i / 2)) % 24).padStart(2, '0')}:${i % 2 ? '30' : '00'}` },
  { id: '7d', points: 56, label: (i: number) => ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][Math.floor(i / 8)] },
  { id: '30d', points: 60, label: (i: number) => `${1 + Math.floor(i / 2)} Aug` },
];
const SERIES = [
  { id: 'ufh', name: 'Underfloor Heating', color: '#3b82f6', base: 22.5, amp: 1.6, phase: 0.2 },
  { id: 'target', name: 'Target', color: '#f59e0b', base: 21, amp: 1.2, phase: 0.6 },
  { id: 'rad', name: 'Ensuite Radiator', color: '#8b5cf6', base: 22.8, amp: 1.1, phase: 0.1 },
  { id: 'ac', name: 'Air Conditioner', color: '#10b981', base: 24, amp: 1.4, phase: -0.3 },
];

// Deterministic, so the chart is the same on every visit.
const rand = (seed: number) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

function build(range: (typeof RANGES)[number]) {
  const r = rand(range.points * 7);
  return Array.from({ length: range.points }, (_, i) => {
    const row: Record<string, number | string> = { t: range.label(i) };
    const x = (i / range.points) * Math.PI * 2;
    for (const s of SERIES) row[s.id] = Math.round((s.base + s.amp * Math.sin(x - 1.2 + s.phase) + (r() - 0.5) * 0.5) * 10) / 10;
    return row;
  });
}

export function AnalyticsDemo() {
  const [range, setRange] = useState('24h');
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const data = useMemo(() => build(RANGES.find((x) => x.id === range) ?? RANGES[1]), [range]);
  const shown = SERIES.filter((s) => !hidden.has(s.id));
  const values = data.flatMap((d) => shown.map((s) => d[s.id] as number));
  const stat = (f: (a: number[]) => number) => (values.length ? f(values).toFixed(1) : '–');

  return (
    <div className="w-full max-w-[460px] rounded-2xl border border-border bg-card p-4 shadow-lg">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-sm"><span className="text-primary">Home</span><ChevronRight className="h-3.5 w-3.5 text-muted-foreground" /><span className="font-medium">Bedroom 2</span></span>
        <div className="flex rounded-full bg-muted p-0.5">
          {RANGES.map((x) => (
            <button key={x.id} type="button" onClick={() => setRange(x.id)} aria-pressed={x.id === range}
              className={cx('rounded-full px-2.5 py-1 text-xs font-medium transition-colors', x.id === range ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>{x.id}</button>
          ))}
        </div>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <span className="text-sm font-medium">Temperature</span>
        <span className="text-[11px] text-muted-foreground">{shown.length} sensors · raw readings</span>
      </div>
      <div className="mt-2 h-[170px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <XAxis dataKey="t" tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
            <YAxis tick={{ fontSize: 10, fill: 'hsl(var(--muted-foreground))' }} tickLine={false} axisLine={false} domain={['auto', 'auto']} unit="°" />
            <Tooltip contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 8, fontSize: 11, padding: '6px 8px' }} labelStyle={{ color: 'hsl(var(--muted-foreground))' }} formatter={(v: number) => [`${v}°`]} />
            {shown.map((s) => <Line key={s.id} type="stepAfter" dataKey={s.id} name={s.name} stroke={s.color} strokeWidth={1.5} dot={false} isAnimationActive={false} />)}
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {SERIES.map((s) => {
          const off = hidden.has(s.id);
          return (
            <button key={s.id} type="button" aria-pressed={!off}
              onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; })}
              className={cx('inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] transition-colors', off ? 'border-border text-muted-foreground' : 'border-border bg-muted/50')}>
              <span className={cx('h-2 w-2 rounded-full', off && 'opacity-30')} style={{ backgroundColor: s.color }} />{s.name}
            </button>
          );
        })}
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">min {stat((a) => Math.min(...a))}° · avg {stat((a) => a.reduce((x, y) => x + y, 0) / a.length)}° · max {stat((a) => Math.max(...a))}°</div>
    </div>
  );
}
