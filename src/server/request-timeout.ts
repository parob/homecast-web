/**
 * How long the client waits for a request, and why it is not 30 seconds.
 *
 * The client arms its timer when it **sends**. The cloud server arms its own
 * when it **receives**, which is strictly later by one network leg. So two
 * equal timeouts are not a tie — the client always gives up first, and the
 * server's answer arrives for a request that is no longer pending:
 *
 * ```
 * t=0.000   client sends, arms its timer
 * t=0.0xx   server receives, arms its own
 * t=30.000  client rejects: TIMEOUT "Request timed out: <action>"
 *           → pendingRequests.delete(id)
 * t=30.0xx  server gives up on the relay and sends its actual reason
 *           → handleResponse: "response for unknown request", dropped
 * ```
 *
 * That made the server's diagnosis — the branch that knows *which* relay it
 * asked and that the relay went silent — unreachable by construction rather
 * than merely unlikely, and left the user with `describeWriteFailure`'s
 * generic "<accessory> didn't respond in time." for a failure the accessory
 * was never told about. Three lock reports running (parob/homecast-cloud #44,
 * #48, #63) arrived carrying no server-side reason for a failed write.
 *
 * These constants were equal because nothing connected them: one is a literal
 * in this repo, the other a default argument in another, and each looked
 * correct on its own. They are derived here, with the relationship asserted in
 * `request-timeout.test.ts`, so the next edit to either has to state which
 * side it is moving.
 */

/**
 * The relay timeout the cloud server applies to a client request.
 *
 * Mirrors `route_request(timeout: float = 30.0)` in
 * `server/homecast/websocket/handler.py` — the default that `_route_to_device`
 * takes, because it passes no `timeout` of its own. **This is a mirror of
 * another repository's constant, not the source of truth.** If the server's
 * default moves, this must move with it, and the assertion below is what makes
 * the mismatch visible rather than silent.
 */
export const SERVER_RELAY_TIMEOUT_MS = 30_000;

/**
 * How much longer than the server the client is willing to wait.
 *
 * It has to cover one round trip — the leg that put the server's timer behind
 * the client's, plus the leg its answer travels back on — with enough margin
 * that a slow network does not eat the whole allowance. Observed legs on a
 * working socket run 141–714 ms (parob/homecast-cloud#63); 5 s is roughly
 * seven times the worst of those.
 *
 * It is deliberately not larger. Every millisecond here is time a user spends
 * watching a control that has not answered, so this buys the server's sentence
 * and nothing else.
 */
export const TIMEOUT_HEADROOM_MS = 5_000;

/**
 * How long the client waits before giving up on a request itself.
 *
 * Derived, never typed as a number: the point is that it outlasts the server.
 */
export const REQUEST_TIMEOUT_MS = SERVER_RELAY_TIMEOUT_MS + TIMEOUT_HEADROOM_MS;

/**
 * Whether a client timeout leaves the server room to answer first.
 *
 * Pinned as a relationship rather than as a number, because the numbers are
 * allowed to change and the ordering is not.
 *
 * @param clientMs     what the client waits, measured from its send
 * @param serverMs     what the server waits, measured from its receive
 * @param roundTripMs  the two legs: send → server, and its answer back
 */
export function clientOutlastsServer(
  clientMs: number,
  serverMs: number,
  roundTripMs: number,
): boolean {
  return clientMs > serverMs + roundTripMs;
}
