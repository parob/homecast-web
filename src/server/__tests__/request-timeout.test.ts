import { describe, it, expect } from 'vitest';
import {
  REQUEST_TIMEOUT_MS,
  SERVER_RELAY_TIMEOUT_MS,
  TIMEOUT_HEADROOM_MS,
  clientOutlastsServer,
} from '../request-timeout';
import { MAX_VISIBLE_MS } from '@/lib/pending-writes';

/**
 * #59 — the client's request timeout used to equal the server's relay timeout,
 * so the server's reason could never arrive.
 *
 * The client arms its timer when it SENDS. The server arms its own when it
 * RECEIVES, which is strictly later by one network leg. Two equal timeouts are
 * therefore not a tie: the client always gives up first, and the server's
 * answer lands for a request `handleResponse` no longer has.
 *
 * These tests pin the RELATIONSHIP, not the numbers. Either number may move;
 * what may not is the ordering.
 */
describe('#59 — the client outlasts the server', () => {
  /**
   * One round trip: the leg that put the server's timer behind the client's,
   * plus the leg its answer travels back on. Observed legs on a working socket
   * ran 141–714ms (parob/homecast-cloud#63), so 1.5s is a pessimistic pair.
   */
  const PESSIMISTIC_ROUND_TRIP_MS = 1_500;

  it('leaves the server room to answer before the client stops listening', () => {
    expect(
      clientOutlastsServer(
        REQUEST_TIMEOUT_MS,
        SERVER_RELAY_TIMEOUT_MS,
        PESSIMISTIC_ROUND_TRIP_MS,
      ),
    ).toBe(true);
  });

  it('is the exact case that used to fail: two equal timeouts', () => {
    // What main carried before this fix — 30s against 30s. Any leg above zero
    // loses the race, which is why equality is the bug and not a near miss.
    expect(clientOutlastsServer(30_000, 30_000, 80)).toBe(false);
    expect(clientOutlastsServer(30_000, 30_000, 1)).toBe(false);
  });

  it('spends the headroom on a round trip and not much else', () => {
    // Guards the other direction: headroom big enough to cover a bad network,
    // small enough that it is not silently absorbing a slow relay. Every
    // millisecond here is a user watching a control that has not answered.
    expect(TIMEOUT_HEADROOM_MS).toBeGreaterThanOrEqual(PESSIMISTIC_ROUND_TRIP_MS);
    expect(TIMEOUT_HEADROOM_MS).toBeLessThanOrEqual(10_000);
  });

  it('keeps the pending-write ring up until the transport gives up', () => {
    // pending-writes.ts held a 30000 literal in step with this by a comment.
    // Raising the request timeout alone would have left the ring gone for 5s
    // with nothing yet reported — the silent gap that comment forbids.
    expect(MAX_VISIBLE_MS).toBe(REQUEST_TIMEOUT_MS);
  });
});
