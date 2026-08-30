// How good is this connection, right now?
//
// The client has always had four transport states — disconnected, connecting,
// connected, reconnecting — and `WebSocketContext` flattens even those into one
// `isConnected` boolean. None of them can express "connected, and every request
// is taking four seconds", which is the state users actually complain about:
// the UI works, the taps appear to land, and nothing says otherwise until the
// 30s request timeout finally fires.
//
// This module is the missing vocabulary. It is pure and clock-injected, like
// `reconnect-policy.ts` next door, so the thresholds can be tested rather than
// eyeballed against a throttled browser.
//
// ── The load-bearing idea ───────────────────────────────────────────────────
//
// **The age of in-flight requests is the leading indicator; the latency of
// completed ones is a lagging one.** A request outstanding for four seconds
// says something is wrong *now*. A completed request describes the past.
//
// That distinction is the difference between working and not, because on a
// link that has genuinely gone bad *nothing completes* — so any metric built
// only from completions goes quiet exactly when it matters, and quiet reads as
// healthy. A half-open socket produces a flawless record of fast requests, all
// of them from before the peer disappeared.

/**
 * What we are willing to say about the connection.
 *
 * `unknown` is not a failure state and must not be styled as one. It means the
 * evidence has expired — which happens routinely and innocently, because the
 * heartbeat is suspended while a browser tab is hidden. Reporting a confident
 * `good` from minutes-old samples would reproduce, inside the indicator meant
 * to fix it, the exact bug this work exists to remove.
 */
export type ConnectionQuality = 'good' | 'slow' | 'stalled' | 'offline' | 'unknown' | 'connecting';

/**
 * Round-trip time at which a request stops feeling immediate.
 *
 * Deliberately the same numbers `RequestLogPanel` already paints amber and red
 * (`components/debug/RequestLogPanel.tsx`, `durationColour`). Those were chosen
 * by a person for exactly this judgement — "slow enough to be worth noticing,
 * at a glance" — and having the user-facing indicator disagree with the debug
 * panel would make every support conversation harder, not easier.
 */
export const SLOW_RTT_MS = 1_000;
export const STALLED_RTT_MS = 3_000;

/**
 * How long a single request may be outstanding before that alone is the story.
 *
 * `SLOW_IN_FLIGHT_MS` is under a second past the point where a person decides
 * the tap did not work, and `STALLED_IN_FLIGHT_MS` sits far below the 30s
 * `REQUEST_TIMEOUT` in `websocket.ts` — the entire problem being that 30s of
 * silence is the current first notification.
 */
export const SLOW_IN_FLIGHT_MS = 2_500;
export const STALLED_IN_FLIGHT_MS = 8_000;

/**
 * Consecutive failures that mean this is not bad luck.
 *
 * One failure is a blip and is already reported by the toast on the request
 * itself. Two in a row, with no success between, is a condition.
 */
export const FAILURES_FOR_STALLED = 2;

/**
 * Requests whose length is set by the house, not by the link.
 *
 * The thresholds above measure **latency**. A `characteristics.set` across 130
 * accessories measures **how much work HomeKit has to do**, and the two are not
 * the same quantity. Timing the second against the first is a category error,
 * and it had a real cost: pressing "All lights" on a 130-accessory home sent one
 * bulk write that answered in 14,558ms — with 469 `characteristic_update`
 * broadcasts arriving while it ran, and the 10s `automation.virtual_states` poll
 * round-tripping in 108-252ms throughout — and the badge went "Slow" at 2.5s and
 * "Your home is not responding" at 8s. The link was never the problem; the
 * lights were visibly moving the whole time.
 *
 * No threshold fixes that, which is why this is a list and not a bigger number:
 * a large enough home outgrows any value you pick.
 *
 * These are excused from the **in-flight clock only**. Every other signal still
 * applies to them — the socket state, the 30s `REQUEST_TIMEOUT`, and the failure
 * that timeout books. And ordinary requests keep feeding the in-flight clock
 * while housework runs, so the half-open socket this signal exists for stays
 * detectable mid-write rather than going blind for the length of a batch.
 *
 * Progress on the work itself is not this indicator's job and never was: the
 * action's own pending ring and progress count report that, next to the control
 * the user pressed.
 */
const HOUSEWORK_ACTIONS: ReadonlySet<string> = new Set([
  /** The bulk write behind every Homecast shortcut. One request, N accessories. */
  'characteristics.set',
  /** The older bulk write, still what MCP and AI callers use. */
  'state.set',
  /** Writes every member of a service group. */
  'serviceGroup.set',
  /** HomeKit runs the scene; how long that takes is the scene's business. */
  'scene.execute',
]);

/**
 * Is this request housework — work whose duration says nothing about the link?
 *
 * Deliberately **not** extended to the single-accessory `characteristic.set`.
 * One write that takes eight seconds is genuinely worth reporting: it is a
 * device that is not answering, which is a fault and not a workload.
 */
export function isHousework(action: string): boolean {
  return HOUSEWORK_ACTIONS.has(action);
}

/** The bit of a pending request this module needs to judge it. */
export interface InFlightRequest {
  action: string;
  sentAt: number;
}

/**
 * When the oldest request that counts went out, or null if none does.
 *
 * The derivation lives here rather than in the socket so the rule and the
 * thresholds it feeds are read and tested together — the bug above was not in
 * either half, it was in the join between them.
 */
export function oldestCountedInFlight(pending: Iterable<InFlightRequest>): number | null {
  let oldest: number | null = null;
  for (const request of pending) {
    if (isHousework(request.action)) continue;
    if (oldest === null || request.sentAt < oldest) oldest = request.sentAt;
  }
  return oldest;
}

/**
 * How old the newest round-trip sample may be before it stops being evidence.
 *
 * Three heartbeats at the 30s interval. Beyond that we have not measured
 * anything recently enough to make a claim — most often because the tab was
 * hidden and the heartbeat was suspended.
 */
export const SAMPLE_MAX_AGE_MS = 90_000;

/** Samples kept for the median. Small, so recovery is visible quickly. */
export const RTT_WINDOW = 5;

/**
 * How long things must look good before we say so again.
 *
 * Degrade instantly, recover slowly. A status indicator that flickers between
 * "Slow" and nothing on every unlucky request is worse than no indicator: it
 * trains the user to ignore it. The asymmetry is the point — being told late
 * that things recovered costs nothing, being told late that they broke is the
 * entire complaint.
 */
export const RECOVERY_HOLD_MS = 3_000;

/**
 * How long a socket may be busy coming up before we call it an outage.
 *
 * "Not connected yet" is not the same as "not connected", and conflating them
 * was a real bug: `setState('connected')` is deliberately withheld until the
 * server's first word (`armReadyAnnouncement`, up to `READY_FALLBACK_MS`), and
 * the GKE affinity redirect tears the socket down and rebuilds it ~280ms after
 * every connect. Reporting either as `offline` painted the badge red on every
 * single launch, and — since recovering from a degraded state serves the full
 * `RECOVERY_HOLD_MS` — left it wrong for seconds afterwards.
 *
 * So a transitional state reads as `unknown` until it has lasted longer than
 * any legitimate handshake, and only then as `offline`.
 */
export const OFFLINE_AFTER_MS = 4_000;

/**
 * How long a socket may be coming up before we say so out loud.
 *
 * This is the debounce that used to live in the toast (`shouldShow`, 2s) and
 * in its route gate. The affinity redirect rebuilds the socket ~280ms after
 * every connect and an ordinary handshake is quicker still, so anything below
 * this is invisible — otherwise "Connecting…" would flash in the header on
 * every single launch, which is precisely the noise the toast was written to
 * avoid.
 *
 * Between here and OFFLINE_AFTER_MS the ladder reads: quiet dot → Connecting…
 * → Offline.
 */
export const CONNECTING_AFTER_MS = 1_500;

export type SocketState = 'connected' | 'connecting' | 'reconnecting' | 'disconnected';

export interface QualityInputs {
  /**
   * The transport's own state. A boolean cannot express the difference between
   * "coming up" and "down", which is exactly the distinction that matters here.
   */
  socketState: SocketState;
  /** When it entered that state, so a transition can be told from an outage. */
  socketStateSince: number;
  /**
   * Recent round-trip times in ms, oldest first. Capped at `RTT_WINDOW` by
   * `pushRtt`; a longer array is tolerated and only its tail is read.
   */
  rttSamples: readonly number[];
  /** When the newest sample was taken. 0 when there has never been one. */
  lastRttAt: number;
  /**
   * When the oldest still-unanswered request was sent, or null when nothing is
   * in flight. Sent-at rather than an age so the caller does not have to
   * recompute it against the same clock we are using.
   *
   * Build it with `oldestCountedInFlight`, not a bare minimum over the pending
   * map: housework does not belong in this number. See `isHousework`.
   */
  oldestInFlightSentAt: number | null;
  /** Requests that have failed in a row, reset by any success. */
  consecutiveFailures: number;
}

/** Median, which ignores the one unlucky sample a mean would not. */
export function medianRtt(samples: readonly number[]): number | null {
  const recent = samples.slice(-RTT_WINDOW);
  if (recent.length === 0) return null;
  const sorted = [...recent].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Append a sample, keeping only the window. */
export function pushRtt(samples: readonly number[], rtt: number): number[] {
  return [...samples, rtt].slice(-RTT_WINDOW);
}

/**
 * Classify the connection from a snapshot. Pure; `now` is injected.
 *
 * Order is meaningful and is the design, not an implementation detail:
 * evidence about what is happening *now* outranks evidence about what happened
 * before, and outranks the absence of evidence.
 */
export function classifyQuality(input: QualityInputs, now: number): ConnectionQuality {
  if (input.socketState !== 'connected') {
    const inStateMs = Math.max(0, now - input.socketStateSince);
    // Long enough to be an outage rather than a handshake.
    if (inStateMs >= OFFLINE_AFTER_MS) return 'offline';
    // Long enough to be worth mentioning, but not yet a failure.
    if (inStateMs >= CONNECTING_AFTER_MS) return 'connecting';
    return 'unknown';
  }

  // In-flight age first, and ahead of sample staleness on purpose. A request
  // outstanding for nine seconds is proof of a problem no matter how old or
  // absent the round-trip samples are — and in a half-open socket, which is
  // the case this ordering exists for, that is the only evidence there is.
  const inFlightMs =
    input.oldestInFlightSentAt === null ? 0 : Math.max(0, now - input.oldestInFlightSentAt);
  if (inFlightMs >= STALLED_IN_FLIGHT_MS) return 'stalled';

  if (input.consecutiveFailures >= FAILURES_FOR_STALLED) return 'stalled';

  if (inFlightMs >= SLOW_IN_FLIGHT_MS) return 'slow';

  // Only now may we fall back to completed requests — and only if they are
  // recent enough to describe the present.
  const median = medianRtt(input.rttSamples);
  const samplesFresh = input.lastRttAt > 0 && now - input.lastRttAt <= SAMPLE_MAX_AGE_MS;
  if (median === null || !samplesFresh) return 'unknown';

  if (median >= STALLED_RTT_MS) return 'stalled';
  if (median >= SLOW_RTT_MS) return 'slow';
  return 'good';
}

/** Ranked worst-last, so "did this get worse?" is a comparison. */
const SEVERITY: Record<ConnectionQuality, number> = {
  good: 0,
  unknown: 1,
  connecting: 2,
  slow: 3,
  stalled: 4,
  offline: 5,
};

/**
 * States that describe not having an answer rather than a bad one.
 *
 * Both are exempt from the recovery hold. `unknown` because it is the absence
 * of a claim; `connecting` because its resolution is the expected happy path,
 * not a flap — holding it would leave "Connecting…" on screen for three
 * seconds after the connection was already back, which is the same complaint
 * in a different costume. The `CONNECTING_AFTER_MS` dwell is what debounces
 * this state; it does not need debouncing twice.
 */
export function isTransitional(q: ConnectionQuality): boolean {
  return q === 'unknown' || q === 'connecting';
}

export interface HysteresisState {
  /** What is being shown. */
  shown: ConnectionQuality;
  /** When `raw` first became better than `shown`, or null while it is not. */
  improvingSince: number | null;
}

export function initialHysteresis(shown: ConnectionQuality = 'unknown'): HysteresisState {
  return { shown, improvingSince: null };
}

/**
 * Smooth a raw classification into what the UI should display.
 *
 * Anything worse shows immediately. Anything better has to hold for
 * `RECOVERY_HOLD_MS` first. `unknown` is treated as an improvement over a
 * degraded state rather than a state to rush into, so a tab returning from the
 * background settles through the same hold instead of flashing.
 */
export function applyHysteresis(
  state: HysteresisState,
  raw: ConnectionQuality,
  now: number,
  hold: number = RECOVERY_HOLD_MS,
): HysteresisState {
  if (raw === state.shown) return state.improvingSince === null ? state : { shown: state.shown, improvingSince: null };

  // Worse: no waiting. Being told late that things broke is the whole bug.
  if (SEVERITY[raw] > SEVERITY[state.shown]) {
    return { shown: raw, improvingSince: null };
  }

  // Leaving a transitional state is exempt — see isTransitional. Without this,
  // every return from a backgrounded tab would sit on "checking" for the full
  // hold, and every reconnect would keep saying "Connecting…" for three
  // seconds after it had finished: the jitter the hold exists to prevent, just
  // relocated.
  if (isTransitional(state.shown)) {
    return { shown: raw, improvingSince: null };
  }

  // Better: start (or continue) the hold, and only then adopt it.
  const since = state.improvingSince ?? now;
  if (now - since >= hold) {
    return { shown: raw, improvingSince: null };
  }
  return { shown: state.shown, improvingSince: since };
}

/**
 * Is the connection actually bad, as opposed to merely unmeasured or busy?
 *
 * Drives the immediate pending-write ring, so `connecting` is deliberately
 * out: a socket mid-handshake has no measured latency to justify dropping the
 * ring's delay, and treating a routine reconnect as degradation would put a
 * ring on every tile for a second on every launch.
 */
export function isDegraded(q: ConnectionQuality): boolean {
  return q === 'slow' || q === 'stalled' || q === 'offline';
}
