import { describe, it, expect } from 'vitest';
import { atlIsMeaningful, findDealForAccessory, getAccessoryIdentity } from '../deals';
import type { DealInfo, HomeKitAccessory } from '../graphql/types';

function accessory(manufacturer: string, model: string, name = 'Bulb'): HomeKitAccessory {
  return {
    id: `acc-${model}`,
    name,
    services: [
      {
        id: 'svc-1',
        serviceType: 'lightbulb',
        characteristics: [
          { id: 'c1', characteristicType: 'manufacturer', value: manufacturer },
          { id: 'c2', characteristicType: 'model', value: model },
        ],
      },
    ],
  } as unknown as HomeKitAccessory;
}

function deal(
  id: string,
  mappings: Array<{ manufacturer: string; model: string }>,
  overrides: Partial<DealInfo> = {},
): DealInfo {
  return {
    id,
    deviceId: `dev-${id}`,
    deviceName: 'Device',
    deviceManufacturer: mappings[0]?.manufacturer ?? 'Signify',
    productName: 'Product',
    dealPrice: '10.00',
    regularPrice: '20.00',
    discountPercentage: 50,
    dealTitle: null,
    dealTier: 'hot',
    currency: 'GBP',
    dealUrl: 'https://example.com',
    imageUrl: null,
    expiresAt: null,
    quantity: 1,
    listingType: 'single',
    unitPrice: null,
    allTimeLow: null,
    isNearAtl: false,
    mappings,
    ...overrides,
  } as DealInfo;
}

describe('getAccessoryIdentity', () => {
  it('reads manufacturer and model from characteristics', () => {
    expect(getAccessoryIdentity(accessory('Signify', 'LWA001'))).toEqual({
      manufacturer: 'Signify',
      model: 'LWA001',
    });
  });

  it('returns null when either half is missing', () => {
    const noModel = {
      id: 'a',
      name: 'x',
      services: [{
        id: 's',
        serviceType: 'lightbulb',
        characteristics: [{ id: 'c', characteristicType: 'manufacturer', value: 'Signify' }],
      }],
    } as unknown as HomeKitAccessory;
    expect(getAccessoryIdentity(noModel)).toBeNull();
  });
});

describe('findDealForAccessory', () => {
  const hueDeal = deal('d1', [{ manufacturer: 'Signify', model: 'LWA001' }]);

  it('matches the accessory the deal is actually for', () => {
    const match = findDealForAccessory(accessory('Signify', 'LWA001'), [hueDeal]);
    expect(match?.deal.id).toBe('d1');
  });

  it('does NOT badge a different model from the same manufacturer', () => {
    // The bug this replaced: one Hue deal badged every Hue accessory in the
    // home, because matching was manufacturer-substring only.
    expect(findDealForAccessory(accessory('Signify', 'LST002'), [hueDeal])).toBeNull();
  });

  it('matches case-insensitively', () => {
    const match = findDealForAccessory(accessory('SIGNIFY', 'lwa001'), [hueDeal]);
    expect(match?.deal.id).toBe('d1');
  });

  it('ignores deals that carry no mappings', () => {
    const unmapped = deal('d2', []);
    expect(findDealForAccessory(accessory('Signify', 'LWA001'), [unmapped])).toBeNull();
  });

  it('prefers the higher tier, then the lower unit price', () => {
    const m = [{ manufacturer: 'Signify', model: 'LWA001' }];
    const good = deal('good', m, { dealTier: 'good', dealPrice: '5.00' });
    const hot = deal('hot', m, { dealTier: 'hot', dealPrice: '9.00' });
    expect(findDealForAccessory(accessory('Signify', 'LWA001'), [good, hot])?.deal.id).toBe('hot');

    const cheapHot = deal('cheap', m, { dealTier: 'hot', dealPrice: '4.00' });
    expect(
      findDealForAccessory(accessory('Signify', 'LWA001'), [hot, cheapHot])?.deal.id,
    ).toBe('cheap');
  });

  it('returns null when there are no deals at all', () => {
    expect(findDealForAccessory(accessory('Signify', 'LWA001'), [])).toBeNull();
  });
});

describe('unit-price tie-break', () => {
  it('does not let an unparseable price win the badge', () => {
    // parseFloat returns NaN rather than throwing, so the old try/catch
    // Infinity sentinel was dead code and `10 < NaN` is false — a malformed
    // deal beat every well-formed one.
    const good = deal('good', [{ manufacturer: 'Signify', model: 'LWA001' }], {
      dealPrice: '10.00',
    });
    const broken = deal('broken', [{ manufacturer: 'Signify', model: 'LWA001' }], {
      dealPrice: 'not-a-price',
    });

    for (const deals of [[good, broken], [broken, good]]) {
      const match = findDealForAccessory(accessory('Signify', 'LWA001'), deals);
      expect(match?.deal.id).toBe('good');
    }
  });

  it('compares multi-packs on price per unit, not sticker price', () => {
    const twoPack = deal('two-pack', [{ manufacturer: 'Signify', model: 'LWA001' }], {
      dealPrice: '30.00',
      quantity: 2, // 15.00 each
      listingType: 'multi_pack',
    });
    const single = deal('single', [{ manufacturer: 'Signify', model: 'LWA001' }], {
      dealPrice: '20.00',
      quantity: 1, // 20.00 each
    });

    const match = findDealForAccessory(accessory('Signify', 'LWA001'), [single, twoPack]);
    expect(match?.deal.id).toBe('two-pack');
  });

  it('rejects a zero or negative price rather than treating it as cheapest', () => {
    const free = deal('free', [{ manufacturer: 'Signify', model: 'LWA001' }], {
      dealPrice: '0',
    });
    const real = deal('real', [{ manufacturer: 'Signify', model: 'LWA001' }], {
      dealPrice: '9.99',
    });
    const match = findDealForAccessory(accessory('Signify', 'LWA001'), [free, real]);
    expect(match?.deal.id).toBe('real');
  });
});

describe('atlIsMeaningful', () => {
  it('matches the server threshold', () => {
    expect(atlIsMeaningful(7)).toBe(false);
    expect(atlIsMeaningful(8)).toBe(true);
    expect(atlIsMeaningful(null)).toBe(false);
    expect(atlIsMeaningful(undefined)).toBe(false);
  });
});
