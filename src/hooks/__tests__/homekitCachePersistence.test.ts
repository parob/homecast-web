// @vitest-environment jsdom
/**
 * The HomeKit cache is persisted so a cold start paints real content instead of
 * a spinner. That makes three things load-bearing, and all three are the kind
 * that fail silently:
 *
 *  - rehydrated entries must keep their ORIGINAL timestamps, so they read as
 *    stale and get revalidated rather than being trusted as fresh;
 *  - anything past the max age must not paint at all;
 *  - the persisted copy must die with the session, or the next account to sign
 *    in on this device sees the previous one's homes on the first frame.
 *
 * The cache module is stateful at module scope, so each case re-imports it with
 * a fresh registry after seeding localStorage.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const PERSIST_KEY = 'homecast-homekit-cache';

// This environment's localStorage is a partial stub (no .clear), so install a
// real one rather than testing against a shape the browser doesn't have.
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

// The cache module pulls in the relay connection; none of it is exercised here.
vi.mock('../../server/connection', () => ({
  serverConnection: {
    request: vi.fn().mockResolvedValue({}),
    isConnected: () => false,
    shouldActivate: () => false,
  },
}));

async function freshCacheModule() {
  vi.resetModules();
  return await import('../useHomeKitData');
}

function seed(entries: Record<string, { data: unknown; timestamp: number }>) {
  localStorage.setItem(PERSIST_KEY, JSON.stringify(entries));
}

describe('HomeKit cache persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useRealTimers();
  });

  it('rehydrates a recent entry so the first paint has content', async () => {
    const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
    seed({ homes: { data: [{ id: 'H1', name: 'County Hall' }], timestamp: tenMinutesAgo } });

    const { getCacheTimestamp } = await freshCacheModule();

    // Present, and still carrying its original age rather than being restamped
    // as fresh — that is what routes it down the revalidate path.
    expect(getCacheTimestamp('homes')).toBe(tenMinutesAgo);
  });

  it('refuses an entry past the 24h max age', async () => {
    const twoDaysAgo = Date.now() - 48 * 60 * 60 * 1000;
    seed({ homes: { data: [{ id: 'H1', name: 'Stale Hall' }], timestamp: twoDaysAgo } });

    const { getCacheTimestamp } = await freshCacheModule();

    expect(getCacheTimestamp('homes')).toBeNull();
  });

  it('ignores a corrupt persisted blob instead of failing the boot', async () => {
    localStorage.setItem(PERSIST_KEY, '{not json');

    const { getCacheTimestamp } = await freshCacheModule();

    expect(getCacheTimestamp('homes')).toBeNull();
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull(); // and cleans up after itself
  });

  it('drops entries with no usable timestamp', async () => {
    seed({
      homes: { data: [{ id: 'H1' }], timestamp: undefined as unknown as number },
      'rooms:H1': { data: [{ id: 'R1' }], timestamp: Date.now() },
    });

    const { getCacheTimestamp } = await freshCacheModule();

    expect(getCacheTimestamp('homes')).toBeNull();
    expect(getCacheTimestamp('rooms:H1')).not.toBeNull();
  });

  it('normalizes rehydrated accessories, so disk data passes the same shape gate as the wire', async () => {
    // Everything off the relay goes through normalizeAccessories; this path
    // used to skip it, which made the first paint after login the one frame
    // where a legacy or half-written record could reach a widget that trusts
    // the declared shape. JSON.stringify writes an array hole as `null`, so
    // this is exactly what a poisoned persisted array looks like on the way in.
    seed({
      'accessories:H1': {
        data: [{ id: 'A1', name: 'Lamp', isReachable: true, services: [] }, null],
        timestamp: Date.now(),
      },
    });

    const { getCachedListLength } = await freshCacheModule();

    expect(getCachedListLength('accessories:H1')).toBe(1);
  });

  it('writes only the prefixes the first screen needs, and coalesces the writes', async () => {
    vi.useFakeTimers();
    const { setServiceGroupsInCache } = await freshCacheModule();

    setServiceGroupsInCache('H1', []);
    expect(localStorage.getItem(PERSIST_KEY)).toBeNull(); // debounced, not synchronous

    await vi.advanceTimersByTimeAsync(2500);

    const written = JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}');
    expect(Object.keys(written)).toContain('serviceGroups:H1');
    vi.useRealTimers();
  });

  // A live value only needs to reach disk before the next cold start. The 2s
  // cadence rewrote the whole snapshot every ~3s on a busy home (681 writes,
  // 1.08 GB in 36 minutes on the production dashboard).
  describe('live values', () => {
    const lamp = (on: boolean) => [{
      id: 'A1', name: 'Lamp', isReachable: true,
      services: [{ serviceType: 'lightbulb', characteristics: [{ characteristicType: 'power_state', value: JSON.stringify(on) }] }],
    }];
    const persistedLamp = () => {
      const written = JSON.parse(localStorage.getItem(PERSIST_KEY) || '{}');
      return written['accessories:H1']?.data?.[0]?.services?.[0]?.characteristics?.[0]?.value;
    };

    it('are written lazily, not on the topology cadence', async () => {
      seed({ 'accessories:H1': { data: lamp(false), timestamp: Date.now() } });
      vi.useFakeTimers();
      const { updateAccessoryCharacteristicInCache } = await freshCacheModule();

      updateAccessoryCharacteristicInCache('H1', 'A1', 'power_state', true);
      await vi.advanceTimersByTimeAsync(2500);
      expect(persistedLamp()).toBe('false');

      await vi.advanceTimersByTimeAsync(60_000);
      expect(persistedLamp()).toBe('true');
      vi.useRealTimers();
    });

    it('coalesce a burst into one write', async () => {
      seed({ 'accessories:H1': { data: lamp(false), timestamp: Date.now() } });
      vi.useFakeTimers();
      const { updateAccessoryCharacteristicInCache } = await freshCacheModule();
      const writes = vi.spyOn(localStorage, 'setItem');

      for (let i = 0; i < 100; i++) {
        updateAccessoryCharacteristicInCache('H1', 'A1', 'power_state', i % 2 === 0);
        await vi.advanceTimersByTimeAsync(500);
      }
      await vi.advanceTimersByTimeAsync(60_000);

      expect(writes.mock.calls.filter(([k]) => k === PERSIST_KEY)).toHaveLength(1);
      writes.mockRestore();
      vi.useRealTimers();
    });

    it('ride along with a topology change instead of waiting', async () => {
      seed({ 'accessories:H1': { data: lamp(false), timestamp: Date.now() } });
      vi.useFakeTimers();
      const { updateAccessoryCharacteristicInCache, setServiceGroupsInCache } = await freshCacheModule();

      updateAccessoryCharacteristicInCache('H1', 'A1', 'power_state', true);
      setServiceGroupsInCache('H1', []);
      await vi.advanceTimersByTimeAsync(2500);

      expect(persistedLamp()).toBe('true');
      vi.useRealTimers();
    });

    it('are flushed when the page is hidden, so the next launch still paints them', async () => {
      seed({ 'accessories:H1': { data: lamp(false), timestamp: Date.now() } });
      vi.useFakeTimers();
      const { updateAccessoryCharacteristicInCache } = await freshCacheModule();

      updateAccessoryCharacteristicInCache('H1', 'A1', 'power_state', true);
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      delete (document as unknown as Record<string, unknown>).visibilityState;

      expect(persistedLamp()).toBe('true');
      vi.useRealTimers();
    });
  });

  it('clears the persisted copy on sign-out', async () => {
    seed({ homes: { data: [{ id: 'H1', name: 'County Hall' }], timestamp: Date.now() } });

    const { getCacheTimestamp, clearPersistedHomeKitCache } = await freshCacheModule();
    expect(getCacheTimestamp('homes')).not.toBeNull();

    clearPersistedHomeKitCache();

    expect(localStorage.getItem(PERSIST_KEY)).toBeNull();
    expect(getCacheTimestamp('homes')).toBeNull();
  });
});
