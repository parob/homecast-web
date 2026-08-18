// @vitest-environment jsdom
//
// A deal on something inside a group had nowhere to appear.
//
// The badge lives on an accessory tile, and a grouped accessory has no tile on
// the dashboard — it is a row inside the group. So the one product a person
// might actually want to hear about a price drop for was the one product that
// could never show one. The group carries the badge now, for the product it is
// mostly made of, and prefers a member that is genuinely on offer.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import { ServiceGroupWidget } from '../ServiceGroupWidget';
import { GET_DEAL_PRICE_HISTORY } from '@/lib/graphql/queries';
import type { DealInfo } from '@/lib/graphql/types';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

// The real provider is two Apollo queries deep; what this file is about is what
// the tile does with an answer, so the answer is handed to it directly.
const openPriceHistory = vi.fn();
let contextDeals: DealInfo[] = [];
vi.mock('@/contexts/DealsContext', () => ({
  useDeals: () => ({
    deals: contextDeals,
    isTracked: () => true,
    openPriceHistory,
  }),
}));

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function bulb(id: string, manufacturer: string, model: string) {
  return {
    id,
    name: id,
    category: 'Lightbulb',
    isReachable: true,
    roomName: 'Kitchen',
    services: [{
      id: `${id}:svc`,
      name: id,
      serviceType: 'lightbulb',
      characteristics: [
        { id: `${id}:power`, characteristicType: 'power_state', value: true, isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic' },
        { id: `${id}:mfr`, characteristicType: 'manufacturer', value: manufacturer, isReadable: true, isWritable: false, __typename: 'HomeKitCharacteristic' },
        { id: `${id}:mdl`, characteristicType: 'model', value: model, isReadable: true, isWritable: false, __typename: 'HomeKitCharacteristic' },
      ],
      __typename: 'HomeKitService',
    }],
    __typename: 'HomeKitAccessory',
  };
}

function dealFor(manufacturer: string, model: string, tier = 'hot'): DealInfo {
  return {
    id: `deal-${model}`,
    deviceId: 'dev', deviceName: 'Device', deviceManufacturer: manufacturer,
    productName: 'A Bulb', dealPrice: '10.00', regularPrice: '20.00',
    discountPercentage: 50, dealTitle: null, dealTier: tier, currency: 'GBP',
    dealUrl: 'https://example.com', imageUrl: null, expiresAt: null,
    quantity: 1, listingType: 'single', unitPrice: null, allTimeLow: null,
    isNearAtl: false, mappings: [{ manufacturer, model }],
  } as unknown as DealInfo;
}

// Opening the badge lazily fetches the sparkline. Answer it, so a popover in
// this file cannot be mistaken for a broken mock in the log.
const HISTORY_MOCKS = [{
  request: { query: GET_DEAL_PRICE_HISTORY, variables: { dealId: 'deal-LWA001' } },
  result: { data: { dealPriceHistory: [] } },
}];

function renderGroup(accessories: unknown[], overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const props = {
    group: { id: 'grp-1', name: 'Kitchen Lights', serviceIds: [], accessoryIds: accessories.map((a) => (a as { id: string }).id) },
    accessories,
    onToggle,
    onSlider: vi.fn(),
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    compact: true,
    ...overrides,
  };
  render(
    <MockedProvider mocks={HISTORY_MOCKS}>
      <ServiceGroupWidget {...(props as unknown as Parameters<typeof ServiceGroupWidget>[0])} />
    </MockedProvider>
  );
  return { onToggle };
}

/** The badge's trigger, labelled by tier — "Amazing Deal available". */
const dealBadge = () => screen.queryByRole('button', { name: /Deal available$/ });

describe('a deal on a service group', () => {
  afterEach(() => { contextDeals = []; openPriceHistory.mockClear(); cleanup(); });

  it('shows the badge on the group when its product is on offer', () => {
    contextDeals = [dealFor('Signify', 'LWA001')];
    renderGroup([bulb('a', 'Signify', 'LWA001'), bulb('b', 'Signify', 'LWA001')]);
    expect(dealBadge()).toBeTruthy();
  });

  it('shows it on the full-size tile too, not only the compact one', () => {
    contextDeals = [dealFor('Signify', 'LWA001')];
    renderGroup([bulb('a', 'Signify', 'LWA001')], { compact: false });
    expect(dealBadge()).toBeTruthy();
  });

  it('surfaces a deal on a member that the rest of the group outnumbers', () => {
    contextDeals = [dealFor('LIFX', 'LIFXA19')];
    renderGroup([
      bulb('a', 'Signify', 'LWA001'),
      bulb('b', 'Signify', 'LWA001'),
      bulb('c', 'LIFX', 'LIFXA19'),
    ]);
    expect(dealBadge()).toBeTruthy();
  });

  it('stays quiet when nothing in the group is on offer', () => {
    contextDeals = [dealFor('Nanoleaf', 'NL29')];
    renderGroup([bulb('a', 'Signify', 'LWA001')]);
    expect(dealBadge()).toBeNull();
  });

  it('does not toggle the group when the badge is pressed', () => {
    // The badge sits inside a card whose whole job is to be clicked.
    contextDeals = [dealFor('Signify', 'LWA001')];
    const { onToggle } = renderGroup([bulb('a', 'Signify', 'LWA001')]);
    fireEvent.click(dealBadge()!);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
