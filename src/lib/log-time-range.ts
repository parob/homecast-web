/**
 * Time-range handling for the log explorer.
 *
 * The range is the single most expensive input to a log query — it decides how
 * many BigQuery partitions get scanned — so it is modelled explicitly rather
 * than being derived ad hoc in the page. Kept pure so the histogram's
 * drag-to-zoom arithmetic can be tested.
 *
 * A range is either relative (`last 1h`, re-evaluated on every query so live
 * data keeps arriving) or absolute (pinned, so a shared URL shows what the
 * sender saw).
 */

export interface RelativeRange {
  kind: 'relative';
  /** Seconds back from now. */
  seconds: number;
}

export interface AbsoluteRange {
  kind: 'absolute';
  startMs: number;
  endMs: number;
}

export type TimeRange = RelativeRange | AbsoluteRange;

export interface ResolvedRange {
  startMs: number;
  endMs: number;
  startIso: string;
  endIso: string;
}

export const PRESETS: Array<{ label: string; seconds: number }> = [
  { label: '5m', seconds: 300 },
  { label: '15m', seconds: 900 },
  { label: '1h', seconds: 3600 },
  { label: '4h', seconds: 14400 },
  { label: '24h', seconds: 86400 },
  { label: '3d', seconds: 259200 },
  { label: '7d', seconds: 604800 },
  { label: '30d', seconds: 2592000 },
];

export const DEFAULT_RANGE: TimeRange = { kind: 'relative', seconds: 3600 };

/**
 * Cloud Logging's `_Default` bucket retains 30 days, so anything older cannot
 * return rows however wide the query is.
 */
export const MAX_LOOKBACK_SECONDS = 2592000;

export function resolveRange(range: TimeRange, now = Date.now()): ResolvedRange {
  if (range.kind === 'absolute') {
    const startMs = Math.min(range.startMs, range.endMs);
    const endMs = Math.max(range.startMs, range.endMs);
    return { startMs, endMs, startIso: iso(startMs), endIso: iso(endMs) };
  }
  const seconds = Math.min(range.seconds, MAX_LOOKBACK_SECONDS);
  const startMs = now - seconds * 1000;
  return { startMs, endMs: now, startIso: iso(startMs), endIso: iso(now) };
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function rangeLabel(range: TimeRange): string {
  if (range.kind === 'relative') {
    const preset = PRESETS.find((p) => p.seconds === range.seconds);
    return preset ? `Last ${preset.label}` : `Last ${formatDuration(range.seconds * 1000)}`;
  }
  return `${shortTime(range.startMs)} → ${shortTime(range.endMs)}`;
}

function shortTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}

/**
 * Convert a drag across the histogram into an absolute range.
 *
 * Returns null when the selection is too narrow to be deliberate — without that
 * guard an ordinary click registers as a zero-width range and empties the page.
 */
export function rangeFromDrag(
  fromMs: number,
  toMs: number,
  minimumMs = 1000,
): AbsoluteRange | null {
  const startMs = Math.min(fromMs, toMs);
  const endMs = Math.max(fromMs, toMs);
  if (endMs - startMs < minimumMs) return null;
  return { kind: 'absolute', startMs, endMs };
}

/** Widen an absolute range around its midpoint, for a zoom-out control. */
export function zoomOut(range: TimeRange, factor = 2, now = Date.now()): TimeRange {
  if (range.kind === 'relative') {
    return { kind: 'relative', seconds: Math.min(range.seconds * factor, MAX_LOOKBACK_SECONDS) };
  }
  const { startMs, endMs } = resolveRange(range, now);
  const mid = (startMs + endMs) / 2;
  const half = ((endMs - startMs) * factor) / 2;
  return { kind: 'absolute', startMs: Math.round(mid - half), endMs: Math.round(mid + half) };
}

/**
 * Centre a window on one log line, for "show me what happened around this".
 */
export function rangeAround(timestampMs: number, windowMs = 60_000): AbsoluteRange {
  return {
    kind: 'absolute',
    startMs: timestampMs - windowMs / 2,
    endMs: timestampMs + windowMs / 2,
  };
}

/** Serialise into URL params. Relative ranges stay relative so links stay live. */
export function rangeToParams(range: TimeRange): Record<string, string> {
  return range.kind === 'relative'
    ? { range: `${range.seconds}s` }
    : { from: String(range.startMs), to: String(range.endMs) };
}

export function rangeFromParams(params: URLSearchParams): TimeRange | null {
  const from = params.get('from');
  const to = params.get('to');
  if (from && to && !Number.isNaN(Number(from)) && !Number.isNaN(Number(to))) {
    return { kind: 'absolute', startMs: Number(from), endMs: Number(to) };
  }
  const relative = params.get('range');
  if (relative) {
    const seconds = Number(relative.replace(/s$/, ''));
    if (Number.isFinite(seconds) && seconds > 0) return { kind: 'relative', seconds };
  }
  return null;
}
