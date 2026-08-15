// @vitest-environment jsdom
/**
 * "Close the app, change an accessory, reopen — still shows the old state, and
 * pulling to refresh fixes it."
 *
 * Two independent failures, both invisible because the app now paints real
 * content from disk instead of a spinner:
 *
 *  1. Reopen INSIDE the 5-minute staleTime and no refresh is attempted at all —
 *     fetchData returns early on `hasCachedData && !isStale`. Freshness is a
 *     timer, but the app was not running, so the timer measured nothing. This
 *     is the common case: nobody waits five minutes before reopening.
 *  2. Reopen after it, and the refresh IS attempted — but the mount fetch runs
 *     before the WebSocket exists, serverConnection.request() throws, and
 *     useCachedData gives up after two retries with nothing to retrigger it.
 *
 * The fix is one revalidation signal, fired when the transport becomes usable
 * and when the app returns from hidden, that forces a refetch regardless of
 * how fresh the entry claims to be.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  },
});

const request = vi.fn();
vi.mock('../../server/connection', () => ({
  serverConnection: { request: (...a: unknown[]) => request(...a) },
}));

const PERSIST_KEY = 'homecast-homekit-cache';

/** Seed the disk cache the way a previous session would have left it. */
function seedDisk(homes: unknown[], ageMs = 60_000) {
  store.set(PERSIST_KEY, JSON.stringify({
    homes: { data: homes, timestamp: Date.now() - ageMs },
  }));
}

/** Older than staleTime (5 min), so the mount fetch actually fires. */
const PAST_STALE = 10 * 60_000;

async function freshModule() {
  vi.resetModules();
  return import('../useHomeKitData');
}

describe('revalidating when the connection comes up', () => {
  beforeEach(() => {
    store.clear();
    request.mockReset();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => { vi.useRealTimers(); });

  it('refreshes a cache that reopened inside its stale window', async () => {
    // Failure 1, and the one users actually hit: reopen a minute later and the
    // entry still looks fresh, so nothing is fetched. It is not fresh — we were
    // not running, and an accessory changed while we were not looking.
    seedDisk([{ id: 'H1', name: 'Old Name' }], 60_000);
    request.mockResolvedValue({ homes: [{ id: 'H1', name: 'Changed While Away' }] });

    const { useHomes, revalidateHomeKitCache } = await freshModule();
    const { result } = renderHook(() => useHomes());

    expect(result.current.data).toEqual([{ id: 'H1', name: 'Old Name' }]);

    // The stuck state: no request is even attempted, however long you wait.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).not.toHaveBeenCalled();

    await act(async () => { revalidateHomeKitCache(); });

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'H1', name: 'Changed While Away' }]));
  });

  it('recovers after every startup fetch failed with no socket', async () => {
    seedDisk([{ id: 'H1', name: 'Old Name' }], PAST_STALE);
    // Exactly what serverConnection.request() throws before activate() runs.
    request.mockRejectedValue(new Error('[ServerConnection] Not active - cannot make request'));

    const { useHomes, revalidateHomeKitCache } = await freshModule();
    const { result } = renderHook(() => useHomes());

    // Hydrated data paints immediately — this is the optimisation working, and
    // also what hid the failure.
    expect(result.current.data).toEqual([{ id: 'H1', name: 'Old Name' }]);

    // Burn through both retries (3s apart) so the hook is well and truly done.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    const attemptsBefore = request.mock.calls.length;
    expect(attemptsBefore).toBeGreaterThan(0);

    // Nothing further happens on its own — this is the stuck state users saw.
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request.mock.calls.length).toBe(attemptsBefore);

    // Socket comes up.
    request.mockReset();
    request.mockResolvedValue({ homes: [{ id: 'H1', name: 'New Name' }] });
    await act(async () => { revalidateHomeKitCache(); });

    await waitFor(() => expect(result.current.data).toEqual([{ id: 'H1', name: 'New Name' }]));
  });

  it('keeps showing the cached data while revalidating, with no loading flash', async () => {
    // The reason this is revalidate and not invalidate: dropping the entry
    // empties the screen and shoves the layout about on every reconnect.
    seedDisk([{ id: 'H1', name: 'Old Name' }]);

    const { useHomes, revalidateHomeKitCache } = await freshModule();
    const { result } = renderHook(() => useHomes());

    let resolveIt: (v: unknown) => void = () => {};
    request.mockReturnValue(new Promise((r) => { resolveIt = r; }));
    await act(async () => { revalidateHomeKitCache(); });

    // Mid-flight: still painted, still not "loading".
    expect(result.current.data).toEqual([{ id: 'H1', name: 'Old Name' }]);
    expect(result.current.loading).toBe(false);

    await act(async () => { resolveIt({ homes: [{ id: 'H1', name: 'Fresh' }] }); });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 'H1', name: 'Fresh' }]));
  });
});
