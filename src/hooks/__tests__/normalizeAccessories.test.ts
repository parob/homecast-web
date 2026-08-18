// @vitest-environment jsdom
/**
 * `normalizeAccessories` is the shape gate for every accessory that reaches the
 * UI. `HomeKitAccessory.services` is declared non-optional, so consumers all
 * over the app write `acc.services` bare and TypeScript never objects — this is
 * the function that has to make the declaration true at runtime.
 *
 * The case that mattered: a `null` inside a persisted accessories array spreads
 * to `{}` when the aggregator does `{ ...a, homeId }`. That object survives
 * every `.filter(a => a.id === …)` downstream looking like an accessory, then
 * whitescreens the dashboard in whichever consumer dereferences `.services`
 * first — which is how a login crashed rather than a tile simply not rendering.
 */
import { describe, it, expect, vi } from 'vitest';
// The bridge's HomeKitAccessory, not the graphql one — `useHomeKitData` is
// typed against the native shape and the two are distinct declarations.
import type { HomeKitAccessory } from '@/native/homekit-bridge';

// The cache module pulls in the relay connection; none of it is exercised here.
vi.mock('../../server/connection', () => ({
  serverConnection: {
    request: vi.fn().mockResolvedValue({}),
    isConnected: () => false,
    shouldActivate: () => false,
  },
}));

const { normalizeAccessories } = await import('../useHomeKitData');

function accessory(overrides: Partial<HomeKitAccessory> = {}): HomeKitAccessory {
  return {
    id: 'acc-1',
    name: 'Bulb',
    isReachable: true,
    services: [
      {
        id: 'svc-1',
        serviceType: 'lightbulb',
        characteristics: [{ id: 'c1', characteristicType: 'power_state', value: true }],
      },
    ],
    ...overrides,
  } as unknown as HomeKitAccessory;
}

describe('normalizeAccessories', () => {
  it('drops entries that are not objects', () => {
    const list = [accessory(), null, undefined, accessory({ id: 'acc-2' })];

    const out = normalizeAccessories(list as unknown as HomeKitAccessory[]);

    expect(out).toHaveLength(2);
    expect(out.map(a => a.id)).toEqual(['acc-1', 'acc-2']);
  });

  it('defaults a missing services array rather than passing the hole through', () => {
    const shapeless = { id: 'BROKEN', name: 'No Services', isReachable: true };

    const out = normalizeAccessories([shapeless] as unknown as HomeKitAccessory[]);

    expect(out).toHaveLength(1);
    expect(out[0].services).toEqual([]);
  });

  it('replaces a services value that is present but not an array', () => {
    const wrong = { id: 'W', name: 'Wrong', isReachable: true, services: 'nope' };

    const out = normalizeAccessories([wrong] as unknown as HomeKitAccessory[]);

    expect(out[0].services).toEqual([]);
  });

  it('tolerates a nullish list', () => {
    expect(normalizeAccessories(undefined as unknown as HomeKitAccessory[])).toEqual([]);
  });

  it('leaves a well-formed accessory referentially untouched', () => {
    // Identity matters: the widgets memoize on it, so re-wrapping every
    // accessory on each normalize would re-render the whole grid.
    const a = accessory();

    expect(normalizeAccessories([a])[0]).toBe(a);
  });
});
