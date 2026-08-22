/**
 * Did the server actually answer, or did we never reach it?
 *
 * This is the difference between "this shared link is no longer being shared"
 * and "your connection dropped", and `SharedEntityPage` used to collapse the
 * two: any truthy `error` rendered **"Not Found — This shared link is invalid
 * or the item is no longer being shared."** A viewer on weak mobile data was
 * told their perfectly good link was dead, and — since the retry button lived
 * only in the passcode branch — given no way to try again.
 *
 * The rule is deliberately asymmetric. Only a real GraphQL response counts as
 * an answer; everything else is treated as "we could not ask". A fetch that
 * never resolved, an abort at apollo.ts's 15s ceiling, a 502 from the load
 * balancer, an HTML error page that would not parse — none of those are
 * evidence about the share. Guessing "gone" from a failed request is the more
 * damaging error and the harder one for a user to recover from, so it requires
 * the server to have said so.
 */

import {
  CombinedGraphQLErrors,
  CombinedProtocolErrors,
} from '@apollo/client/errors';

/**
 * True when the server responded and the response carried errors — i.e. the
 * backend reached a verdict about the request.
 *
 * `ServerError` is deliberately NOT included: it means a non-2xx with a body
 * we could not parse as GraphQL, which is a broken or overloaded server rather
 * than a statement about the thing being asked for.
 */
export function serverAnswered(error: unknown): boolean {
  if (!error) return false;
  return CombinedGraphQLErrors.is(error) || CombinedProtocolErrors.is(error);
}

/**
 * True when the request failed without the server reaching a verdict —
 * offline, timed out, aborted, proxied away, or otherwise unanswered.
 *
 * A falsy error is not a transport error: no failure happened at all.
 */
export function isTransportError(error: unknown): boolean {
  if (!error) return false;
  return !serverAnswered(error);
}
