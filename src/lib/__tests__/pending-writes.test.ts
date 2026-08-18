import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  trackWrite,
  isRingVisible,
  isWriting,
  subscribeToKey,
  accessoryKey,
  groupKey,
  __resetPendingWrites,
  SHOW_DELAY_MS,
  MIN_VISIBLE_MS,
  IDLE_GRACE_MS,
  MAX_VISIBLE_MS,
} from '../pending-writes';

const KEY = accessoryKey('abc');

/** A promise plus the handles to settle it whenever the test likes. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Advance fake timers and let any settled promises run their callbacks. */
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  __resetPendingWrites();
});

afterEach(() => {
  __resetPendingWrites();
  vi.useRealTimers();
});

describe('pending-writes', () => {
  it('never shows a ring for a write that settles quickly', async () => {
    const d = deferred();
    trackWrite(KEY, d.promise);

    await advance(300);
    d.resolve();
    await advance(0);

    // Past the delay, past the grace — nothing should ever have appeared.
    await advance(SHOW_DELAY_MS + IDLE_GRACE_MS + MIN_VISIBLE_MS);
    expect(isRingVisible(KEY)).toBe(false);
  });

  it('shows a ring once the write outlives the delay', async () => {
    const d = deferred();
    trackWrite(KEY, d.promise);

    await advance(SHOW_DELAY_MS - 1);
    expect(isRingVisible(KEY)).toBe(false);

    await advance(1);
    expect(isRingVisible(KEY)).toBe(true);
  });

  it('holds the ring for its minimum so it cannot flash', async () => {
    const d = deferred();
    trackWrite(KEY, d.promise);

    await advance(SHOW_DELAY_MS);
    expect(isRingVisible(KEY)).toBe(true);

    // Settles 10ms after it appeared.
    await advance(10);
    d.resolve();
    await advance(0);

    // Still up while the grace and the minimum play out.
    await advance(IDLE_GRACE_MS);
    expect(isRingVisible(KEY)).toBe(true);

    await advance(MIN_VISIBLE_MS);
    expect(isRingVisible(KEY)).toBe(false);
  });

  // The regression that the first design got wrong. VerticalSlider commits on a
  // 250ms leading-edge throttle and each write settles in ~60ms, so the in-flight
  // count is zero for most of a drag. Ending the burst on every such gap cancels
  // and re-arms the delay for ever, and the ring never appears at all.
  it('a dragged slider rings once, not never', async () => {
    let elapsed = 0;
    const step = async (ms: number) => { await advance(ms); elapsed += ms; };

    let sawRing = false;
    // Three seconds of drag: a commit every 250ms, each settling after 60ms.
    for (let i = 0; i < 12; i++) {
      const d = deferred();
      trackWrite(KEY, d.promise);
      await step(60);
      d.resolve();
      await step(0);
      if (elapsed > SHOW_DELAY_MS + IDLE_GRACE_MS) {
        // Once the burst has run past the delay the ring must be up and stay up.
        expect(isRingVisible(KEY)).toBe(true);
        sawRing = true;
      }
      await step(190);
    }
    expect(sawRing).toBe(true);
  });

  it('shows one ring for a gesture that writes several characteristics', async () => {
    const hue = deferred();
    const saturation = deferred();
    trackWrite(KEY, hue.promise);
    trackWrite(KEY, saturation.promise);

    await advance(SHOW_DELAY_MS);
    expect(isRingVisible(KEY)).toBe(true);

    hue.resolve();
    await advance(0);
    expect(isWriting(KEY)).toBe(true); // the other is still out

    saturation.resolve();
    await advance(0);
    await advance(IDLE_GRACE_MS + MIN_VISIBLE_MS);
    expect(isRingVisible(KEY)).toBe(false);
  });

  it('separates the truth from what the ring is willing to say', async () => {
    const d = deferred();
    trackWrite(KEY, d.promise);

    expect(isWriting(KEY)).toBe(true);
    expect(isRingVisible(KEY)).toBe(false);

    d.resolve();
    await advance(SHOW_DELAY_MS + IDLE_GRACE_MS);
  });

  it('clears on rejection exactly as on resolution, and still throws', async () => {
    const d = deferred();
    const tracked = trackWrite(KEY, d.promise);
    const caught = tracked.catch((e) => e);

    await advance(SHOW_DELAY_MS);
    expect(isRingVisible(KEY)).toBe(true);

    d.reject(new Error('relay said no'));
    await advance(0);
    expect(await caught).toBeInstanceOf(Error);

    await advance(IDLE_GRACE_MS + MIN_VISIBLE_MS);
    expect(isRingVisible(KEY)).toBe(false);
  });

  it('returns the caller its own promise, so nothing gains an unhandled rejection', () => {
    const d = deferred();
    const tracked = trackWrite(KEY, d.promise);
    expect(tracked).toBe(d.promise);
    d.resolve();
  });

  it('gives up on a write that never settles', async () => {
    const d = deferred();
    trackWrite(KEY, d.promise);

    await advance(SHOW_DELAY_MS);
    expect(isRingVisible(KEY)).toBe(true);

    await advance(MAX_VISIBLE_MS);
    expect(isRingVisible(KEY)).toBe(false);
    // And the key is clean, so the next write behaves normally rather than
    // inheriting a phantom count.
    expect(isWriting(KEY)).toBe(false);

    const next = deferred();
    trackWrite(KEY, next.promise);
    await advance(SHOW_DELAY_MS);
    expect(isRingVisible(KEY)).toBe(true);
    next.resolve();
  });

  it('rings every key a group write is registered against', async () => {
    const group = groupKey('g1');
    const member = accessoryKey('m1');
    const d = deferred();
    trackWrite([group, member], d.promise);

    await advance(SHOW_DELAY_MS);
    expect(isRingVisible(group)).toBe(true);
    expect(isRingVisible(member)).toBe(true);

    d.resolve();
    await advance(IDLE_GRACE_MS + MIN_VISIBLE_MS);
    expect(isRingVisible(group)).toBe(false);
    expect(isRingVisible(member)).toBe(false);
  });

  it('notifies subscribers on both edges', async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToKey(KEY, listener);
    const d = deferred();
    trackWrite(KEY, d.promise);

    await advance(SHOW_DELAY_MS);
    expect(listener).toHaveBeenCalledTimes(1);

    d.resolve();
    await advance(IDLE_GRACE_MS + MIN_VISIBLE_MS);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  // A tile that unsubscribes and resubscribes must not end up watching an
  // orphaned entry that nothing writes to any more.
  it('keeps notifying after a listener churn', async () => {
    subscribeToKey(KEY, () => {})();

    const listener = vi.fn();
    const unsubscribe = subscribeToKey(KEY, listener);
    const d = deferred();
    trackWrite(KEY, d.promise);
    await advance(SHOW_DELAY_MS);

    expect(listener).toHaveBeenCalled();
    expect(isRingVisible(KEY)).toBe(true);
    d.resolve();
    unsubscribe();
  });

  it('reports false for a key nothing ever registered', () => {
    // The MQTT browser's guarantee: its handlers are fire-and-forget publishes,
    // so its synthetic accessories are never tracked and can never ring.
    expect(isRingVisible(accessoryKey('never-written'))).toBe(false);
    expect(isWriting(accessoryKey('never-written'))).toBe(false);
  });
});
