import { describe, it, expect, beforeEach } from 'vitest';
import {
  bumpTelemetry,
  drainTelemetryCounters,
  categoriseAccessories,
  buildSnapshot,
  resetTelemetryForTest,
  type SnapshotInput,
} from '../local-telemetry';

function input(overrides: Partial<SnapshotInput> = {}): SnapshotInput {
  return {
    stats: { homes: 2, rooms: 11, zones: 2, accessories: 47, accessoriesOnline: 45, scenes: 8, serviceGroups: 3 },
    accessoryTypes: [],
    hkAutomations: 4,
    hcAutomations: 6,
    virtualAccessories: 2,
    users: 2,
    webhooks: 1,
    apiTokens: 1,
    oauthClients: 0,
    authEnabled: true,
    mqttBrokers: 0,
    historyEnabled: true,
    developerMode: false,
    ...overrides,
  };
}

describe('telemetry counters', () => {
  beforeEach(() => resetTelemetryForTest());

  it('accumulates and drains, leaving a clean window behind', () => {
    bumpTelemetry('characteristicWrites');
    bumpTelemetry('characteristicWrites', 4);
    bumpTelemetry('sceneRuns');

    expect(drainTelemetryCounters()).toEqual({ characteristicWrites: 5, sceneRuns: 1 });
    // The whole point of draining: a failed push must not double-count on the
    // next one, and a successful one must not re-send what Swift already has.
    expect(drainTelemetryCounters()).toEqual({});
  });

  it('reports nothing rather than zeros when nothing happened', () => {
    expect(drainTelemetryCounters()).toEqual({});
  });
});

describe('categoriseAccessories', () => {
  it('counts known device types', () => {
    expect(categoriseAccessories(['light', 'light', 'switch', 'lock'])).toEqual({
      light: 2, switch: 1, lock: 1,
    });
  });

  it('collapses unknown types into `other`', () => {
    // A one-of-a-kind accessory must not become a column of its own — across a
    // small fleet that edges towards identifying the home it came from.
    expect(categoriseAccessories(['light', 'sprinkler', 'nuclear_reactor'])).toEqual({
      light: 1, other: 2,
    });
  });

  it('returns an empty histogram for no accessories', () => {
    expect(categoriseAccessories([])).toEqual({});
  });
});

describe('buildSnapshot', () => {
  it('carries counts and nothing else', () => {
    const snapshot = buildSnapshot(input({ accessoryTypes: ['light', 'light', 'switch'] }));

    // Every leaf value must be a number or a boolean. A string anywhere in
    // here would mean a name, an id or a host escaped into the report.
    const leaves: unknown[] = [];
    const walk = (value: unknown) => {
      if (value && typeof value === 'object') Object.values(value).forEach(walk);
      else leaves.push(value);
    };
    walk(snapshot);

    expect(leaves.length).toBeGreaterThan(0);
    for (const leaf of leaves) {
      expect(['number', 'boolean']).toContain(typeof leaf);
    }
  });

  it('takes the accessory count from the census, so it cannot disagree with the categories', () => {
    // getStats() and the per-home listing are two different reads of HomeKit
    // and can be taken moments apart. The categories are derived from the
    // listing, so the listing is what the total has to agree with.
    const snapshot = buildSnapshot(input({
      stats: { homes: 1, accessories: 999 },
      accessoryTypes: ['light', 'switch'],
    }));

    expect(snapshot.scale.accessories).toBe(2);
    const categoryTotal = Object.values(snapshot.categories).reduce((a, b) => a + b, 0);
    expect(categoryTotal).toBe(snapshot.scale.accessories);
  });

  it('falls back to the stats total when the census could not be taken', () => {
    const snapshot = buildSnapshot(input({ accessoryTypes: [] }));
    expect(snapshot.scale.accessories).toBe(47);
  });

  it('survives HomeKit being unavailable entirely', () => {
    const snapshot = buildSnapshot(input({ stats: null, accessoryTypes: [] }));

    // A relay whose HomeKit is asleep still reports its IndexedDB counts,
    // rather than the whole report being held back.
    expect(snapshot.scale.homes).toBe(0);
    expect(snapshot.scale.accessories).toBe(0);
    expect(snapshot.scale.hcAutomations).toBe(6);
    expect(snapshot.features.authEnabled).toBe(true);
  });

  it('clamps nonsense into zero rather than shipping it', () => {
    const snapshot = buildSnapshot(input({
      stats: { homes: NaN, rooms: -3, accessories: 12.7 },
      accessoryTypes: [],
    }));

    expect(snapshot.scale.homes).toBe(0);
    expect(snapshot.scale.rooms).toBe(0);
    expect(snapshot.scale.accessories).toBe(12);
  });

  it('reports MQTT as a count, never as a broker', () => {
    const snapshot = buildSnapshot(input({ mqttBrokers: 2 }));
    expect(snapshot.features.mqttBrokers).toBe(2);
    expect(JSON.stringify(snapshot)).not.toMatch(/host|username|password|topic/i);
  });
});

describe('relay response envelopes', () => {
  // The bug this exists for: every relay action answers with a named wrapper,
  // never a bare array. collectSnapshot read them as arrays, so `for...of`
  // threw outside the per-call guard and the whole census was lost — silently,
  // because pushSnapshot swallows by design. A relay reported real request
  // counts alongside a completely empty topology for two days.
  const ENVELOPES: Array<[string, string, unknown]> = [
    ['homes.list', 'homes', { homes: [{ id: 'A' }, { id: 'B' }] }],
    ['accessories.list', 'accessories', { accessories: [{}, {}, {}] }],
    ['automations.list', 'automations', { automations: [{}] }],
  ];

  it.each(ENVELOPES)('%s unwraps its %s array', async (_action, key, response) => {
    const { listOf } = await import('../local-telemetry');
    expect(listOf(response, key)).toHaveLength(
      ((response as Record<string, unknown[]>)[key]).length,
    );
  });

  it('iterating the raw envelope throws — which is what went wrong', () => {
    const response: unknown = { homes: [{ id: 'A' }] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => { for (const _ of response as any) { /* consume */ } }).toThrow(TypeError);
  });

  it('still accepts a bare array, if an action is ever unwrapped', async () => {
    const { listOf } = await import('../local-telemetry');
    expect(listOf([{ id: 'A' }, { id: 'B' }], 'homes')).toHaveLength(2);
  });

  it('yields an empty list for a failed or unexpected response', async () => {
    const { listOf } = await import('../local-telemetry');
    for (const bad of [null, undefined, {}, { homes: null }, 'nope', 42]) {
      expect(listOf(bad, 'homes')).toEqual([]);
    }
  });
});
