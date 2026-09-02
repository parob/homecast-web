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
 * The header's status line. Built from several nodes — `{onCount} on` — so it
 * has to be matched on the element's whole text rather than a single node's.
 * It only exists on the full-size header; the compact tile has no room for it,
 * which is part of why the toggle itself has to carry the state.
 *
 * It used to be a filled `Badge` reading `{onCount}/{total} on`; the ratio and
 * the box both went in homecast-cloud#56. The denominator survives where it
 * matters most — in the toggle's own screen-reader description, below.
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

  it('tells a screen reader the full ratio the line shortens', () => {
    renderFull([lamp('a', true), lamp('b', false)]);
    expect(badge('1 on')).toBeTruthy();
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
    // and a motion sensor could never read as on and its status line counted
    // the sensor as an unlit lamp.
    renderFull([lamp('a', true), lamp('b', true), SENSOR]);
    expect(groupControl().getAttribute('aria-checked')).toBe('true');
    // Fully on is not partly on, so there is no status line at all.
    expect(badge('2 on')).toBeNull();
  });

  it('counts only the ones that can be on when it is mixed', () => {
    renderFull([lamp('a', true), lamp('b', false), SENSOR]);
    expect(badge('1 on')).toBeTruthy();
  });
});

describe('the compact tile has one line, and spends it on the count', () => {
  afterEach(cleanup);

  /**
   * The visible subtitle, as opposed to the toggle's own sr-only description —
   * which says the same words on purpose, so that tabbing straight to the
   * control still tells you the count without reading the card.
   */
  const subtitle = (text: string) =>
    screen.getAllByText(text).filter(el => !el.className.includes('sr-only'));

  it('says how many are on rather than how many there are', () => {
    // "6 devices" is the least interesting true thing the tile can say — it
    // never changes. There is no room for the full header's badge here, so the
    // subtitle carries the number instead.
    renderGroup([lamp('a', true), lamp('b', false)]);
    expect(subtitle('1 of 2 on')).toHaveLength(1);
    expect(screen.queryByText('2 devices')).toBeNull();
  });

  it('counts only what can be on', () => {
    renderGroup([lamp('a', true), lamp('b', false), SENSOR]);
    expect(subtitle('1 of 2 on')).toHaveLength(1);
  });

  it('uses a word at either end, not arithmetic', () => {
    // "0 of 2 on" and "2 of 2 on" are the state the thumb has already made
    // plain, spelled out as a sum. The word is quicker to read and does not
    // grow with the group.
    renderGroup([lamp('a', false), lamp('b', false)]);
    expect(subtitle('Off')).toHaveLength(1);
    expect(screen.queryByText('0 of 2 on')).toBeNull();
    cleanup();

    renderGroup([lamp('a', true), lamp('b', true)]);
    expect(subtitle('On')).toHaveLength(1);
    expect(screen.queryByText('2 of 2 on')).toBeNull();
  });

  it('leaves a blinds group its own vocabulary', () => {
    // A blind is not on or off, and coveringStatusText already says what it is.
    const blind = {
      id: 'blind-1', name: 'Blind', category: 'WindowCovering', isReachable: true, roomName: 'Kitchen',
      services: [{
        id: 'blind-1:svc', name: 'Blind', serviceType: 'window_covering',
        characteristics: [
          { id: 'b:cp', characteristicType: 'current_position', value: 0, isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic' },
          { id: 'b:tp', characteristicType: 'target_position', value: 0, isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic' },
        ],
        __typename: 'HomeKitService',
      }],
      __typename: 'HomeKitAccessory',
    };
    renderGroup([blind]);
    expect(screen.queryByText(/of \d+ on/)).toBeNull();
  });
});
