// @vitest-environment jsdom
//
// What a group tile does when only some of its members are on.
//
// It already knew: the count was computed and spent on a "1/2 on" badge while
// the switch beside it said, flatly, on. So the tile reported a state the house
// was not in, and the press that followed picked a direction without asking.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { ServiceGroupWidget } from '../ServiceGroupWidget';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
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

function lamp(id: string, on: boolean) {
  return {
    id,
    name: id,
    category: 'Switch',
    isReachable: true,
    roomName: 'Kitchen',
    services: [{
      id: `${id}:svc`,
      name: id,
      serviceType: 'switch',
      characteristics: [{
        id: `${id}:power`, characteristicType: 'power_state', value: on,
        isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic',
      }],
      __typename: 'HomeKitService',
    }],
    __typename: 'HomeKitAccessory',
  };
}

/** A sensor: in the group, but with no power characteristic to be on. */
const SENSOR = {
  id: 'acc-motion',
  name: 'Hall Motion',
  category: 'Sensor',
  isReachable: true,
  roomName: 'Kitchen',
  services: [{
    id: 'acc-motion:svc',
    name: 'Hall Motion',
    serviceType: 'motion_sensor',
    characteristics: [{
      id: 'acc-motion:md', characteristicType: 'motion_detected', value: false,
      isReadable: true, isWritable: false, __typename: 'HomeKitCharacteristic',
    }],
    __typename: 'HomeKitService',
  }],
  __typename: 'HomeKitAccessory',
};

function renderGroup(accessories: unknown[], overrides: Record<string, unknown> = {}) {
  const onToggle = vi.fn();
  const props = {
    group: { id: 'grp-1', name: 'Downstairs', serviceIds: [], accessoryIds: accessories.map((a) => (a as { id: string }).id) },
    accessories,
    onToggle,
    onSlider: vi.fn(),
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    compact: true,
    iconStyle: 'colourful',
    ...overrides,
  };
  render(<ServiceGroupWidget {...(props as unknown as Parameters<typeof ServiceGroupWidget>[0])} />);
  return { onToggle };
}

/** The group's own control, as opposed to the per-member rows. */
const groupControl = () => screen.getByLabelText('Downstairs');

/**
 * The count badge. Built from three nodes — `{onCount}/{total} on` — so it has
 * to be matched on the element's whole text rather than a single node's. It
 * only exists on the full-size header; the compact tile has no room for it,
 * which is part of why the toggle itself has to carry the state.
 */
const badge = (text: string) => screen.queryByText((_content, el) => el?.textContent === text);
const renderFull = (accessories: unknown[]) => renderGroup(accessories, { compact: false });

describe('a group where some members are on', () => {
  afterEach(cleanup);

  it('parks the thumb in the middle rather than claiming to be on', () => {
    renderGroup([lamp('a', true), lamp('b', false)]);
    // Mixed is two commands, so it is a group of two buttons and not a switch.
    expect(screen.queryByRole('switch')).toBeNull();
    expect(groupControl().getAttribute('role')).toBe('group');
  });

  it('offers both ends, and says which one was chosen', () => {
    const { onToggle } = renderGroup([lamp('a', true), lamp('b', false)]);

    fireEvent.click(within(groupControl()).getByRole('button', { name: 'Turn all off' }));
    expect(onToggle).toHaveBeenLastCalledWith(false);

    fireEvent.click(within(groupControl()).getByRole('button', { name: 'Turn all on' }));
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });

  it('tells a screen reader the count the badge shows everyone else', () => {
    renderFull([lamp('a', true), lamp('b', false)]);
    expect(badge('1/2 on')).toBeTruthy();
    const describedBy = groupControl().getAttribute('aria-describedby')!;
    expect(document.getElementById(describedBy)?.textContent).toBe('1 of 2 on');
  });
});

describe('a group that is all one thing', () => {
  afterEach(cleanup);

  it('is an ordinary switch, and a press anywhere flips it', () => {
    const { onToggle } = renderGroup([lamp('a', true), lamp('b', true)]);
    const control = groupControl();
    expect(control.getAttribute('role')).toBe('switch');
    expect(control.getAttribute('aria-checked')).toBe('true');

    fireEvent.click(control);
    expect(onToggle).toHaveBeenCalledWith(false);
  });

  it('reads off when none of them are on', () => {
    renderGroup([lamp('a', false), lamp('b', false)]);
    expect(groupControl().getAttribute('aria-checked')).toBe('false');
  });

  it('shows no count badge, because there is nothing partial to explain', () => {
    renderFull([lamp('a', true), lamp('b', true)]);
    expect(badge('2/2 on')).toBeNull();
  });
});

describe('members that cannot be on do not count against the ones that can', () => {
  afterEach(cleanup);

  it('reaches fully on with a sensor in the group', () => {
    // The denominator used to be every accessory, so a group holding two lamps
    // and a motion sensor could never read as on and its badge counted the
    // sensor as an unlit lamp.
    renderFull([lamp('a', true), lamp('b', true), SENSOR]);
    expect(groupControl().getAttribute('aria-checked')).toBe('true');
    expect(badge('2/2 on')).toBeNull();
  });

  it('counts only the ones that can be on when it is mixed', () => {
    renderFull([lamp('a', true), lamp('b', false), SENSOR]);
    expect(badge('1/2 on')).toBeTruthy();
  });
});
