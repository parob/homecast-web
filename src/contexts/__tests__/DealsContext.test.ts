/**
 * `extractAccessoryInputs` runs in a `useMemo` in `DealsProvider`, which wraps
 * the entire Dashboard tree and is evaluated before any tile exists — the
 * `enabled` flag only gates the two `useQuery`s, not this traversal. So a throw
 * here is not a broken tile, it is a whitescreen: the nearest error boundary is
 * the root one in `main.tsx`.
 *
 * That is exactly what shipped — `undefined is not an object (evaluating
 * 'r.services')` on the first paint after login, from an accessory restored out
 * of the persisted cache without a `services` array.
 */
import { describe, it, expect } from 'vitest';
import { extractAccessoryInputs } from '../DealsContext';
import type { HomeKitAccessory } from '@/lib/graphql/types';

function accessory(manufacturer: string, model: string): HomeKitAccessory {
  return {
    id: `acc-${model}`,
    name: 'Bulb',
    services: [
      {
        id: 'svc-1',
        serviceType: 'accessory_information',
        characteristics: [
          { id: 'c1', characteristicType: 'manufacturer', value: manufacturer },
          { id: 'c2', characteristicType: 'model', value: model },
        ],
      },
    ],
  } as unknown as HomeKitAccessory;
}

describe('extractAccessoryInputs', () => {
  it('dedupes identities so one query covers repeats of the same product', () => {
    const inputs = extractAccessoryInputs([
      accessory('Signify', 'LWA001'),
      accessory('Signify', 'LWA001'),
      accessory('Eve', 'Energy'),
    ]);

    expect(inputs).toEqual([
      { manufacturer: 'Signify', model: 'LWA001' },
      { manufacturer: 'Eve', model: 'Energy' },
    ]);
  });

  it('skips accessories with no identifiable product', () => {
    const noModel = {
      id: 'a',
      name: 'x',
      services: [{
        id: 's',
        serviceType: 'accessory_information',
        characteristics: [{ id: 'c', characteristicType: 'manufacturer', value: 'Signify' }],
      }],
    } as unknown as HomeKitAccessory;

    expect(extractAccessoryInputs([noModel])).toEqual([]);
  });

  // The regression. `{ ...null }` from the cache aggregator is an object with
  // no `services`, and it looks like an accessory to every filter upstream.
  it('survives a malformed accessory rather than taking the dashboard down', () => {
    const inputs = extractAccessoryInputs([
      { id: 'BROKEN', name: 'No Services' },
      null,
      undefined,
      accessory('Signify', 'LWA001'),
    ] as unknown as HomeKitAccessory[]);

    expect(inputs).toEqual([{ manufacturer: 'Signify', model: 'LWA001' }]);
  });

  it('tolerates a nullish list', () => {
    expect(extractAccessoryInputs(undefined as unknown as HomeKitAccessory[])).toEqual([]);
  });
});
