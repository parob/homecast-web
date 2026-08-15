// The identity map's memory, and what the UI is allowed to say about it.
//
// Every case here is the same incident from a different angle: Local Mode
// engaged, the map was fine, and Settings said "Not matched yet" anyway —
// because the only thing that ever set that status was a *successful* sync, and
// a sync cannot succeed in the situation Local Mode exists for.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// This environment's localStorage is a partial stub (no .clear), so install a
// real one — same treatment homekitCachePersistence.test.ts gives it.
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

vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: { listHomes: vi.fn(async () => []) },
}));
vi.mock('../../relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async () => ({})),
}));

const reconcileLocalTopology = vi.fn();
vi.mock('../../lib/graphql/local-identity-api', () => ({ reconcileLocalTopology }));

import { localIdentity } from '../local-identity';
import { identityFrom } from '../local-mode';

const USER = 'user-1';

/** What `sync()` writes, in the shape `load()` expects to find. */
function seed(user: string, matched: number, reported: number) {
  localStorage.setItem(`homecast-local-identity:${user}`, JSON.stringify({
    live: { 'AAAAAAAA-0000-0000-0000-000000000001': 'hc-1' },
    topologyHash: 'h',
    reportedAt: Date.now(),
    matched,
    reported,
  }));
}

describe('localIdentity — remembering a match across restarts', () => {
  beforeEach(() => {
    store.clear();
    reconcileLocalTopology.mockReset();
  });

  it('has no counts for a user it has never seen', () => {
    localIdentity.load('a-user-with-nothing-stored');

    expect(localIdentity.counts()).toBeNull();
    expect(localIdentity.hasMap()).toBe(false);
  });

  it('restores the last known counts from storage', () => {
    seed(USER, 7, 9);
    localIdentity.load(USER);

    expect(localIdentity.counts()).toEqual({ matched: 7, reported: 9 });
    expect(localIdentity.hasMap()).toBe(true);
    // The point of the whole exercise: an offline launch can still say what it
    // matched, without a sync it has no way to perform.
    expect(identityFrom(localIdentity.counts())).toMatchObject({ identityState: 'partial' });
  });

  it('adopts the last signed-in user before auth has answered', async () => {
    // The launch this exists for is the offline one: `getMe()` never resolves,
    // so `AuthContext` never calls `load()`, so without this Local Mode comes
    // up on raw Apple Home names with a map sitting right there in storage.
    const user = 'user-offline';
    seed(user, 5, 5);
    localIdentity.load(user);
    expect(localIdentity.hasMap()).toBe(true);

    vi.resetModules();
    const { localIdentity: nextLaunch } = await import('../local-identity');
    expect(nextLaunch.hasMap()).toBe(false);

    nextLaunch.loadLast();

    expect(nextLaunch.hasUser()).toBe(true);
    expect(nextLaunch.counts()).toEqual({ matched: 5, reported: 5 });
  });

  it('forgets the map on sign-out, so the next account starts clean', async () => {
    const user = 'user-signing-out';
    seed(user, 5, 5);
    localIdentity.load(user);

    localIdentity.forget();

    expect(localIdentity.hasMap()).toBe(false);
    expect(localIdentity.counts()).toBeNull();

    vi.resetModules();
    const { localIdentity: nextLaunch } = await import('../local-identity');
    nextLaunch.loadLast();
    expect(nextLaunch.hasUser()).toBe(false);
  });

  it('refuses to report a topology before a user is known', async () => {
    // The controller starts on module load, well before `getMe()` answers, so
    // this is the state it genuinely boots in. A report issued now cannot be
    // persisted — the storage key needs the user — so it would spend a mutation
    // and then drop the map it was given.
    vi.resetModules();
    const { localIdentity: fresh } = await import('../local-identity');
    reconcileLocalTopology.mockResolvedValue({ map: {}, unmatched: {}, matched: 3, reported: 3 });

    expect(fresh.hasUser()).toBe(false);
    await expect(fresh.sync(true)).resolves.toBeNull();
    expect(reconcileLocalTopology).not.toHaveBeenCalled();
  });
});

describe('identityFrom — what Settings and the badge are told', () => {
  it('reports unmapped when nothing has been reported yet', () => {
    expect(identityFrom(null)).toEqual({ identityState: 'unmapped', matched: 0, reported: 0 });
  });

  it('keeps the counts when a report matched nothing', () => {
    // Distinct from "not reported yet": this device is looking at a different
    // Apple Home than the relay, and the copy says so.
    expect(identityFrom({ matched: 0, reported: 12 }))
      .toEqual({ identityState: 'unmapped', matched: 0, reported: 12 });
  });

  it('reports partial when some matched', () => {
    expect(identityFrom({ matched: 4, reported: 9 }))
      .toEqual({ identityState: 'partial', matched: 4, reported: 9 });
  });

  it('reports mapped when all matched', () => {
    expect(identityFrom({ matched: 9, reported: 9 }))
      .toEqual({ identityState: 'mapped', matched: 9, reported: 9 });
  });
});
