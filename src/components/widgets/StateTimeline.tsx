import { useMemo } from 'react';
import type { HistoryStateSpanData, HistoryStateBucketData } from '@/lib/graphql/types';

/**
 * Timeline strip for bool/enum characteristic history — the mark an area
 * chart gets wrong. A lock is a sequence of states with durations, not a
 * quantity; this renders exactly that. CSS bars, no charting library
 * (pattern from the admin uptime TimelineStrip), so unlike HistoryChart it
 * costs nothing to load.
 *
 * Raw tier: one segment per state span. Rolled tiers: one cell per bucket —
 * bools show their on-fraction as fill, enums show the dominant state.
 */

// Value 0 is "off/idle" everywhere in HomeKit's enums; non-zero states get
// distinguishable accents that hold up in both themes.
const STATE_COLORS = [
  'hsl(var(--muted-foreground) / 0.25)',
  'hsl(var(--primary))',
  '#f59e0b',
  '#8b5cf6',
  '#ef4444',
  '#10b981',
];

export function stateColor(value: number): string {
  const idx = Math.abs(Math.round(value)) % STATE_COLORS.length;
  return STATE_COLORS[idx];
}

export interface StateTimelineProps {
  fromTs: number;
  toTs: number;
  prevValue: number | null;
  states?: HistoryStateSpanData[];
  stateBuckets?: HistoryStateBucketData[];
  /** Human name for a state code (from ENUM_LABELS / boolean semantics). */
  labelFor: (value: number) => string;
}

interface Segment {
  leftPct: number;
  widthPct: number;
  value: number;
  fraction: number; // bool buckets: on-fraction; spans: 1
}

export default function StateTimeline({
  fromTs, toTs, prevValue, states, stateBuckets, labelFor,
}: StateTimelineProps) {
  const span = Math.max(toTs - fromTs, 1);

  const segments = useMemo((): Segment[] => {
    if (states && states.length > 0) {
      const out: Segment[] = [];
      // The value the range opened with holds until the first transition.
      const opening = prevValue;
      if (opening !== null && states[0].ts > fromTs) {
        out.push({
          leftPct: 0,
          widthPct: ((states[0].ts - fromTs) / span) * 100,
          value: opening,
          fraction: 1,
        });
      }
      for (let i = 0; i < states.length; i++) {
        const start = Math.max(states[i].ts, fromTs);
        const end = i + 1 < states.length ? states[i + 1].ts : toTs;
        if (end <= start) continue;
        out.push({
          leftPct: ((start - fromTs) / span) * 100,
          widthPct: ((end - start) / span) * 100,
          value: states[i].value,
          fraction: 1,
        });
      }
      return out;
    }
    if (stateBuckets && stateBuckets.length > 0) {
      return stateBuckets.map((b, i) => {
        const end = i + 1 < stateBuckets.length ? stateBuckets[i + 1].ts : toTs;
        let fraction = 1;
        try {
          const stateMs = JSON.parse(b.stateMsJson) as Record<string, number>;
          const total = Object.values(stateMs).reduce((a, x) => a + x, 0);
          const active = total - (stateMs['0'] ?? 0);
          fraction = total > 0 ? active / total : 1;
        } catch { /* dominant-only cell */ }
        return {
          leftPct: ((b.ts - fromTs) / span) * 100,
          widthPct: ((end - b.ts) / span) * 100,
          value: b.dominant,
          fraction,
        };
      });
    }
    return [];
  }, [states, stateBuckets, prevValue, fromTs, toTs, span]);

  if (segments.length === 0) {
    return (
      <div className="h-8 rounded-md border border-dashed flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No recorded activity in this range</span>
      </div>
    );
  }

  return (
    <div className="relative h-8 rounded-md overflow-hidden bg-muted/40">
      {segments.map((seg, i) => {
        // Raw spans state their value outright. Rolled cells shade by how
        // much of the bucket was spent in a non-idle state, coloured by the
        // dominant one — a heat strip, not a bar chart.
        const isSpan = seg.fraction === 1 && states && states.length > 0;
        const idle = isSpan ? seg.value === 0 : seg.fraction === 0;
        const color = idle
          ? stateColor(0)
          : stateColor(seg.value === 0 ? 1 : seg.value);
        const opacity = isSpan || idle ? 1 : Math.max(seg.fraction, 0.12);
        return (
          <div
            key={i}
            className="absolute inset-y-0"
            style={{
              left: `${seg.leftPct}%`,
              width: `${Math.max(seg.widthPct, 0.15)}%`,
              backgroundColor: color,
              opacity,
            }}
            title={`${labelFor(seg.value)} — ${new Date(fromTs + (seg.leftPct / 100) * span).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}`}
          />
        );
      })}
    </div>
  );
}
