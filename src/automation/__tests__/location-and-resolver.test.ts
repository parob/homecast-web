/**
 * Coverage for the two support modules added when wiring the engine up:
 * home-location resolution (sun triggers) and the service-group reverse index.
 *
 * Both were shipped at ~8-18% coverage. They're small but load-bearing: without
 * the resolver, service-group triggers silently never fire; without a location,
 * sun triggers resolve against lat 0 / lon 0.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const listHomes = vi.fn();
const listServiceGroups = vi.fn();

vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: {
    listHomes: (...a: unknown[]) => listHomes(...a),
    listServiceGroups: (...a: unknown[]) => listServiceGroups(...a),
  },
  default: {
    listHomes: (...a: unknown[]) => listHomes(...a),
    listServiceGroups: (...a: unknown[]) => listServiceGroups(...a),
  },
}));

import { HomeKitServiceGroupResolver } from '../service-group-resolver';
import { resolveHomeLocation } from '../location';

beforeEach(() => {
  vi.clearAllMocks();
  listHomes.mockResolvedValue([{ id: 'home-1', name: 'Home' }]);
  listServiceGroups.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  delete (globalThis as { navigator?: unknown }).navigator;
});

describe('HomeKitServiceGroupResolver', () => {
  it('returns an empty list before any refresh', () => {
    expect(new HomeKitServiceGroupResolver().getGroupsForAccessory('a')).toEqual([]);
  });

  it('builds a reverse index from accessory to groups', async () => {
    listServiceGroups.mockResolvedValue([
      { id: 'g1', name: 'Downstairs', accessoryIds: ['a1', 'a2'] },
      { id: 'g2', name: 'Lamps', accessoryIds: ['a2'] },
    ]);
    const r = new HomeKitServiceGroupResolver();

    await r.refresh();

    expect(r.getGroupsForAccessory('a1')).toEqual(['g1']);
    expect(r.getGroupsForAccessory('a2')).toEqual(['g1', 'g2']);
    expect(r.getGroupsForAccessory('nope')).toEqual([]);
  });

  it('spans multiple homes', async () => {
    listHomes.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
    listServiceGroups
      .mockResolvedValueOnce([{ id: 'g1', accessoryIds: ['a1'] }])
      .mockResolvedValueOnce([{ id: 'g2', accessoryIds: ['a1'] }]);
    const r = new HomeKitServiceGroupResolver();

    await r.refresh();

    expect(r.getGroupsForAccessory('a1')).toEqual(['g1', 'g2']);
  });

  it('keeps the rest of the index when one home is unreachable', async () => {
    listHomes.mockResolvedValue([{ id: 'h1' }, { id: 'h2' }]);
    listServiceGroups
      .mockRejectedValueOnce(new Error('unreachable'))
      .mockResolvedValueOnce([{ id: 'g2', accessoryIds: ['a2'] }]);
    const r = new HomeKitServiceGroupResolver();

    await r.refresh();

    expect(r.getGroupsForAccessory('a2')).toEqual(['g2']);
  });

  it('survives listHomes failing entirely', async () => {
    listHomes.mockRejectedValue(new Error('bridge down'));
    const r = new HomeKitServiceGroupResolver();

    await expect(r.refresh()).resolves.toBeUndefined();
    expect(r.getGroupsForAccessory('a1')).toEqual([]);
  });

  it('replaces the index wholesale so removed members disappear', async () => {
    listServiceGroups.mockResolvedValueOnce([{ id: 'g1', accessoryIds: ['a1'] }]);
    const r = new HomeKitServiceGroupResolver();
    await r.refresh();
    expect(r.getGroupsForAccessory('a1')).toEqual(['g1']);

    listServiceGroups.mockResolvedValueOnce([{ id: 'g1', accessoryIds: [] }]);
    await r.refresh();

    expect(r.getGroupsForAccessory('a1')).toEqual([]);
  });

  it('tolerates a group with no accessoryIds', async () => {
    listServiceGroups.mockResolvedValue([{ id: 'g1' }]);
    const r = new HomeKitServiceGroupResolver();

    await expect(r.refresh()).resolves.toBeUndefined();
  });

  it('start() populates immediately and refreshes on an interval', async () => {
    vi.useFakeTimers();
    listServiceGroups.mockResolvedValue([{ id: 'g1', accessoryIds: ['a1'] }]);
    const r = new HomeKitServiceGroupResolver();

    r.start(60_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(r.getGroupsForAccessory('a1')).toEqual(['g1']);

    const callsAfterStart = listHomes.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(listHomes.mock.calls.length).toBeGreaterThan(callsAfterStart);

    r.stop();
  });

  it('stop() clears the index and halts refreshing', async () => {
    vi.useFakeTimers();
    listServiceGroups.mockResolvedValue([{ id: 'g1', accessoryIds: ['a1'] }]);
    const r = new HomeKitServiceGroupResolver();
    r.start(60_000);
    await vi.advanceTimersByTimeAsync(0);

    r.stop();
    const calls = listHomes.mock.calls.length;
    await vi.advanceTimersByTimeAsync(300_000);

    expect(r.getGroupsForAccessory('a1')).toEqual([]);
    expect(listHomes.mock.calls.length).toBe(calls);
  });

  it('start() twice does not stack intervals', async () => {
    vi.useFakeTimers();
    const r = new HomeKitServiceGroupResolver();
    r.start(60_000);
    r.start(60_000);
    await vi.advanceTimersByTimeAsync(0);
    listHomes.mockClear();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(listHomes.mock.calls.length).toBe(1);
    r.stop();
  });
});

describe('resolveHomeLocation', () => {
  const store = () => {
    const map = new Map<string, string>();
    return {
      map,
      getSetting: vi.fn(async (k: string) => map.get(k) ?? null),
      setSetting: vi.fn(async (k: string, v: string) => { map.set(k, v); }),
    };
  };

  it('uses a cached location without touching geolocation', async () => {
    const s = store();
    s.map.set('automation-location', JSON.stringify({ latitude: 51.5, longitude: -0.12 }));

    await expect(resolveHomeLocation(s)).resolves.toEqual({ latitude: 51.5, longitude: -0.12 });
  });

  it('ignores a malformed cached value', async () => {
    const s = store();
    s.map.set('automation-location', 'not json');

    await expect(resolveHomeLocation(s)).resolves.toBeUndefined();
  });

  it('ignores a cached value with non-numeric coordinates', async () => {
    const s = store();
    s.map.set('automation-location', JSON.stringify({ latitude: 'north', longitude: 0 }));

    await expect(resolveHomeLocation(s)).resolves.toBeUndefined();
  });

  it('returns undefined rather than guessing when geolocation is unavailable', async () => {
    await expect(resolveHomeLocation()).resolves.toBeUndefined();
  });

  it('reads and caches a fresh position', async () => {
    (globalThis as never as { navigator: unknown }).navigator = {
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 40.7, longitude: -74 } }),
      },
    };
    const s = store();

    await expect(resolveHomeLocation(s)).resolves.toEqual({ latitude: 40.7, longitude: -74 });
    expect(s.setSetting).toHaveBeenCalledWith(
      'automation-location',
      JSON.stringify({ latitude: 40.7, longitude: -74 }),
    );
  });

  it('returns undefined when the user denies the prompt', async () => {
    (globalThis as never as { navigator: unknown }).navigator = {
      geolocation: {
        getCurrentPosition: (_ok: unknown, fail: () => void) => fail(),
      },
    };

    await expect(resolveHomeLocation(store())).resolves.toBeUndefined();
  });

  it('still returns the position when caching it fails', async () => {
    (globalThis as never as { navigator: unknown }).navigator = {
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 1, longitude: 2 } }),
      },
    };
    const s = store();
    s.setSetting.mockRejectedValue(new Error('quota'));

    await expect(resolveHomeLocation(s)).resolves.toEqual({ latitude: 1, longitude: 2 });
  });

  it('falls through to geolocation when reading the cache throws', async () => {
    (globalThis as never as { navigator: unknown }).navigator = {
      geolocation: {
        getCurrentPosition: (ok: (p: unknown) => void) =>
          ok({ coords: { latitude: 3, longitude: 4 } }),
      },
    };
    const s = store();
    s.getSetting.mockRejectedValue(new Error('db closed'));

    await expect(resolveHomeLocation(s)).resolves.toEqual({ latitude: 3, longitude: 4 });
  });
});
