/**
 * Turns a flat list of trace log lines into the hops a waterfall renders.
 *
 * A trace arrives as an ordered list of spans. Some come in pairs — `relay_sent`
 * is answered by `relay_response` — and those become one bar with a real
 * duration. Everything else (`server_received`, `response_sent`, orphans) is a
 * zero-width pin positioned along the same axis.
 *
 * Extracted from AdminObservability so the log explorer's detail panel and the
 * standalone trace view share one implementation, and so the pairing rules —
 * which are the fiddliest part of the whole feature — can be tested. They were
 * previously inline in a 900-line page component with no coverage.
 *
 * Typed against a structural subset of a log row, so both the legacy
 * `AdminLogEntry` and the newer `LogRow` satisfy it without a cast.
 */

export interface HopLog {
  id: string;
  timestamp: string;
  spanName: string | null;
  action: string | null;
  instanceId: string | null;
  targetSlot: string | null;
  sourceSlot: string | null;
  success: boolean | null;
  error: string | null;
}

export interface Hop<T extends HopLog = HopLog> {
  id: string;
  kind: 'pair' | 'single';
  label: string;
  spanName: string;
  /** Milliseconds from the first log line in the trace. */
  startMs: number;
  endMs: number;
  startLog: T;
  endLog: T | null;
  action: string | null;
  instance: string | null;
  targetSlot: string | null;
  sourceSlot: string | null;
  success: boolean | null;
  error: string | null;
  children: T[];
}

/** Spans that open a measurable interval, mapped to the span that closes it. */
export const SPAN_PAIRS: Record<string, string> = {
  relay_sent: 'relay_response',
  pubsub_sent: 'pubsub_received',
};

const SPAN_CLOSERS = new Set(Object.values(SPAN_PAIRS));

export function labelFor(spanName: string): string {
  if (spanName === 'relay_sent') return 'relay';
  if (spanName === 'pubsub_sent') return 'pubsub';
  return spanName || 'log';
}

/**
 * Pair opener spans with their closers and lay everything out on a time axis.
 *
 * Matching walks the open hops newest-first and relaxes in three steps:
 * span + action + slot, then span + action, then span alone. A trace can carry
 * several concurrent relay round-trips for different actions, so the strict
 * match is tried first; without the fallbacks a slot rename would silently
 * orphan every hop.
 */
export function pairSpans<T extends HopLog>(logs: T[], baseTime: number): Array<Hop<T>> {
  const hops: Array<Hop<T>> = [];
  const open: Array<Hop<T>> = [];
  const counters: Record<string, number> = {};

  const makeSingle = (log: T, offset: number): Hop<T> => ({
    id: log.id || `${log.timestamp}-${log.spanName || 'log'}`,
    kind: 'single',
    label: labelFor(log.spanName || ''),
    spanName: log.spanName || '',
    startMs: offset,
    endMs: offset,
    startLog: log,
    endLog: null,
    action: log.action,
    instance: log.instanceId,
    targetSlot: log.targetSlot,
    sourceSlot: log.sourceSlot,
    success: log.success,
    error: log.error,
    children: [log],
  });

  for (const log of logs) {
    const offset = new Date(log.timestamp).getTime() - baseTime;
    const span = log.spanName || '';

    if (span in SPAN_PAIRS) {
      counters[span] = (counters[span] ?? 0) + 1;
      const hop: Hop<T> = {
        id: log.id || `${log.timestamp}-${span}-${counters[span]}`,
        kind: 'pair',
        label: `${labelFor(span)} hop #${counters[span]}`,
        spanName: span,
        startMs: offset,
        endMs: offset,
        startLog: log,
        endLog: null,
        action: log.action,
        instance: log.instanceId,
        targetSlot: log.targetSlot,
        sourceSlot: log.sourceSlot,
        success: null,
        error: null,
        children: [log],
      };
      open.push(hop);
      hops.push(hop);
      continue;
    }

    if (SPAN_CLOSERS.has(span)) {
      const openerSpan = Object.keys(SPAN_PAIRS).find((k) => SPAN_PAIRS[k] === span);

      // Strictest first: same span, same action, and the closer's sourceSlot
      // matching the opener's targetSlot.
      let matchedIdx = -1;
      for (let i = open.length - 1; i >= 0; i--) {
        const h = open[i];
        if (h.spanName !== openerSpan) continue;
        if (h.action !== log.action) continue;
        if ((h.targetSlot ?? null) !== (log.sourceSlot ?? null)) continue;
        matchedIdx = i;
        break;
      }
      // Relax: same span + action, ignoring slots.
      if (matchedIdx === -1) {
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i].spanName === openerSpan && open[i].action === log.action) {
            matchedIdx = i;
            break;
          }
        }
      }
      // Last resort: same span.
      if (matchedIdx === -1) {
        for (let i = open.length - 1; i >= 0; i--) {
          if (open[i].spanName === openerSpan) {
            matchedIdx = i;
            break;
          }
        }
      }

      if (matchedIdx !== -1) {
        const hop = open[matchedIdx];
        hop.endMs = offset;
        hop.endLog = log;
        hop.success = log.success;
        hop.error = log.error ?? hop.error;
        hop.children.push(log);
        // The closer usually knows which pod actually answered.
        if (log.instanceId) hop.instance = log.instanceId;
        open.splice(matchedIdx, 1);
        continue;
      }

      // No opener: render it anyway rather than dropping the line.
      hops.push(makeSingle(log, offset));
      continue;
    }

    hops.push(makeSingle(log, offset));
  }

  // A hop that never closed is a request that never came back — show it as
  // failed rather than as a zero-length bar with no explanation.
  for (const hop of open) {
    if (hop.endLog === null) {
      hop.success = false;
      hop.error = hop.error ?? 'no matching response span';
      hop.endMs = hop.startMs;
    }
  }

  return hops;
}

/** Tailwind background class for a hop's bar. */
export function barColor(hop: Pick<Hop, 'success' | 'spanName'>): string {
  if (hop.success === false) return 'bg-red-400';
  if (hop.spanName === 'pubsub_sent') return 'bg-purple-400';
  if (hop.spanName === 'relay_sent') return 'bg-blue-400';
  if (hop.spanName === 'server_received') return 'bg-emerald-400';
  if (hop.spanName === 'response_sent') return 'bg-emerald-400';
  return 'bg-gray-400';
}

export interface TraceShape<T extends HopLog = HopLog> {
  hops: Array<Hop<T>>;
  baseTime: number;
  totalMs: number;
}

/**
 * Build the whole waterfall from a trace's log rows.
 *
 * `totalMs` spans the last hop end rather than the last log timestamp, so a
 * dangling opener does not stretch the axis to nothing.
 */
export function buildTraceShape<T extends HopLog>(logs: T[]): TraceShape<T> {
  if (!logs.length) return { hops: [], baseTime: 0, totalMs: 0 };

  const ordered = [...logs].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const baseTime = new Date(ordered[0].timestamp).getTime();
  const hops = pairSpans(ordered, baseTime);
  const totalMs = hops.reduce((max, h) => Math.max(max, h.endMs), 0);
  return { hops, baseTime, totalMs };
}
