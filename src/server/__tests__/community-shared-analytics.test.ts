/**
 * Analytics over a share link, Community Edition.
 *
 * The shapes here are the CE/cloud parity contract: the cloud server answers
 * the same documents with the same shapes, and its pytest suite
 * (test_public_entity_history.py) mirrors these cases assertion for assertion.
 *
 * Two opt-ins gate every read — the home records, AND its owner published that
 * to link holders — and then only the accessories the link expands to. Most of
 * what follows is denial, deliberately: off is the default for every home that
 * already exists, so off is the behaviour that must not regress.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockDb = {
  access: new Map<string, any>(),
  settings: new Map<string, string>(),
  series: [] as any[],
};

vi.mock('@/server/local-db', () => ({
  getEntityAccess: vi.fn(async () => Array.from(mockDb.access.values())),
  putEntityAccess: vi.fn(async (a: any) => { mockDb.access.set(a.id, a); }),
  deleteEntityAccess: vi.fn(async (id: string) => { mockDb.access.delete(id); }),
  getSetting: vi.fn(async (k: string) => mockDb.settings.get(k) ?? null),
  setSetting: vi.fn(async (k: string, v: string) => { mockDb.settings.set(k, v); }),
  getUsers: vi.fn(async () => []),
  getAutomations: vi.fn(async () => []),
  getCollections: vi.fn(async () => []),
  getRoomGroups: vi.fn(async () => []),
  getStoredEntities: vi.fn(async () => []),
  getHistorySeries: vi.fn(async () => mockDb.series),
  getHistorySeriesById: vi.fn(async (id: string) => mockDb.series.find(s => s.id === id) ?? null),
  getHistorySamples: vi.fn(async () => []),
  getLastHistorySampleBefore: vi.fn(async () => null),
  countHistorySamples: vi.fn(async () => 0),
  getHistoryStorageStats: vi.fn(async () => ({
    seriesCount: 0, sampleRows: 0, rollupRows: 0, oldestSampleTs: null,
  })),
}));

const HOME = 'F9015AD6-FCFD-5336-B9E0-1181C011BEFC';
const KITCHEN = 'C0000000-0000-4000-8000-000000000001';
const LAMP = 'A0000000-0000-4000-8000-000000000001';   // in the Kitchen
const SOFA = 'A0000000-0000-4000-8000-000000000002';   // in the Lounge

// The relay answers with live HomeKit ids, filtered by room when asked.
vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async (action: string, payload: any) => {
    const all = [
      { id: LAMP, name: 'Lamp', homeId: HOME, roomId: KITCHEN, services: [] },
      { id: SOFA, name: 'Sofa Light', homeId: HOME, roomId: 'C0000000-0000-4000-8000-000000000002', services: [] },
    ];
    if (action === 'accessories.list') {
      const room = payload?.roomId;
      return { accessories: room ? all.filter(a => a.roomId === room) : all };
    }
    if (action === 'serviceGroups.list') return { serviceGroups: [] };
    if (action === 'accessory.get') {
      return { accessory: all.find(a => a.id === payload?.accessoryId) ?? null };
    }
    return null;
  }),
}));
vi.mock('@/server/connection', () => ({ communityRequest: vi.fn(async () => null) }));
vi.mock('@/server/local-server', () => ({
  refreshAuthEnabled: vi.fn(async () => {}),
  refreshRelayName: vi.fn(async () => {}),
  clearAuthenticatedClients: vi.fn(() => {}),
}));
// local-history reaches for IndexedDB at import time. The per-home config is
// a plain read-modify-write record, so an in-memory stand-in exercises the
// resolver cases exactly — including that neither toggle erases the other.
vi.mock('@/server/local-history', () => {
  const configs: Record<string, any> = {};
  return {
    DEFAULT_RAW_RETENTION_DAYS: 0,
    getHistoryHomeConfigs: vi.fn(async () => configs),
    setHistoryHomeConfig: vi.fn(async (homeId: string, config: any) => {
      configs[homeId.toUpperCase()] = config;
    }),
    __configs: configs,
  };
});

vi.mock('@/history/query', () => ({
  queryHistorySeries: vi.fn(async () => ({
    resolution: 'raw', prevValue: null, prevValueText: null,
    points: [{ ts: 1, min: 1, avg: 1, max: 1, last: 1, count: 1 }],
    states: [], stateBuckets: [],
  })),
}));

import { handleGraphQL } from '@/server/local-graphql';

const call = (operationName: string, variables: Record<string, unknown> = {}) =>
  handleGraphQL({ operationName, variables }) as Promise<any>;

const HASH = 'h0000000abcd';

function share(entityType: string, entityId: string, homeId: string | null = HOME) {
  mockDb.access.set('a1', {
    id: 'a1', shareHash: HASH, entityType, entityId, homeId,
    accessType: 'public', role: 'view', entityName: 'Shared',
  });
}

async function setFlags(enabled: boolean, sharedAnalytics: boolean) {
  await call('SetHomeHistoryEnabled', { homeId: HOME, enabled });
  await call('SetHomeSharedAnalyticsEnabled', { homeId: HOME, enabled: sharedAnalytics });
}

beforeEach(async () => {
  mockDb.access.clear();
  mockDb.settings.clear();
  const history = await import('@/server/local-history');
  for (const k of Object.keys((history as any).__configs)) {
    delete (history as any).__configs[k];
  }
  mockDb.series = [
    { id: `${HOME}|${LAMP}|power_state`, accessoryId: LAMP, characteristicType: 'power_state', kind: 'bool' },
    { id: `${HOME}|${SOFA}|power_state`, accessoryId: SOFA, characteristicType: 'power_state', kind: 'bool' },
  ];
});

const refs = (accessoryId: string) => [{ accessoryId, characteristicType: 'power_state' }];

describe('the per-home flag', () => {
  it('is off until it is switched on', async () => {
    const res = await call('GetHistoryStorageStats', { homeId: HOME });
    expect(res.data.historyStorageStats.sharedAnalyticsEnabled).toBe(false);
  });

  it('round-trips', async () => {
    await setFlags(true, true);
    const res = await call('GetHistoryStorageStats', { homeId: HOME });
    expect(res.data.historyStorageStats.sharedAnalyticsEnabled).toBe(true);
    expect(res.data.historyStorageStats.enabled).toBe(true);
  });

  it('survives the recording toggle being flipped', async () => {
    // Turning recording off must not discard a separate decision about
    // sharing — otherwise switching recording back on quietly re-publishes.
    await setFlags(true, true);
    await call('SetHomeHistoryEnabled', { homeId: HOME, enabled: false });
    let res = await call('GetHistoryStorageStats', { homeId: HOME });
    expect(res.data.historyStorageStats.sharedAnalyticsEnabled).toBe(true);

    await call('SetHomeHistoryEnabled', { homeId: HOME, enabled: true });
    res = await call('GetHistoryStorageStats', { homeId: HOME });
    expect(res.data.historyStorageStats.sharedAnalyticsEnabled).toBe(true);
  });

  it('does not clobber the recording toggle either', async () => {
    await setFlags(true, false);
    await call('SetHomeSharedAnalyticsEnabled', { homeId: HOME, enabled: true });
    const res = await call('GetHistoryStorageStats', { homeId: HOME });
    expect(res.data.historyStorageStats.enabled).toBe(true);
  });
});

describe('what the share page is told', () => {
  it('reports analytics off unless BOTH opt-ins are set', async () => {
    share('home', HOME);
    for (const [rec, shared] of [[false, false], [true, false], [false, true]] as const) {
      await setFlags(rec, shared);
      const res = await call('GetPublicEntity', { shareHash: HASH });
      expect(res.data.publicEntity.analyticsEnabled).toBe(false);
    }
  });

  it('reports analytics on when both are set', async () => {
    share('home', HOME);
    await setFlags(true, true);
    const res = await call('GetPublicEntity', { shareHash: HASH });
    expect(res.data.publicEntity.analyticsEnabled).toBe(true);
  });
});

describe('reading analytics through a share link', () => {
  it('is refused unless both opt-ins are set', async () => {
    share('home', HOME);
    for (const [rec, shared] of [[false, false], [true, false], [false, true]] as const) {
      await setFlags(rec, shared);
      const series = await call('GetPublicEntityHistorySeries', { shareHash: HASH });
      expect(series.errors).toBeDefined();
      const data = await call('GetPublicEntityHistory', {
        shareHash: HASH, series: refs(LAMP), fromTs: 0, toTs: 1_000_000,
      });
      expect(data.errors).toBeDefined();
    }
  });

  it('serves the home when both are set', async () => {
    share('home', HOME);
    await setFlags(true, true);
    const series = await call('GetPublicEntityHistorySeries', { shareHash: HASH });
    expect(series.errors).toBeUndefined();
    expect(series.data.publicEntityHistorySeries.map((s: any) => s.accessoryId).sort())
      .toEqual([LAMP, SOFA].sort());
  });

  it('is refused when a passcode-gated share is asked without the passcode', async () => {
    // The hash alone must not open a share whose owner put a passcode on it.
    mockDb.access.clear();
    mockDb.access.set('p1', {
      id: 'p1', shareHash: HASH, entityType: 'home', entityId: HOME, homeId: HOME,
      accessType: 'passcode', passcode: '1234', role: 'view', entityName: 'Shared',
    });
    await setFlags(true, true);

    const noCode = await call('GetPublicEntityHistorySeries', { shareHash: HASH });
    expect(noCode.errors).toBeDefined();

    const wrong = await call('GetPublicEntityHistorySeries', { shareHash: HASH, passcode: '9999' });
    expect(wrong.errors).toBeDefined();

    const right = await call('GetPublicEntityHistorySeries', { shareHash: HASH, passcode: '1234' });
    expect(right.errors).toBeUndefined();
    expect(right.data.publicEntityHistorySeries).toHaveLength(2);
  });

  it('is refused for a hash that matches nothing', async () => {
    await setFlags(true, true);
    const res = await call('GetPublicEntityHistorySeries', { shareHash: 'nope' });
    expect(res.errors).toBeDefined();
  });
});

describe('scope', () => {
  it('a room share lists only that room', async () => {
    share('room', KITCHEN);
    await setFlags(true, true);
    const series = await call('GetPublicEntityHistorySeries', { shareHash: HASH });
    expect(series.data.publicEntityHistorySeries.map((s: any) => s.accessoryId)).toEqual([LAMP]);
  });

  it('refuses an accessory outside the share', async () => {
    // Refused, not answered empty: an empty answer is indistinguishable from
    // "recorded nothing", which would let a link holder enumerate the home.
    share('room', KITCHEN);
    await setFlags(true, true);
    const res = await call('GetPublicEntityHistory', {
      shareHash: HASH, series: refs(SOFA), fromTs: 0, toTs: 1_000_000,
    });
    expect(res.errors).toBeDefined();
    expect(res.data).toBeNull();
  });

  it('rejects the whole batch when one ref is out of scope', async () => {
    share('room', KITCHEN);
    await setFlags(true, true);
    const res = await call('GetPublicEntityHistory', {
      shareHash: HASH,
      series: [...refs(LAMP), ...refs(SOFA)],
      fromTs: 0, toTs: 1_000_000,
    });
    expect(res.errors).toBeDefined();
  });

  it('serves an in-scope accessory', async () => {
    share('room', KITCHEN);
    await setFlags(true, true);
    const res = await call('GetPublicEntityHistory', {
      shareHash: HASH, series: refs(LAMP), fromTs: 0, toTs: 1_000_000,
    });
    expect(res.errors).toBeUndefined();
    expect(res.data.publicEntityHistory).toHaveLength(1);
    expect(res.data.publicEntityHistory[0].accessoryId).toBe(LAMP);
  });

  it('an accessory share sees only itself', async () => {
    share('accessory', LAMP);
    await setFlags(true, true);
    const series = await call('GetPublicEntityHistorySeries', { shareHash: HASH });
    expect(series.data.publicEntityHistorySeries.map((s: any) => s.accessoryId)).toEqual([LAMP]);
    const res = await call('GetPublicEntityHistory', {
      shareHash: HASH, series: refs(SOFA), fromTs: 0, toTs: 1_000_000,
    });
    expect(res.errors).toBeDefined();
  });
});

describe('caps', () => {
  it('enforces the 1-6 series wire cap server-side', async () => {
    share('home', HOME);
    await setFlags(true, true);
    const seven = Array.from({ length: 7 }, (_, i) => ({
      accessoryId: LAMP, characteristicType: `c${i}`,
    }));
    const tooMany = await call('GetPublicEntityHistory', {
      shareHash: HASH, series: seven, fromTs: 0, toTs: 1_000_000,
    });
    expect(tooMany.errors).toBeDefined();

    const none = await call('GetPublicEntityHistory', {
      shareHash: HASH, series: [], fromTs: 0, toTs: 1_000_000,
    });
    expect(none.errors).toBeDefined();
  });
});
