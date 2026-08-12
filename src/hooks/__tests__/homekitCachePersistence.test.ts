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

  it('clears the persisted copy on sign-out', async () => {
    seed({ homes: { data: [{ id: 'H1', name: 'County Hall' }], timestamp: Date.now() } });

    const { getCacheTimestamp, clearPersistedHomeKitCache } = await freshCacheModule();
    expect(getCacheTimestamp('homes')).not.toBeNull();

    clearPersistedHomeKitCache();

    expect(localStorage.getItem(PERSIST_KEY)).toBeNull();
    expect(getCacheTimestamp('homes')).toBeNull();
  });
});
