// @vitest-environment jsdom
//
// How much of a group's membership an expanded group shows.
//
// A group with a dozen members used to expand into a dozen rows and stop being
// a tile. The cap is two rows in both shapes the expanded card takes — a list
// on the full-size card, a two-column grid of tiles in the compact overlay —
// and it is measured from the rows themselves, because a light that is on
// carries a brightness slider and a switch does not.
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
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

// jsdom lays nothing out, so every offset is zero and the cap would measure
// nothing. Stand in a real geometry: each row 36px tall, stacked every 44px in
// the order it appears among its siblings.
const ROW_HEIGHT = 36;
const ROW_PITCH = 44;
const original = {
  offsetTop: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop'),
  offsetHeight: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight'),
};

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
    configurable: true,
    get(this: HTMLElement) {
      const parent = this.parentElement;
      if (!parent) return 0;
      const index = Array.prototype.indexOf.call(parent.children, this);
      // The overlay lays its tiles out two to a row; the card's list, one.
      const perRow = parent.className.includes('grid-cols-2') ? 2 : 1;
      return Math.floor(index / perRow) * ROW_PITCH;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => ROW_HEIGHT });
});

afterAll(() => {
  if (original.offsetTop) Object.defineProperty(HTMLElement.prototype, 'offsetTop', original.offsetTop);
  if (original.offsetHeight) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', original.offsetHeight);
});

afterEach(cleanup);

function lamp(id: string) {
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
        id: `${id}:power`, characteristicType: 'power_state', value: false,
        isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic',
      }],
      __typename: 'HomeKitService',
    }],
    __typename: 'HomeKitAccessory',
  };
}

/** Renders a group and opens it, the way a click on the tile does. */
function expandGroup(count: number, compact = false) {
  const accessories = Array.from({ length: count }, (_, i) => lamp(`lamp-${i}`));
  const props = {
    group: { id: 'grp-1', name: 'Downstairs', serviceIds: [], accessoryIds: accessories.map(a => a.id) },
    accessories,
    compact,
    onToggle: vi.fn(),
    onSlider: vi.fn(),
    onAccessoryToggle: vi.fn(),
    onAccessorySlider: vi.fn(),
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
  };
  render(<ServiceGroupWidget {...(props as unknown as Parameters<typeof ServiceGroupWidget>[0])} />);
  fireEvent.click(screen.getByText('Downstairs'));
  // The members are the container's children; any one of them leads back to it
  // — a tile in the overlay's grid, or a row in the card's list.
  const member = screen.getAllByText('lamp-0')[0];
  return (member.closest('.grid-cols-2') ?? member.closest('.cursor-pointer')!.parentElement!) as HTMLElement;
}

describe('an expanded group', () => {
  it('stops its member list two rows down and scrolls the rest', () => {
    const list = expandGroup(5);
    // Top of the first row to the bottom of the second — the third is below the
    // cut, whatever it turns out to be made of.
    expect(list.getAttribute('style')).toContain(`max-height: ${ROW_PITCH + ROW_HEIGHT}px`);
    expect(list.className).toContain('overflow-y-auto');
  });

  it('stops the compact overlay two rows of tiles down', () => {
    // Two columns, so two rows is four tiles and the fifth is what scrolls.
    const grid = expandGroup(5, true);
    expect(grid.className).toContain('grid-cols-2');
    expect(grid.getAttribute('style')).toContain(`max-height: ${ROW_PITCH + ROW_HEIGHT}px`);
    expect(grid.className).toContain('overflow-y-auto');
  });

  it('leaves a group that already fits alone', () => {
    const list = expandGroup(2);
    expect(list.getAttribute('style')).toBeNull();
    expect(list.className).not.toContain('overflow-y-auto');
  });

  // The panel is a fixed 360px box whose insets are rem, so a section that
  // disagrees about its margin by one rung is off by 4-5px — and the members
  // section used to, with a pr-1 on the scroller that made the right edge line
  // up while the left sat proud. (It used to be off by a different amount at
  // each text size too; the setting stopped moving the root font size, so a rem
  // is one number now — see lib/text-scale.ts.)
  //
  // Compared as Tailwind rungs rather than measured: jsdom lays nothing out,
  // and the rung is the thing that has to agree anyway.
  const horizontalRung = (el: HTMLElement) => {
    const rung = el.className
      .split(/\s+/)
      .map(c => /^p(x)?-(\d+(?:\.\d+)?)$/.exec(c))
      .filter(Boolean)
      .pop();
    return rung?.[2] ?? null;
  };

  it.each([[false], [true]])('insets its members the same as its header (compact: %s)', (compact) => {
    const container = expandGroup(5, compact);
    const members = container.closest('.p-6') as HTMLElement;
    const header = members.closest('.rounded-2xl')!.querySelector('.flex.flex-col') as HTMLElement;
    expect(horizontalRung(members)).toBe(horizontalRung(header));
    // Whatever the scroller reserves for a scrollbar, it reserves on both
    // edges — a one-sided allowance is what pushed the tiles off centre.
    expect(container.className).not.toMatch(/(^|\s)-?p[lr]-/);
  });
});
