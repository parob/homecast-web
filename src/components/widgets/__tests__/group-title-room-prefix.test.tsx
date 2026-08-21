// @vitest-environment jsdom
/**
 * A group tile titles itself with its room stripped off.
 *
 * "Kitchen Lights" under a Kitchen heading says Kitchen twice, so the tile
 * takes the room as a prop and strips it. Which means a render that forgets
 * the prop silently grows the room back — and the drag overlay did exactly
 * that, so the tile changed its name the instant you picked it up.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { ServiceGroupWidget } from '../ServiceGroupWidget';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

if (!window.ResizeObserver) {
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
}

afterEach(cleanup);

const member = {
  id: 'a1', name: 'Kitchen Ceiling', category: 'Lightbulb', isReachable: true,
  roomName: 'Kitchen', homeId: 'H1',
  services: [{
    id: 'a1:s', name: 'Kitchen Ceiling', serviceType: 'lightbulb',
    characteristics: [{
      id: 'c', characteristicType: 'power_state', value: true,
      isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic',
    }],
    __typename: 'HomeKitService',
  }],
  __typename: 'HomeKitAccessory',
};

const GROUP = { id: 'g1', name: 'Kitchen Lights', accessoryIds: ['a1'] };

function renderGroup(roomName?: string) {
  render(
    <ServiceGroupWidget
      {...({
        group: GROUP,
        accessories: [member],
        roomName,
        compact: true,
        getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
        onToggle: () => {}, onSlider: () => {}, onHide: () => {},
      } as unknown as ComponentProps<typeof ServiceGroupWidget>)}
    />,
  );
}

describe('a group tile’s title', () => {
  it('drops the room it already sits under', () => {
    renderGroup('Kitchen');
    expect(screen.getByText('Lights')).toBeTruthy();
    expect(screen.queryByText('Kitchen Lights')).toBeNull();
  });

  it('keeps the whole name when there is no room heading above it', () => {
    // The ungrouped "All Accessories" view: nothing else says where it is.
    renderGroup(undefined);
    expect(screen.getByText('Kitchen Lights')).toBeTruthy();
  });
});
