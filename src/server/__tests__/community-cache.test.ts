// @vitest-environment jsdom
/**
 * The Community/Local Mode read cache in `connection.ts`.
 *
 * This is the layer that made a deleted virtual accessory survive on screen
 * until the page was reloaded. The dashboard dropped its own HomeKit data cache
 * and re-read `accessories.list`; this map answered from memory with the exact
 * pre-delete array, for the rest of its five minutes. Being a module singleton,
 * a reload was the only thing that ever emptied it.
 *
 * Virtual accessories are created and deleted over GraphQL, so they never pass
 * through `CACHE_INVALIDATING_ACTIONS` — the invalidation has to be called
 * directly, which is what these tests pin.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// jsdom's own localStorage isn't callable here; config.ts reads it at import.
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

const HOME_A = 'HOME-AAAA';
const HOME_B = 'HOME-BBBB';

const executeHomeKitAction = vi.fn();

vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: (...args: unknown[]) =>
    (executeHomeKitAction as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));
vi.mock('../../relay/local-handler', () => ({
  executeHomeKitAction: (...args: unknown[]) =>
    (executeHomeKitAction as unknown as (...a: unknown[]) => Promise<unknown>)(...args),
}));

vi.mock('../../hooks/useHomeKitData', () => ({ invalidateHomeKitCache: vi.fn() }));
vi.mock('../../native/homekit-bridge', () => ({
  isRelayCapable: () => false,
  isRelayEnabled: () => false,
}));
vi.mock('../../lib/request-log', () => ({
  beginRequest: () => ({ ok: vi.fn(), fail: vi.fn() }),
  logEvent: vi.fn(),
}));
vi.mock('../../lib/browser-logger', () => ({ browserLogger: { log: vi.fn(), error: vi.fn() } }));
vi.mock('./websocket', () => ({ ServerWebSocket: class {} }));

/** Fresh module per test — the cache is a module-level singleton. */
async function freshModule() {
  vi.resetModules();
  return await import('@/server/connection');
}

function accessories(...names: string[]) {
  return { accessories: names.map(n => ({ id: n, name: n })) };
}

beforeEach(() => {
  executeHomeKitAction.mockReset();
  vi.useRealTimers();
});

describe('communityRequest — accessory read cache', () => {
  it('serves a repeat accessories.list from memory', async () => {
    const { communityRequest } = await freshModule();
    executeHomeKitAction.mockResolvedValue(accessories('lamp'));

    await communityRequest('accessories.list', { homeId: HOME_A });
    await communityRequest('accessories.list', { homeId: HOME_A });

    expect(executeHomeKitAction).toHaveBeenCalledTimes(1);
  });

  it('goes back to the relay after invalidateCommunityAccessories', async () => {
    const { communityRequest, invalidateCommunityAccessories } = await freshModule();
    executeHomeKitAction.mockResolvedValueOnce(accessories('lamp', 'away-mode'));
    executeHomeKitAction.mockResolvedValueOnce(accessories('lamp'));

    await communityRequest('accessories.list', { homeId: HOME_A });
    invalidateCommunityAccessories();
    const after: any = await communityRequest('accessories.list', { homeId: HOME_A });

    expect(executeHomeKitAction).toHaveBeenCalledTimes(2);
    // The whole point: the deleted helper is gone from what the caller gets.
    expect(after.accessories.map((a: any) => a.id)).toEqual(['lamp']);
  });

  it('spares another home when scoped to one', async () => {
    const { communityRequest, invalidateCommunityAccessories } = await freshModule();
    executeHomeKitAction.mockResolvedValue(accessories('lamp'));

    await communityRequest('accessories.list', { homeId: HOME_A });
    await communityRequest('accessories.list', { homeId: HOME_B });
    expect(executeHomeKitAction).toHaveBeenCalledTimes(2);

    invalidateCommunityAccessories(HOME_A);
    await communityRequest('accessories.list', { homeId: HOME_A });   // refetched
    await communityRequest('accessories.list', { homeId: HOME_B });   // still cached

    expect(executeHomeKitAction).toHaveBeenCalledTimes(3);
  });

  it('clears every home when scoped to none', async () => {
    const { communityRequest, invalidateCommunityAccessories } = await freshModule();
    executeHomeKitAction.mockResolvedValue(accessories('lamp'));

    await communityRequest('accessories.list', { homeId: HOME_A });
    await communityRequest('accessories.list', { homeId: HOME_B });
    invalidateCommunityAccessories();
    await communityRequest('accessories.list', { homeId: HOME_A });
    await communityRequest('accessories.list', { homeId: HOME_B });

    expect(executeHomeKitAction).toHaveBeenCalledTimes(4);
  });

  it('leaves unrelated cached reads alone', async () => {
    const { communityRequest, invalidateCommunityAccessories } = await freshModule();
    executeHomeKitAction.mockResolvedValue({ homes: [] });

    await communityRequest('homes.list', {});
    invalidateCommunityAccessories();
    await communityRequest('homes.list', {});

    expect(executeHomeKitAction).toHaveBeenCalledTimes(1);
  });

  it('does not let a read started before the invalidation write itself back', async () => {
    const { communityRequest, invalidateCommunityAccessories } = await freshModule();

    // Seed, then age the entry past the TTL so the next read takes the
    // stale-hit path: return what we have, refresh in the background.
    executeHomeKitAction.mockResolvedValueOnce(accessories('lamp', 'away-mode'));
    await communityRequest('accessories.list', { homeId: HOME_A });

    vi.useFakeTimers();
    vi.advanceTimersByTime(6 * 60 * 1000);

    let releaseRefresh!: (v: unknown) => void;
    executeHomeKitAction.mockReturnValueOnce(new Promise(r => { releaseRefresh = r; }));
    await communityRequest('accessories.list', { homeId: HOME_A });   // kicks off the refresh
    expect(executeHomeKitAction).toHaveBeenCalledTimes(2);

    // The delete lands while that refresh is still in flight...
    invalidateCommunityAccessories();
    // ...and the refresh then answers with the pre-delete set.
    releaseRefresh(accessories('lamp', 'away-mode'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();

    executeHomeKitAction.mockResolvedValueOnce(accessories('lamp'));
    const after: any = await communityRequest('accessories.list', { homeId: HOME_A });

    expect(executeHomeKitAction).toHaveBeenCalledTimes(3);
    expect(after.accessories.map((a: any) => a.id)).toEqual(['lamp']);
  });
});
