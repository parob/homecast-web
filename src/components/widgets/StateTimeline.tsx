import { useMemo, useRef, useState } from 'react';
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

// String states have no numeric identity — colour by a stable hash of the
// text so "Movie Night" keeps its accent across ranges. Rest-y vocabulary
// reads as idle gray, matching value-0 semantics.
const IDLE_TEXT = new Set(['idle', 'off', 'none', 'inactive']);

export function stateColorForText(text: string): string {
  if (IDLE_TEXT.has(text.toLowerCase())) return STATE_COLORS[0];
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return STATE_COLORS[1 + (h % (STATE_COLORS.length - 1))];
}

export interface StateTimelineProps {
  fromTs: number;
  toTs: number;
  /**
   * Insets matching the chart's plot area above, so a vertical read at one
   * instant lines up across every panel. A strip that spans the full card
   * while the chart above it starts after a Y-axis gutter cannot be
   * compared by eye, which is the whole point of stacking them.
   */
  padLeft?: number;
  padRight?: number;
  prevValue: number | null;
  /** string kind: the LOCF seed's text. */
  prevValueText?: string | null;
  states?: HistoryStateSpanData[];
  stateBuckets?: HistoryStateBucketData[];
  /**
   * Human name for a state (code from ENUM_LABELS / boolean semantics;
   * string-kind segments pass their text as the second argument).
   *
   * `fraction` is how full the segment is drawn — how much of a rolled bucket
   * was spent active, or, for a group strip, how many of its members were on.
   * A caller whose fill means something must be able to say what: the group
   * strip reported "On" over a bar with nothing in it, because the shading
   * carried the answer and the readout could not see it.
   */
  labelFor: (value: number, text?: string | null, fraction?: number) => string;
}

export interface Segment {
  leftPct: number;
  widthPct: number;
  value: number;
  /** string kind: the state's text (value is the 0 sentinel). */
  text?: string | null;
  fraction: number; // bool buckets: on-fraction; spans: 1
}

/**
 * Join neighbouring segments that hold the SAME state into one run.
 *
 * A state series is not one row per state change: a device re-reporting the
 * value it already had writes another span, and a rolled tier emits one
 * bucket per hour whether or not anything happened. Either way a single
 * unbroken stretch of Cool — or On, or Locked — arrived as a dozen
 * neighbouring pieces. Identical fill made that invisible until you hovered
 * and were told "Cool · 1h" about a run that had lasted all afternoon.
 *
 * Applies to every categorical characteristic, not just booleans: segments
 * merge on value (or text, for the string kind). Bucket shading survives as
 * a width-weighted mean, so a merged run is as pale as its parts were.
 */
export function coalesce(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    const sameState = prev && prev.value === seg.value && (prev.text ?? null) === (seg.text ?? null)
      // Same state but a different FILL is a different reading: a group strip
      // shades by how many members are on, and averaging those together drew
      // a whole day as one flat block.
      && Math.abs(prev.fraction - seg.fraction) < 0.005;
    // Only join pieces that actually touch — a gap between them is recorded
    // silence, and closing it would invent history.
    const contiguous = prev && Math.abs(prev.leftPct + prev.widthPct - seg.leftPct) < 0.001;
    if (sameState && contiguous) {
      const total = prev.widthPct + seg.widthPct;
      prev.fraction = (prev.fraction * prev.widthPct + seg.fraction * seg.widthPct) / total;
      prev.widthPct = total;
    } else {
      out.push({ ...seg });
    }
  }
  return out;
}

export default function StateTimeline({
  fromTs, toTs, prevValue, prevValueText, states, stateBuckets, labelFor,
  padLeft = 0, padRight = 0,
}: StateTimelineProps) {
  const span = Math.max(toTs - fromTs, 1);
  const trackRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<{ xPct: number; index: number } | null>(null);

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
          text: prevValueText ?? null,
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
          text: states[i].valueText ?? null,
          fraction: 1,
        });
      }
      return coalesce(out);
    }
    if ((!stateBuckets || stateBuckets.length === 0) && prevValue !== null) {
      // Nothing changed in this window — but the state was known throughout.
      // Drawing nothing said "no recorded activity", which is a different
      // claim entirely.
      return [{ leftPct: 0, widthPct: 100, value: prevValue, text: prevValueText ?? null, fraction: 1 }];
    }
    if (stateBuckets && stateBuckets.length > 0) {
      return coalesce(stateBuckets.map((b, i) => {
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
          text: b.dominantText ?? null,
          fraction,
        };
      }));
    }
    return [];
  }, [states, stateBuckets, prevValue, prevValueText, fromTs, toTs, span]);

  if (segments.length === 0) {
    return (
      <div className="h-8 rounded-md border border-dashed flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No recorded activity in this range</span>
      </div>
    );
  }

  const leadingGapPct = segments[0]?.leftPct ?? 0;
  const hoveredSegment = hover !== null ? segments[hover.index] : undefined;
  const hoverStart = hoveredSegment ? fromTs + (hoveredSegment.leftPct / 100) * span : 0;
  const hoverEnd = hoveredSegment ? hoverStart + (hoveredSegment.widthPct / 100) * span : 0;
  // Where the pointer actually is, not where its segment starts. The strip
  // was answering "what state, and how long did that run last" while the
  // charts stacked above it answer "at 09:24, this" — reading them together
  // meant guessing which instant the strip was talking about.
  const hoverTs = hover !== null ? fromTs + (hover.xPct / 100) * span : 0;
  const timeAt = (ts: number) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  // The chart tooltips above name the day whenever the window crosses one.
  // Same rule here, so the two headers read alike.
  const stampAt = (ts: number) => new Date(ts).toLocaleString(undefined, span > 36 * 3_600_000
    ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
  const durationOf = (ms: number) => {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 48) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  };

  return (
    <div className="relative" style={{ paddingLeft: padLeft, paddingRight: padRight }}>
      {/* Readout above the strip: which state, for how long, when. The
          native title attribute took a second to appear and said none of
          the duration, which is the question people actually have. */}
      {hoveredSegment && (
        <div
          className="pointer-events-none absolute -top-11 z-20 whitespace-nowrap rounded-md border bg-background/95 px-2 py-1 text-[11px] leading-snug shadow-sm backdrop-blur"
          style={{
            // Percent of the TRACK, not of the padded container — the two
            // differ by the axis gutter and the label would drift right.
            left: `calc(${padLeft}px + (100% - ${padLeft + padRight}px) * ${hover!.xPct / 100})`,
            transform: `translateX(${hover!.xPct > 70 ? '-100%' : hover!.xPct < 8 ? '0' : '-50%'})`,
          }}
        >
          <div className="font-medium">{stampAt(hoverTs)}</div>
          <div>
            <span className="font-medium">{labelFor(hoveredSegment.value, hoveredSegment.text, hoveredSegment.fraction)}</span>
            <span className="text-muted-foreground">
              {' · '}{durationOf(hoverEnd - hoverStart)}{' · '}{timeAt(hoverStart)}–{timeAt(hoverEnd)}
            </span>
          </div>
        </div>
      )}
      <div
        ref={trackRef}
        data-testid="state-timeline"
        className="relative h-8 rounded-md overflow-hidden bg-muted/40"
        onMouseMove={(e) => {
          const rect = trackRef.current?.getBoundingClientRect();
          if (!rect || rect.width === 0) return;
          const xPct = ((e.clientX - rect.left) / rect.width) * 100;
          const index = segments.findIndex(seg => xPct >= seg.leftPct && xPct < seg.leftPct + seg.widthPct);
          setHover(index >= 0 ? { xPct, index } : null);
        }}
        onMouseLeave={() => setHover(null)}
      >
      {leadingGapPct > 5 && (
        // Same statement the charts make above: bare track at the left of a
        // long window is not "off", it is "we weren't recording yet".
        <div
          className="absolute inset-y-0 left-0 z-10 flex items-center px-1.5"
          style={{ width: `${leadingGapPct}%` }}
        >
          <span className="text-[10px] text-muted-foreground truncate">No Data</span>
        </div>
      )}
      {hover && (
        // Crosshair: the same instant the charts above are being read at.
        <div
          className="absolute inset-y-0 z-10 w-px bg-foreground/40"
          style={{ left: `${hover.xPct}%` }}
        />
      )}
      {segments.map((seg, i) => {
        // Raw spans state their value outright. Rolled cells shade by how
        // much of the bucket was spent in a non-idle state, coloured by the
        // dominant one — a heat strip, not a bar chart.
        const isSpan = seg.fraction === 1 && states && states.length > 0;
        const idle = seg.text != null
          ? IDLE_TEXT.has(seg.text.toLowerCase())
          : isSpan ? seg.value === 0 : seg.fraction === 0;
        const color = seg.text != null
          ? stateColorForText(seg.text)
          : idle
            ? stateColor(0)
            : stateColor(seg.value === 0 ? 1 : seg.value);
        const opacity = isSpan || idle || seg.text != null ? 1 : Math.max(seg.fraction, 0.12);
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
          />
        );
      })}
      </div>
    </div>
  );
}
