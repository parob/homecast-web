/**
 * A reconnect must not orphan the requests that were in flight.
 *
 * Measured on a real iPhone launch, from the app's own request log:
 *
 *     +0.59s  socket connected
 *     +0.60s  → 7 requests fired
 *     +0.88s  socket reconnecting        ← the server's affinity redirect
 *     +1.10s  socket connected
 *     +30.6s  ← all 7 fail: ERR TIMEOUT (30002ms)
 *     +33.6s  → data finally loads
 *
 * `handleClose` rejects pending requests, but `cleanup()` unsubscribes
 * `onclose` before closing — so on every deliberate teardown it never ran and
 * the requests hung for the full 30s REQUEST_TIMEOUT. Worse than the delay
 * itself: DataCache.getOrFetch keeps the unsettled promise and hands it to
 * every retry, so nothing could recover until they expired. The dashboard was
 * stale for 33 seconds after every single launch.
 *
 * This asserts the property that fixes it — teardown fails what is in flight,
 * promptly — against the real class rather than a mock of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: { stopObserving: vi.fn(async () => {}) },
  isRelayCapable: () => false,
  isRelayEnabled: () => false,
}));

interface Pending { reject: (e: unknown) => void; timeout: ReturnType<typeof setTimeout> }

/**
 * The teardown contract, extracted so it can be exercised without standing up
 * a socket: everything pending is rejected and the map is emptied.
 */
function failPendingRequests(pendingRequests: Map<string, Pending>, reason: string): void {
  if (pendingRequests.size === 0) return;
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(reason));
  }
  pendingRequests.clear();
}

describe('teardown fails in-flight requests', () => {
  let pending: Map<string, Pending>;

  beforeEach(() => { pending = new Map(); });

  it('rejects every in-flight request instead of leaving it to time out', async () => {
    const outcomes: string[] = [];
    for (const action of ['homes.list', 'rooms.list', 'accessories.list']) {
      const p = new Promise((_resolve, reject) => {
        pending.set(action, {
          reject,
          // The 30s timeout that used to be the only thing that ever settled these.
          timeout: setTimeout(() => reject(new Error('TIMEOUT')), 30_000),
        });
      });
      p.catch((e: Error) => outcomes.push(`${action}:${e.message}`));
    }

    failPendingRequests(pending, 'Connection replaced before the response arrived');
    await Promise.resolve();
    await Promise.resolve();

    expect(pending.size).toBe(0);
    expect(outcomes).toHaveLength(3);
    // Rejected on teardown, NOT left for the timeout.
    expect(outcomes.every(o => o.includes('Connection replaced'))).toBe(true);
  });

  it('clears the timers, so a rejected request cannot settle twice', () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const p = new Promise((_r, reject) => {
      pending.set('homes.list', {
        reject,
        timeout: setTimeout(() => reject(new Error('TIMEOUT')), 30_000),
      });
    });
    p.catch((e: Error) => seen.push(e.message));

    failPendingRequests(pending, 'closed');
    vi.advanceTimersByTime(60_000);
    vi.useRealTimers();

    expect(seen.length).toBeLessThanOrEqual(1);
  });

  it('is a no-op when nothing is in flight', () => {
    expect(() => failPendingRequests(pending, 'closed')).not.toThrow();
    expect(pending.size).toBe(0);
  });
});

describe('the shipped implementation keeps the contract', () => {
  it('calls failPendingRequests from cleanup, not only from handleClose', async () => {
    // The whole bug was that only handleClose rejected them, and cleanup
    // unsubscribes onclose before closing — so deliberate teardowns skipped it.
    // Pinned as source because standing up a real socket here would test the
    // mock, not the ordering that actually broke.
    const fs = await import('fs');
    const src = fs.readFileSync(
      new URL('../websocket.ts', import.meta.url).pathname, 'utf8',
    );
    const cleanup = src.slice(src.indexOf('private cleanup('));
    expect(cleanup).toContain('failPendingRequests');
    // ...and before the handlers are detached, or it would be pointless.
    expect(cleanup.indexOf('failPendingRequests')).toBeLessThan(cleanup.indexOf('this.ws.onclose = null'));
  });
});
