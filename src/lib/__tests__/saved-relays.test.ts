// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.hoisted(() => {
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
});

import {
  mergeHealth, upsertRelay, addManualAddress, removeAddress, candidateOrigins,
  loadRelays, saveRelays, rememberConnection, forgetSavedRelay, migrateLegacyRelay,
  type SavedRelay,
} from '../saved-relays';
import type { RelayHealth } from '../relay-probe';

const LAN = 'http://192.168.1.211:5656';
const MESH = 'http://100.93.89.109:5656';
const TUNNEL = 'https://home.example.com';

function health(over: Partial<RelayHealth> = {}): RelayHealth {
  return {
    origin: LAN,
    instanceId: '37d65040',
    name: 'Home Mac',
    wsPort: 5657,
    authEnabled: false,
    addresses: [LAN, MESH],
    ...over,
  };
}

describe('mergeHealth', () => {
  it('learns the addresses the relay advertises', () => {
    // The whole point: pair on the sofa, gain the address that works from a train.
    const r = mergeHealth(null, health());
    expect(r.addresses.map(a => a.origin)).toEqual([LAN, MESH]);
    expect(r.addresses.find(a => a.origin === MESH)?.source).toBe('advertised');
  });

  it('never drops a typed address, even though /health does not mention it', () => {
    // The relay can only advertise interfaces it can see. A tunnel hostname is
    // invisible to it, so treating /health as the complete list would delete
    // the one address that works from outside the house.
    const existing: SavedRelay = {
      id: '37d65040', name: 'Home Mac',
      addresses: [{ origin: TUNNEL, source: 'manual' }],
      wsPort: 5657, authEnabled: false, lastConnectedOrigin: TUNNEL, lastSeenAt: 1,
    };
    const r = mergeHealth(existing, health());
    expect(r.addresses.map(a => a.origin)).toContain(TUNNEL);
    expect(r.addresses.find(a => a.origin === TUNNEL)?.source).toBe('manual');
  });

  it('keeps an address the provenance it was added under', () => {
    const existing: SavedRelay = {
      id: '37d65040', name: 'Home Mac',
      addresses: [{ origin: MESH, source: 'manual' }],
      wsPort: null, authEnabled: null, lastConnectedOrigin: null, lastSeenAt: null,
    };
    // /health also advertises MESH, but it was typed — that is worth knowing.
    const r = mergeHealth(existing, health());
    expect(r.addresses.find(a => a.origin === MESH)?.source).toBe('manual');
  });

  it('stamps only the address that actually answered', () => {
    const r = mergeHealth(null, health({ origin: LAN }), 'discovered', 1000);
    expect(r.addresses.find(a => a.origin === LAN)?.lastOkAt).toBe(1000);
    expect(r.addresses.find(a => a.origin === MESH)?.lastOkAt).toBeUndefined();
  });

  it('remembers where it got through, for next time', () => {
    const r = mergeHealth(null, health({ origin: MESH }));
    expect(r.lastConnectedOrigin).toBe(MESH);
  });

  it('does not deduplicate away the answering address', () => {
    const r = mergeHealth(null, health({ origin: LAN }));
    expect(r.addresses.filter(a => a.origin === LAN)).toHaveLength(1);
  });

  it('keeps what it knew when the relay goes quiet on a field', () => {
    const existing: SavedRelay = {
      id: '37d65040', name: 'Home Mac',
      addresses: [{ origin: LAN, source: 'manual' }],
      wsPort: 5657, authEnabled: true, lastConnectedOrigin: LAN, lastSeenAt: 1,
    };
    // An older relay reports no name, no ws port and no auth state.
    const r = mergeHealth(existing, health({ name: null, wsPort: null, authEnabled: null, addresses: [] }));
    expect(r).toMatchObject({ name: 'Home Mac', wsPort: 5657, authEnabled: true });
  });
});

describe('upsertRelay', () => {
  const a: SavedRelay = { id: 'a', name: 'A', addresses: [], wsPort: null, authEnabled: null, lastConnectedOrigin: null, lastSeenAt: null };
  const b: SavedRelay = { ...a, id: 'b', name: 'B' };

  it('appends a new relay', () => {
    expect(upsertRelay([a], b).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('replaces in place, keeping order', () => {
    const updated = { ...a, name: 'A2' };
    const out = upsertRelay([a, b], updated);
    expect(out.map(r => r.id)).toEqual(['a', 'b']);
    expect(out[0].name).toBe('A2');
  });

  it('refuses a relay with no id — there would be no way to find it again', () => {
    expect(upsertRelay([a], { ...b, id: '' })).toEqual([a]);
  });
});

describe('addManualAddress / removeAddress', () => {
  const relay: SavedRelay = {
    id: '37d65040', name: 'Home Mac',
    addresses: [{ origin: LAN, source: 'discovered' }],
    wsPort: null, authEnabled: null, lastConnectedOrigin: LAN, lastSeenAt: null,
  };

  it('adds a typed address as manual', () => {
    const r = addManualAddress(relay, TUNNEL);
    expect(r.addresses.find(a => a.origin === TUNNEL)?.source).toBe('manual');
  });

  it('ignores a duplicate', () => {
    expect(addManualAddress(relay, LAN).addresses).toHaveLength(1);
  });

  it('removes one, and forgets it as last-connected', () => {
    const two = addManualAddress(relay, TUNNEL);
    const r = removeAddress(two, LAN);
    expect(r.addresses.map(a => a.origin)).toEqual([TUNNEL]);
    expect(r.lastConnectedOrigin).toBeNull();
  });

  it('refuses to remove the last address — that is forgetting the relay', () => {
    expect(removeAddress(relay, LAN).addresses).toHaveLength(1);
  });
});

describe('candidateOrigins', () => {
  it('puts last-known-good first, without repeating it', () => {
    const relay: SavedRelay = {
      id: 'x', name: '', wsPort: null, authEnabled: null, lastSeenAt: null,
      addresses: [{ origin: LAN, source: 'discovered' }, { origin: MESH, source: 'advertised' }],
      lastConnectedOrigin: MESH,
    };
    expect(candidateOrigins(relay)).toEqual([MESH, LAN]);
  });

  it('is just the addresses when nothing has worked yet', () => {
    const relay: SavedRelay = {
      id: 'x', name: '', wsPort: null, authEnabled: null, lastSeenAt: null,
      addresses: [{ origin: LAN, source: 'discovered' }],
      lastConnectedOrigin: null,
    };
    expect(candidateOrigins(relay)).toEqual([LAN]);
  });
});

describe('storage', () => {
  beforeEach(() => { localStorage.clear(); });

  it('round-trips', () => {
    const r = mergeHealth(null, health());
    saveRelays([r]);
    expect(loadRelays()).toEqual([r]);
  });

  it('survives junk in the store rather than taking the picker down', () => {
    localStorage.setItem('homecast-relays', 'not json');
    expect(loadRelays()).toEqual([]);
  });

  it('drops a half-written record instead of returning it', () => {
    localStorage.setItem('homecast-relays', JSON.stringify([{ name: 'no id' }, null]));
    expect(loadRelays()).toEqual([]);
  });

  it('remembers a connection under the relay id', () => {
    const saved = rememberConnection(health(), 'discovered');
    expect(saved?.id).toBe('37d65040');
    expect(loadRelays()).toHaveLength(1);
  });

  it('updates rather than duplicating on reconnect', () => {
    rememberConnection(health());
    rememberConnection(health({ origin: MESH }));
    const list = loadRelays();
    expect(list).toHaveLength(1);
    expect(list[0].lastConnectedOrigin).toBe(MESH);
  });

  it('will not file a relay that has no stable id', () => {
    expect(rememberConnection(health({ instanceId: null }))).toBeNull();
    expect(loadRelays()).toEqual([]);
  });

  it('forgets one relay and leaves the others', () => {
    rememberConnection(health());
    rememberConnection(health({ instanceId: 'other', origin: TUNNEL, addresses: [] }));
    expect(forgetSavedRelay('37d65040').map(r => r.id)).toEqual(['other']);
  });
});

describe('migrateLegacyRelay', () => {
  beforeEach(() => { localStorage.clear(); });

  it('folds the old scalars into a record', () => {
    const r = migrateLegacyRelay(LAN, 5657, '37d65040', 'Home Mac');
    expect(r).toMatchObject({ id: '37d65040', wsPort: 5657, lastConnectedOrigin: LAN });
    expect(r?.addresses).toEqual([{ origin: LAN, source: 'manual' }]);
    expect(loadRelays()).toHaveLength(1);
  });

  it('is a no-op once the relay is already known', () => {
    rememberConnection(health());
    expect(migrateLegacyRelay(LAN, 5657, '37d65040')).toBeNull();
    expect(loadRelays()).toHaveLength(1);
  });

  it('needs both an address and an id — an unidentified relay cannot be filed', () => {
    expect(migrateLegacyRelay(LAN, null, null)).toBeNull();
    expect(migrateLegacyRelay(null, null, '37d65040')).toBeNull();
    expect(loadRelays()).toEqual([]);
  });
});
