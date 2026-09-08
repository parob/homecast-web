/**
 * What the cloud has just told us about reaching a home's relay.
 *
 * Every client already learns this the hard way, per home, several times a
 * minute: a request goes to the cloud, and the cloud answers `NO_DEVICE` —
 * literally *"No relay device connected for this home"*. Until now that answer
 * was swallowed on purpose (`websocket.ts` keeps it out of error reporting,
 * quite rightly — an offline home refreshing tiles is not a server bug) and
 * then dropped entirely. Nothing in the app was any wiser for having asked.
 *
 * That mattered because the *only* other way a client learns a relay is down
 * is a field the cloud controls, and the cloud deliberately withholds it:
 *
 *  - `relay_status_update` is pushed at the instant the relay's socket drops,
 *    so a client that opens afterwards never sees one; and
 *  - `homes.list` reports `relayState: 'reconnecting'` for the 120s grace in
 *    `server/homecast/utils/relay_status.py`, which the client counts as
 *    served — the grace exists so a blip does not flash "offline", and it is
 *    right to have it.
 *
 * So a phone could sit for a full minute with a perfect socket, three refused
 * writes behind it, and a cached home still claiming its relay was fine.
 * That is homecast-cloud#99: neither the status dot nor Local Mode reacted,
 * because between them they had nothing to react to.
 *
 * This module is that missing evidence, and nothing more. It records which
 * homes the cloud has refused, and holds the fact until something contradicts
 * it. Pure and injectable: every rule here is decided by argument rather than
 * by a clock or a socket, so the policies that read it stay testable.
 */

/** The last thing the cloud said about reaching one home. */
export interface ReachabilityMark {
  /** When the cloud last refused a request for this home with `NO_DEVICE`. */
  refusedAt: number;
  /** When a relay-routed request for this home last succeeded. */
  servedAt: number;
}

export type ReachabilityMemo = ReadonlyMap<string, ReachabilityMark>;

export const EMPTY_REACHABILITY: ReachabilityMemo = new Map();

/**
 * Never refused, never served.
 *
 * `-Infinity` rather than 0 so that "refused at time t" beats "never served"
 * for every t, including 0. With zeroes, `refusedAt > servedAt` is false for a
 * refusal at the epoch — which no clock produces, but which every test that
 * counts from zero does.
 */
const NEVER = Number.NEGATIVE_INFINITY;
const NOTHING: ReachabilityMark = { refusedAt: NEVER, servedAt: NEVER };

function withMark(
  memo: ReachabilityMemo,
  homeId: string,
  next: (prev: ReachabilityMark) => ReachabilityMark,
): ReachabilityMemo {
  const key = homeId.toUpperCase();
  const out = new Map(memo);
  out.set(key, next(memo.get(key) ?? NOTHING));
  return out;
}

/** The cloud answered `NO_DEVICE` for this home. */
export function noteRefused(memo: ReachabilityMemo, homeId: string, now: number): ReachabilityMemo {
  return withMark(memo, homeId, (prev) => ({ ...prev, refusedAt: now }));
}

/** A relay-routed request for this home came back with an answer. */
export function noteServed(memo: ReachabilityMemo, homeId: string, now: number): ReachabilityMemo {
  return withMark(memo, homeId, (prev) => ({ ...prev, servedAt: now }));
}

/**
 * The homes whose last word from the cloud was a refusal.
 *
 * Deliberately **not** time-limited. A mark is cleared by evidence to the
 * contrary — a request that succeeds, or a definite `relayState: 'connected'`
 * (see `relayServesHome` in local-mode.ts) — never by simply waiting.
 *
 * An expiry would be worse than useless here: the moment Local Mode engages,
 * this device stops asking the cloud about that home, so no fresh refusal
 * arrives to renew the mark. A mark that aged out would disengage Local Mode,
 * send the next request to the cloud, collect a refusal, and engage again —
 * a flap manufactured by the very mechanism meant to prevent one.
 */
export function unreachableHomeIds(memo: ReachabilityMemo): ReadonlySet<string> {
  return new Set(refusedHomes(memo).keys());
}

/**
 * The refused homes and *when* each was refused.
 *
 * The time is what makes the mark answerable. A refusal is a statement about
 * one instant, and the only thing that can overturn it is evidence gathered
 * after it — which is why `relayServesHome` compares this against the age of
 * the cached homes list rather than letting either win by rank.
 */
export function refusedHomes(memo: ReachabilityMemo): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const [id, m] of memo) {
    if (m.refusedAt > m.servedAt) out.set(id, m.refusedAt);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The one live copy, for the request funnel to write and the policies to read.
// ---------------------------------------------------------------------------

let memo: ReachabilityMemo = EMPTY_REACHABILITY;
let unreachable: ReadonlySet<string> = new Set();
let refused: ReadonlyMap<string, number> = new Map();
const listeners = new Set<(ids: ReadonlySet<string>) => void>();

/**
 * Publish only when the *answer* changes, not on every request.
 *
 * Reads run several times a second on a busy dashboard, and each one lands
 * here. Notifying on the write rather than on the change would re-render the
 * header on every tile refresh.
 */
function republish(): void {
  // Always recomputed, even when the membership is unchanged: a second
  // refusal of an already-refused home moves its timestamp, and the timestamp
  // is what `relayServesHome` weighs against the age of the homes list. Only
  // the *notification* is conditional.
  refused = refusedHomes(memo);
  const next = new Set(refused.keys());
  if (next.size === unreachable.size && [...next].every((id) => unreachable.has(id))) return;
  unreachable = next;
  for (const fn of listeners) fn(unreachable);
}

/** Record that the cloud refused a request for `homeId` with `NO_DEVICE`. */
export function recordRelayRefusal(homeId: string, now = Date.now()): void {
  memo = noteRefused(memo, homeId, now);
  republish();
}

/** Record that a relay-routed request for `homeId` was answered. */
export function recordRelayServed(homeId: string, now = Date.now()): void {
  memo = noteServed(memo, homeId, now);
  republish();
}

/** Called whenever the set of refused homes changes. Returns an unsubscribe. */
export function subscribeRelayReachability(
  fn: (ids: ReadonlySet<string>) => void,
): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Homes the cloud is currently refusing, uppercased. */
export function getUnreachableHomeIds(): ReadonlySet<string> {
  return unreachable;
}

/** The same homes, with the moment each was refused. */
export function getRefusedHomes(): ReadonlyMap<string, number> {
  return refused;
}

/** Test seam. */
export function resetRelayReachability(): void {
  memo = EMPTY_REACHABILITY;
  unreachable = new Set();
  refused = new Map();
}
