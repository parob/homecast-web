/**
 * A trace as a route through the machines that handled it.
 *
 * This replaces the eleven-fixed-stages model in `trace-stages.ts`, which drew
 * every architectural stage whether or not it happened — so most of the picture
 * was greyed-out absence, and the eye went to things that did not occur.
 *
 * The load-bearing idea here is that **a trace is one of three shapes**, and a
 * view that assumes only the first is why the old one confused people:
 *
 * | shape        | example                     | what the story is                    |
 * |--------------|-----------------------------|--------------------------------------|
 * | `request`    | 8 spans, 80ms               | where the time went                  |
 * | `repetition` | 13 spans, 4 attempts, 30s   | repetition and unexplained gaps      |
 * | `burst`      | 88 spans, 25 calls          | what never came back                 |
 *
 * Everything is pure and lives in the host app, because the cloud package has
 * no test runner of its own.
 */

/** The subset of a `LogRow` a route needs. `LogRow` satisfies this structurally. */
export interface TraceEvent {
  id: string;
  timestamp: string;
  severity?: string | null;
  message?: string | null;
  spanName?: string | null;
  action?: string | null;
  source?: string | null;
  latencyMs?: number | null;
  instanceId?: string | null;
  deviceId?: string | null;
  error?: string | null;
  routingMode?: string | null;
}

/** A `TraceEvent` with its offset from the start of the trace resolved. */
export interface TimedEvent extends TraceEvent {
  /** ms since the first event in the trace. */
  t: number;
  failed: boolean;
}

export type Shape = 'request' | 'repetition' | 'burst';

/** One interval between consecutive events, and who was holding the request. */
export interface Phase {
  from: TimedEvent;
  to: TimedEvent;
  at: number;
  end: number;
  ms: number;
  lane: string;
  label: string;
  /**
   * Nothing was logged between the two ends. This is the most interesting
   * property an interval can have — it is time nobody can account for.
   */
  unexplained: boolean;
}

/** Consecutive phases merged by lane: one leg of the journey. */
export interface Leg {
  lane: string;
  at: number;
  to: number;
  ms: number;
  parts: Phase[];
  events: TimedEvent[];
  failed: boolean;
  /** What it decomposes into, for the collapsed label. */
  summary: string;
}

/** A request to the relay and the answer, if one came. */
export interface Exchange {
  key: string;
  sentAt: number;
  backAt: number | null;
  ms: number | null;
  error: string | null;
}

export interface RouteModel {
  events: TimedEvent[];
  baseTime: number;
  totalMs: number;
  action: string | null;
  lanes: string[];
  phases: Phase[];
  legs: Leg[];
  exchanges: Exchange[];
  shape: Shape;
  /** How many times the request was routed. More than one means it was retried. */
  attempts: number;
  failure: { code: string; at: number } | null;
  /**
   * An answer that arrived after the client had already been given an error.
   * Worth surfacing on its own: it means the timeout and the retry budget
   * disagree, which is invisible in a plain waterfall.
   */
  lateAnswer: { at: number; afterMs: number } | null;
}

const CLIENT = 'client';
const RELAY = 'relay';
const podOf = (e: TraceEvent) => `pod ${e.instanceId?.split('-').pop() || '?'}`;

/** Which machine holds the request during the interval that *follows* an event. */
export function ownerAfter(e: TraceEvent): string {
  switch (e.spanName) {
    case 'relay_sent': return RELAY;
    case 'response_sent': return CLIENT;
    default: return podOf(e);
  }
}

/** The two machines an event travels between, for drawing handoffs. */
export function hopOf(e: TraceEvent): [string, string] {
  switch (e.spanName) {
    case 'server_received': return [CLIENT, podOf(e)];
    case 'response_sent': return [podOf(e), CLIENT];
    case 'relay_sent': return [podOf(e), RELAY];
    case 'relay_response': return [RELAY, podOf(e)];
    default: return [podOf(e), podOf(e)];
  }
}

function laneRank(lane: string): number {
  if (lane === CLIENT) return 0;
  if (lane === RELAY) return 2;
  return 1;
}

function labelAfter(e: TraceEvent): string {
  switch (e.spanName) {
    case 'server_received': return 'auth, home lookup, routing decision';
    case 'route_decision': return 'handing off to the owning pod';
    case 'relay_sent': return 'waiting for the relay Mac';
    case 'relay_response': return 'building and sending the reply';
    default: return `in ${e.spanName || e.source || 'the server'}`;
  }
}

const isFailure = (e: TraceEvent) => Boolean(e.error) || e.severity === 'ERROR';

/**
 * Build the route.
 *
 * Returns a fully-resolved model rather than a bag of helpers, so a component
 * never has to recompute a derived value and risk disagreeing with its sibling.
 */
export function buildRoute(rows: TraceEvent[]): RouteModel {
  const ordered = rows
    .filter((r) => !Number.isNaN(Date.parse(r.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (!ordered.length) {
    return {
      events: [], baseTime: 0, totalMs: 0, action: null, lanes: [], phases: [],
      legs: [], exchanges: [], shape: 'request', attempts: 0, failure: null, lateAnswer: null,
    };
  }

  const baseTime = Date.parse(ordered[0].timestamp);
  const events: TimedEvent[] = ordered.map((r) => ({
    ...r,
    t: Date.parse(r.timestamp) - baseTime,
    failed: isFailure(r),
  }));
  const totalMs = events[events.length - 1].t;
  // The action of the request itself, not of whichever span happened to be
  // first. On a trace carrying several calls the first span is one of the inner
  // ones, so the detail view was titled `rooms.list` while the list that linked
  // to it said `serviceGroups.list`.
  const action = events.find((e) => e.spanName === 'server_received')?.action
    ?? events.find((e) => e.spanName === 'response_sent')?.action
    ?? events.find((e) => e.action)?.action
    ?? null;

  // Order of first appearance, not the alphabet. Sorting pods by name put the
  // pod that received the request *below* the one it forwarded to, so the drawn
  // route ran backwards.
  const lanes: string[] = [];
  for (const e of events) for (const lane of hopOf(e)) if (!lanes.includes(lane)) lanes.push(lane);
  lanes.sort((a, b) => laneRank(a) - laneRank(b));

  // Stop at the reply. `request_trace` is emitted microseconds after
  // `response_sent` purely as bookkeeping, and treating the gap between them as
  // a phase produced a phantom leg on the *client* lane labelled
  // "in response_sent" — server-side accounting attributed to the caller.
  const replyAt = events.findIndex((e) => e.spanName === 'response_sent');
  const lastPhase = replyAt >= 0 ? replyAt : events.length - 1;

  const phases: Phase[] = [];
  for (let i = 0; i < lastPhase; i++) {
    const from = events[i], to = events[i + 1];
    const ms = to.t - from.t;
    if (ms <= 0) continue;
    phases.push({
      from, to, at: from.t, end: to.t, ms,
      lane: ownerAfter(from),
      label: labelAfter(from),
      unexplained: !events.some((e) => e.t > from.t && e.t < to.t),
    });
  }

  const legs: Leg[] = [];
  for (const p of phases) {
    const last = legs[legs.length - 1];
    if (last && last.lane === p.lane) { last.ms += p.ms; last.to = p.end; last.parts.push(p); }
    else legs.push({ lane: p.lane, at: p.at, to: p.end, ms: p.ms, parts: [p], events: [], failed: false, summary: '' });
  }
  for (const leg of legs) {
    leg.events = events.filter((e) => e.t >= leg.at && e.t <= leg.to);
    leg.failed = leg.events.some((e) => e.failed);
    // Named after whatever took the longest. "2 steps" was the label on the
    // biggest bar in most traces, which told the reader nothing at the exact
    // moment they most wanted to know.
    const dominant = leg.parts.reduce((a, b) => (b.ms > a.ms ? b : a));
    leg.summary = leg.parts.length === 1
      ? dominant.label
      : `${dominant.label} (+${leg.parts.length - 1})`;
  }

  const exchanges = exchangesOf(events, action);
  const decisions = events.filter((e) => e.spanName === 'route_decision');
  const distinctCalls = new Set(exchanges.map((x) => x.key)).size;

  // Repeats of the SAME call are retries; repeats of different calls are a
  // burst. Calling the latter "attempts" would be a straight lie.
  const shape: Shape = distinctCalls > 1 ? 'burst'
    : decisions.length > 1 ? 'repetition' : 'request';
  const attempts = shape === 'repetition' ? decisions.length : 1;

  const failedSend = events.find((e) => e.spanName === 'response_sent' && e.error);
  const failure = failedSend ? { code: String(failedSend.error), at: failedSend.t } : null;

  const late = failure
    ? events.find((e) => e.spanName === 'relay_response' && e.t > failure.at)
    : undefined;
  const lateAnswer = late ? { at: late.t, afterMs: late.t - failure!.at } : null;

  return { events, baseTime, totalMs, action, lanes, phases, legs, exchanges, shape, attempts, failure, lateAnswer };
}

/**
 * Pair each `relay_sent` with the `relay_response` that answered it.
 *
 * Unmatched sends are kept with a null `backAt` — those are the calls that
 * never came back, which is the entire point of the burst shape and something
 * a span list cannot express.
 */
export function exchangesOf(events: TimedEvent[], action: string | null): Exchange[] {
  const out: Exchange[] = [];
  const open: Array<{ key: string; at: number }> = [];
  for (const e of events) {
    const key = e.action || action || 'call';
    if (e.spanName === 'relay_sent') open.push({ key, at: e.t });
    if (e.spanName === 'relay_response') {
      const i = open.findIndex((o) => o.key === key);
      const o = i >= 0 ? open.splice(i, 1)[0] : open.shift();
      if (o) out.push({ key: o.key, sentAt: o.at, backAt: e.t, ms: e.latencyMs ?? e.t - o.at, error: e.error ?? null });
    }
  }
  open.forEach((o) => out.push({ key: o.key, sentAt: o.at, backAt: null, ms: null, error: 'never answered' }));
  return out.sort((a, b) => a.sentAt - b.sentAt);
}

// ---------------------------------------------------------------------------
// Baselines
// ---------------------------------------------------------------------------

export interface Baseline { action: string; n: number; p50: number; p50Relay: number; p95: number }

/** The smallest sample worth calling typical. A median of one is the trace itself. */
export const MIN_BASELINE_SAMPLE = 5;

const quantile = (sorted: number[], q: number) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] : 0;

/**
 * Per-action medians, computed from trace summaries the client already has.
 *
 * Deliberately client-side: the incident query returns durations for every
 * trace in the window, so "is this normal?" is answerable today without any new
 * backend work. A server-side rolling baseline would be better and is not a
 * prerequisite.
 */
export function baselinesFrom(
  summaries: Array<{ action?: string | null; totalLatencyMs?: number | null; relayLatencyMs?: number | null }>,
): Map<string, Baseline> {
  const by = new Map<string, Array<{ total: number; relay: number }>>();
  for (const s of summaries) {
    if (!s.action || s.totalLatencyMs == null) continue;
    const list = by.get(s.action) ?? [];
    list.push({ total: s.totalLatencyMs, relay: s.relayLatencyMs ?? 0 });
    by.set(s.action, list);
  }
  const out = new Map<string, Baseline>();
  for (const [action, xs] of by) {
    if (xs.length < MIN_BASELINE_SAMPLE) continue;
    const totals = xs.map((x) => x.total).sort((a, b) => a - b);
    const relays = xs.map((x) => x.relay).sort((a, b) => a - b);
    out.set(action, {
      action, n: xs.length,
      p50: quantile(totals, 0.5), p50Relay: quantile(relays, 0.5), p95: quantile(totals, 0.95),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The verdict
// ---------------------------------------------------------------------------

export interface Verdict {
  shape: Shape;
  headline: string;
  detail: string;
  ok: boolean;
  /** Null when there is no sample big enough to call anything typical. */
  baseline: Baseline | null;
  worstLeg: Leg | null;
}

/**
 * What happened, in a sentence.
 *
 * For most traces this is the entire answer and nothing below it gets read, so
 * it has to be right — and it has to know when it does not know rather than
 * guessing confidently.
 */
export function verdictOf(model: RouteModel, baselines?: Map<string, Baseline>): Verdict {
  const baseline = (model.action && baselines?.get(model.action)) || null;
  const worstLeg = model.legs.reduce<Leg | null>((a, b) => (b.ms > (a?.ms ?? -1) ? b : a), null);
  const ok = !model.failure;
  const base = { shape: model.shape, ok, baseline, worstLeg };

  if (model.shape === 'burst') {
    const lost = model.exchanges.filter((x) => x.backAt === null);
    const first = lost[0];
    return {
      ...base,
      headline: lost.length
        ? `${lost.length} of ${model.exchanges.length} calls were never answered.`
        : `${model.exchanges.length} calls, all answered.`,
      detail: lost.length && first
        ? `Everything sent after +${Math.round(first.sentAt)}ms went unanswered — the relay stopped `
          + `replying at a moment in time, rather than dropping particular calls.`
        : 'A burst of calls across the relay, all of which came back.',
    };
  }

  if (model.shape === 'repetition') {
    return {
      ...base,
      headline: `The relay was already busy, and we asked it ${model.attempts - 1} more times.`,
      detail: `Each attempt found the owning worker still holding the previous request.`
        + (model.lateAnswer
          ? ` The relay's answer arrived ${Math.round(model.lateAnswer.afterMs / 100) / 10}s after the`
            + ` client had already been told it failed.`
          : ''),
    };
  }

  if (model.failure) {
    const timedOut = model.events.some((e) => e.error === 'TIMEOUT');
    return {
      ...base,
      headline: timedOut ? 'The relay Mac never answered.' : `The request failed: ${model.failure.code}.`,
      detail: timedOut
        ? 'The wait was abandoned at the timeout. Nothing was logged relay-side, so the request either '
          + 'never arrived or the Mac was not running.'
        : 'The server rejected or could not complete the call.',
    };
  }

  // A trace can succeed and still be the thing you are looking for. Saying
  // "Nothing wrong." directly above a panel reading "10.7x slower than usual"
  // was the single worst thing in the view.
  const ratio = baseline && baseline.p50 > 0 ? model.totalMs / baseline.p50 : null;
  if (ratio !== null && ratio >= 2) {
    return {
      ...base,
      headline: `${ratio > 50 ? 'Over 50' : ratio.toFixed(1)}\u00d7 slower than usual.`,
      detail: `Typical for ${model.action ?? 'this call'} is ${Math.round(baseline!.p50)}ms`
        + ` across ${baseline!.n} in the last six hours.`
        + (worstLeg ? ` Most of the extra was ${describeLeg(worstLeg)}.` : ''),
    };
  }

  return {
    ...base,
    headline: 'Nothing wrong.',
    detail: worstLeg
      ? `Most of the time was ${describeLeg(worstLeg)}.`
      : 'Completed without incident.',
  };
}

/** "waiting for the relay Mac" reads better than a pod's hash suffix. */
function describeLeg(leg: Leg): string {
  if (leg.lane === 'relay') return 'waiting for the relay';
  const dominant = leg.parts.reduce((a, b) => (b.ms > a.ms ? b : a));
  return dominant.label;
}

// ---------------------------------------------------------------------------
// BubbleUp
// ---------------------------------------------------------------------------

export interface Dimension<T> { key: string; label: string; of: (row: T) => string | null }

export interface BubbleValue {
  value: string;
  /** Share of the selection, and of everything outside it. */
  inSelection: number;
  inBaseline: number;
  delta: number;
  /** How many times more common inside than outside. */
  lift: number;
  /** Occurs inside the selection and essentially nowhere else. */
  onlyHere: boolean;
  count: number;
}

export interface BubbleDimension { key: string; label: string; values: BubbleValue[]; best: BubbleValue | null; score: number }

/**
 * What a selected cluster of traces has in common (Honeycomb's BubbleUp).
 *
 * The comparison is always selection **against everything outside it** — 94% of
 * anything looks striking until you learn the baseline is also 94%.
 *
 * Ranked on **lift**, not on the size of the gap. "25% of these are DEVICE_BUSY
 * and nothing else ever is" is the finding; "50% have 9-20 hops where 8%
 * elsewhere do" is arithmetically larger and useless. Ranking on the gap alone
 * buries the outlier, which is the one thing this view exists to surface.
 */
export function bubbleUp<T>(selection: T[], rest: T[], dims: Array<Dimension<T>>): BubbleDimension[] {
  const floor = 1 / Math.max(1, rest.length);
  return dims.map(({ key, label, of }) => {
    const cs = new Map<string, number>(), cr = new Map<string, number>();
    selection.forEach((r) => { const v = of(r); if (v != null) cs.set(v, (cs.get(v) ?? 0) + 1); });
    rest.forEach((r) => { const v = of(r); if (v != null) cr.set(v, (cr.get(v) ?? 0) + 1); });

    const values: BubbleValue[] = [...new Set([...cs.keys(), ...cr.keys()])]
      .map((value) => {
        const inSelection = (cs.get(value) ?? 0) / (selection.length || 1);
        const inBaseline = (cr.get(value) ?? 0) / (rest.length || 1);
        return {
          value, inSelection, inBaseline,
          delta: inSelection - inBaseline,
          lift: inSelection / Math.max(inBaseline, floor),
          onlyHere: inBaseline < floor * 1.5,
          count: cs.get(value) ?? 0,
        };
      })
      .filter((v) => v.count > 0)
      .sort((a, b) => b.inSelection - a.inSelection);

    // Only lead on something over-represented. "87% of them succeeded, against
    // 100% elsewhere" is true, is the largest number on the page, and is a
    // terrible headline.
    //
    // The floor is lower for a value confined to the selection: 13% of a
    // cluster being an error code that exists nowhere else is a finding, where
    // 13% of a value that is common everywhere is noise.
    const best = values
      .filter((v) => v.delta > 0 && (v.inSelection >= 0.15 || (v.onlyHere && v.inSelection >= 0.05)))
      .sort((a, b) => b.lift - a.lift || b.delta - a.delta)[0] ?? null;

    // Occurring *only* here is categorically stronger than merely being
    // concentrated here, and without the boost a big-but-dull gap outranks the
    // smoking gun -- "50% have 9-20 hops where 8% elsewhere do" beating "25%
    // are DEVICE_BUSY and nothing else ever is".
    const confined = best?.onlyHere ? 2.5 : 1;
    const score = best ? Math.log(1 + best.lift) * best.inSelection * confined : 0;
    return { key, label, values, best, score };
  })
    .filter((d) => d.values.length)
    .sort((a, b) => b.score - a.score);
}

/** The dimensions a trace summary can be sliced by. */
export interface TraceSummaryLike {
  action?: string | null;
  success?: boolean | null;
  error?: string | null;
  hopCount?: number | null;
  totalLatencyMs?: number | null;
  relayLatencyMs?: number | null;
  clientType?: string | null;
  originInstance?: string | null;
  env?: string | null;
}

export const TRACE_DIMENSIONS: Array<Dimension<TraceSummaryLike>> = [
  { key: 'action', label: 'Action', of: (r) => r.action ?? null },
  {
    key: 'outcome', label: 'Outcome',
    // The error string carries a message after the code; the code is the part
    // that groups.
    of: (r) => (r.success === false ? (r.error || 'failed').split(':')[0] : 'ok'),
  },
  {
    key: 'where', label: 'Where the time went',
    of: (r) => {
      // A probe logs a relay round trip and no total. That is not unknown — it
      // is a call that was entirely relay, and bucketing it as unknown buried a
      // third of the population in a junk bucket.
      const total = r.totalLatencyMs ?? r.relayLatencyMs;
      if (!total || r.relayLatencyMs == null) return null;
      const share = r.relayLatencyMs / total;
      return share > 0.85 ? 'almost all relay'
        : share > 0.5 ? 'mostly relay'
        : share > 0.2 ? 'mixed' : 'mostly cloud';
    },
  },
  { key: 'client', label: 'Client', of: (r) => r.clientType ?? null },
  { key: 'pod', label: 'Pod', of: (r) => r.originInstance?.split('-').pop() ?? null },
  {
    key: 'hops', label: 'Hops',
    of: (r) => (r.hopCount == null ? null
      : r.hopCount <= 3 ? '2-3' : r.hopCount <= 8 ? '4-8' : r.hopCount <= 20 ? '9-20' : '21+'),
  },
];

// ---------------------------------------------------------------------------
// The time axis
// ---------------------------------------------------------------------------

export interface TimeScale {
  /** Maps a ms offset to 0..1 across the plot. */
  x: (ms: number) => number;
  /** Stretches that were squashed, so the view can mark what it hid. */
  cuts: Array<{ from: number; to: number; ms: number }>;
  elided: boolean;
}

/**
 * The axis is the real enemy: no linear scale shows a 36ms span and a 30s stall
 * in one picture — one of them is a hairline.
 *
 * Elision keeps every event in order and in relative size, but squashes any
 * interval big enough to dominate down to a fixed sliver the view can mark with
 * what it cost. You lose true proportion and gain the ability to see structure,
 * which is why it is a toggle and not a default.
 */
export function makeTimeScale(events: Array<{ t: number }>, totalMs: number, elide: boolean): TimeScale {
  const total = Math.max(1, totalMs);
  if (!elide) return { x: (ms) => Math.max(0, Math.min(1, ms / total)), cuts: [], elided: false };

  const times = [...new Set(events.map((e) => e.t))].sort((a, b) => a - b);
  // Elision earns its keep only when squashing the big gaps makes *other*
  // things visible. On a six-span trace with one dominant gap there is nothing
  // to rescue, and the compressed segment still ends up a large share of a much
  // smaller axis -- so the view hatched almost its entire width and looked
  // broken.
  if (times.length < 5) return { x: (ms) => Math.max(0, Math.min(1, ms / total)), cuts: [], elided: false };
  const threshold = Math.max(400, total * 0.06);
  const segments: Array<{ t0: number; t1: number; real: number; big: boolean; disp: number; d0: number }> = [];
  let prev = 0;
  for (const t of times) {
    const real = t - prev;
    if (real > 0) segments.push({ t0: prev, t1: t, real, big: real > threshold, disp: 0, d0: 0 });
    prev = t;
  }
  if (!segments.length) return { x: () => 0, cuts: [], elided: false };

  let acc = 0;
  for (const seg of segments) {
    seg.disp = seg.big ? threshold * 0.12 : seg.real;
    seg.d0 = acc;
    acc += seg.disp;
  }
  const span = acc || 1;

  return {
    x: (ms) => {
      if (ms <= 0) return 0;
      for (const seg of segments) {
        if (ms <= seg.t1) return (seg.d0 + (seg.real ? (ms - seg.t0) / seg.real : 1) * seg.disp) / span;
      }
      return 1;
    },
    cuts: segments.filter((s) => s.big).map((s) => ({ from: s.d0 / span, to: (s.d0 + s.disp) / span, ms: s.real })),
    elided: true,
  };
}
