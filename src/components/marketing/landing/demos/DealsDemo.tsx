/** The Smart Deal card: pick a matched accessory, hover the price history. */
import { useState } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import { cx } from './util';

const DEALS = [
  { id: 'yale', name: 'Yale Assure Lock 2 with Apple Home Key', tier: 'Great Deal', price: 199.99, was: 279.99, note: 'Near all-time low', history: [279.99, 279.99, 274.99, 269.99, 259.99, 249.99, 239.99, 229.99, 209.99, 199.99, 199.99, 199.99] },
  { id: 'hue', name: 'Philips Hue White Ambiance E27, 2-pack', tier: 'Good Deal', price: 32.99, was: 39.99, note: 'Lowest in 90 days', history: [39.99, 39.99, 37.99, 39.99, 36.49, 35.99, 35.99, 34.99, 33.99, 32.99, 32.99, 32.99] },
  { id: 'eve', name: 'Eve Motion (Matter)', tier: 'Price Drop', price: 39.95, was: 49.95, note: '20% below the usual price', history: [49.95, 49.95, 49.95, 47.95, 49.95, 49.95, 44.95, 44.95, 42.95, 41.95, 39.95, 39.95] },
];
const WEEKS = DEALS[0].history.length;

export function DealsDemo() {
  const [id, setId] = useState(DEALS[0].id);
  const [hover, setHover] = useState<number | null>(null);
  const deal = DEALS.find((d) => d.id === id) ?? DEALS[0];

  const W = 260, H = 90;
  const lo = Math.min(...deal.history) * 0.97, hi = Math.max(...deal.history) * 1.03;
  const pt = (v: number, i: number) => [(i / (WEEKS - 1)) * W, H - ((v - lo) / (hi - lo)) * H] as const;
  const points = deal.history.map(pt);
  const line = points.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const off = Math.round((1 - deal.price / deal.was) * 100);
  const ago = hover === null ? null : WEEKS - 1 - hover;

  return (
    <div className="w-full max-w-[320px]">
      <div className="mb-2 flex flex-wrap gap-1.5">
        {DEALS.map((d) => (
          <button key={d.id} type="button" onClick={() => setId(d.id)} aria-pressed={d.id === id}
            className={cx('rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors', d.id === id ? 'border-orange-400 bg-orange-500/10 text-orange-600 dark:text-orange-400' : 'border-border text-muted-foreground hover:text-foreground')}>
            {d.name.split(' ').slice(0, 2).join(' ')}
          </button>
        ))}
      </div>
      <div className="rounded-2xl border border-border bg-card p-5 shadow-lg">
        <h3 className="text-lg font-semibold leading-snug">{deal.name}</h3>
        <div className="mt-1.5 flex items-center gap-1.5 text-sm font-medium text-orange-500"><Star className="h-4 w-4 fill-amber-400 text-amber-400" /> {deal.tier}</div>

        <div className="relative mt-3">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-[90px] w-full overflow-visible" preserveAspectRatio="none"
            onMouseMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.round(((e.clientX - r.left) / r.width) * (WEEKS - 1))); }}
            onMouseLeave={() => setHover(null)}>
            <defs><linearGradient id="dealFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f97316" stopOpacity="0.25" /><stop offset="100%" stopColor="#f97316" stopOpacity="0" /></linearGradient></defs>
            <path d={`${line} L${W},${H} L0,${H} Z`} fill="url(#dealFill)" />
            <path d={line} fill="none" stroke="#f97316" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            {hover !== null && (
              <g>
                <line x1={points[hover][0]} x2={points[hover][0]} y1="0" y2={H} stroke="hsl(var(--muted-foreground))" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
                <circle cx={points[hover][0]} cy={points[hover][1]} r="3" fill="#f97316" vectorEffect="non-scaling-stroke" />
              </g>
            )}
          </svg>
          <div className={cx('pointer-events-none absolute -top-1 rounded-md border border-border bg-popover px-2 py-1 text-[11px] shadow-sm transition-opacity', hover === null && 'opacity-0')}
            style={{ left: `${((hover ?? 0) / (WEEKS - 1)) * 100}%`, transform: `translateX(${(hover ?? 0) > WEEKS / 2 ? '-100%' : '0'})` }}>
            <span className="font-medium">${hover === null ? '' : deal.history[hover].toFixed(2)}</span> <span className="text-muted-foreground">· {ago === 0 ? 'today' : `${ago}w ago`}</span>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <span className="text-3xl font-bold text-orange-500">${deal.price.toFixed(2)}</span>
          <span className="text-muted-foreground line-through">${deal.was.toFixed(2)}</span>
          <span className="rounded-md bg-orange-500 px-2 py-0.5 text-xs font-semibold text-white">{off}% off</span>
        </div>
        <div className="mt-1.5 text-sm font-medium text-orange-500">{deal.note}</div>
        <button type="button" className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-amber-500 text-base font-semibold text-black transition-colors hover:bg-amber-400">
          View on Amazon <ExternalLink className="h-4 w-4" />
        </button>
        <div className="mt-2 text-center text-xs text-muted-foreground">Smart Deal · helps support Homecast</div>
      </div>
    </div>
  );
}
