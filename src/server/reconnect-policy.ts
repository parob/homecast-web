// How long to wait before trying the socket again.
//
// Measured on the managed relay: a node drain took the pod out from under the
// socket and the relay stayed off the air for 103 seconds. Nothing was broken —
// that is simply what `1s × 1.5ⁿ` capped at 30s adds up to over ten attempts,
// and the replacement pod was ready long before the relay next looked.
//
// Two things follow. A relay must not sleep as long as a browser tab: while it
// is asleep the home is unreachable, so its ceiling is far lower. And a close
// code that means "this server is going away" is an instruction to come back,
// not a reason to back off — backing off there punishes us for the server's
// own routine restart.

/** First retry, and the value backoff resets to. */
export const INITIAL_RECONNECT_DELAY = 1000;
/** Ceiling for an ordinary client, where a slow retry costs nobody anything. */
export const MAX_RECONNECT_DELAY = 30_000;
/**
 * Ceiling for the relay. Low because the cost of waiting is a home that does
 * not answer — and because pod replacement completes in seconds, so a longer
 * wait buys no politeness, it only extends the outage.
 */
export const MAX_RELAY_RECONNECT_DELAY = 8_000;
export const RECONNECT_MULTIPLIER = 1.5;

/**
 * WebSocket close codes that mean the *server* is cycling.
 *
 * 1012 "service restart" is what a draining pod sends, and it is exactly the
 * unsolicited twin of the server's `reconnect` message, which already resets
 * backoff. 1001 "going away" is the same situation. Treating either as a
 * failure to back away from turned a routine deploy into a two-minute outage.
 */
const SERVER_CYCLING_CODES = new Set([1001, 1012]);

/** Should the next attempt start from scratch rather than continue backing off? */
export function resetsBackoff(closeCode: number | undefined): boolean {
  return closeCode !== undefined && SERVER_CYCLING_CODES.has(closeCode);
}

/** The delay after a failed attempt at `current`. */
export function nextReconnectDelay(current: number, isRelay: boolean): number {
  const ceiling = isRelay ? MAX_RELAY_RECONNECT_DELAY : MAX_RECONNECT_DELAY;
  return Math.min(current * RECONNECT_MULTIPLIER, ceiling);
}

/**
 * Jittered delay to actually wait. ±20%, so a fleet coming back from one
 * server restart does not arrive in lockstep.
 *
 * `random` is injectable because a test asserting a *range* while calling
 * Math.random is a test that fails one run in a hundred.
 */
export function jitter(delay: number, random: () => number = Math.random): number {
  return Math.max(0, delay + delay * 0.2 * (random() * 2 - 1));
}

/** How often the client pings. */
export const HEARTBEAT_INTERVAL = 30_000;

/**
 * Silence that means the socket is dead rather than quiet.
 *
 * Both sides ping, so on a healthy connection something arrives roughly every
 * 30s. Two and a half intervals tolerates one lost round trip without calling
 * a working socket dead.
 *
 * This exists because a half-open socket — TCP still up, peer gone, no FIN,
 * which is what a hard node kill or an LB dropping state produces — never
 * fires `onclose`. Without this the relay believes it is connected forever,
 * and the only symptom is a house that quietly stops answering.
 */
export const SILENCE_BEFORE_DEAD = 75_000;

/** Has nothing arrived for long enough that the socket cannot be alive? */
export function isSocketStale(
  lastInboundAt: number,
  now: number,
  threshold: number = SILENCE_BEFORE_DEAD,
): boolean {
  // Never stale before the first message: a socket that has just opened has
  // legitimately heard nothing yet.
  if (!lastInboundAt) return false;
  return now - lastInboundAt > threshold;
}
