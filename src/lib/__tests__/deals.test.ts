import { describe, it, expect } from 'vitest';
import { findDealForAccessory, getAccessoryIdentity } from '../deals';
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
