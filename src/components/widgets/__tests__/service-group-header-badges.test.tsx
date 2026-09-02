// @vitest-environment jsdom
//
// The group header's status line — what it says, and why it must not wrap.
//
// This started as a guard on two filled `Badge` pills ("130/136 reachable",
// "4/9 on"). Over a home of 136 bulbs the first wrapped onto a line of its own
// and aligned with nothing, and switching part of the group on put a second
// grey box beside it. Both are gone: the two facts are now one plain status
// line under the subtitle, saying the exception rather than the ratio. See
// homecast-cloud#56, and homecast-cloud#34 for the wrapping bug that came
// first — the pills' `whitespace-nowrap` is kept on the line for exactly that
// reason, so the phrase cannot break mid-word.
//
// jsdom has no layout engine, so this cannot assert the pixels; the browser
// reproduction is on the issue. What it can do is pin the wording and the two
// classes the layout rests on, so losing one fails here rather than on
// someone's phone.
import { describe, it, expect, afterEach, vi } from 'vitest';
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

function lamp(id: string, on: boolean, reachable = true) {
  return {
    id,
    name: id,
    category: 'Switch',
    isReachable: reachable,
    roomName: 'Kitchen',
    services: [{
      id: `${id}:svc`,
      name: id,
      serviceType: 'lightbulb',
      characteristics: [{
        id: `${id}:power`, characteristicType: 'power_state', value: on,
        isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic',
      }],
      __typename: 'HomeKitService',
    }],
    __typename: 'HomeKitAccessory',
  };
}

/**
 * Some on, some off (so the "N on" half appears) and some unreachable (so does
 * the "N not responding" half). Both halves in one line is the worst case, and
 * the one that used to render two boxes.
 */
const MIXED = [
  ...Array.from({ length: 4 }, (_, i) => lamp(`on-${i}`, true)),
  ...Array.from({ length: 3 }, (_, i) => lamp(`off-${i}`, false)),
  ...Array.from({ length: 2 }, (_, i) => lamp(`gone-${i}`, false, false)),
];

/** Every member answering, so only the "N on" half should appear. */
const ALL_REACHABLE = [
  ...Array.from({ length: 4 }, (_, i) => lamp(`on-${i}`, true)),
  ...Array.from({ length: 5 }, (_, i) => lamp(`off-${i}`, false)),
];

function renderGroup(expanded: boolean, accessories = MIXED) {
  render(
    <ServiceGroupWidget
      {...({
        group: { id: 'grp-1', name: 'All lights', serviceIds: [], accessoryIds: accessories.map(a => a.id) },
        accessories,
        onToggle: vi.fn(),
        onSlider: vi.fn(),
        getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
        // Never the compact tile: it has no room for a status line and renders
        // a third, plainer subtitle. The two headers that carry one are the
        // full-size inline card and the expanded panel.
        compact: false,
        expanded,
        iconStyle: 'colourful',
      } as unknown as Parameters<typeof ServiceGroupWidget>[0])}
    />
  );
}

/** The status line is built from several nodes, so match on whole-element text. */
const statusLine = (text: string) =>
  screen.getByText((_c, el) => el?.textContent === text && el.className.includes('items-center'));

// The inline card and the expanded panel render the header twice, from two
// separate blocks. Both carried the bug, so both are checked — fixing one and
// leaving the other is the likely way this regresses.
describe.each([
  ['the expanded panel', true],
  ['the inline card', false],
])('group header status line — %s', (_label, expanded) => {
  afterEach(cleanup);

  it('says the exception in words, not the ratio', () => {
    renderGroup(expanded);
    // "7/9 reachable" made you subtract to reach the number worth acting on.
    expect(screen.queryByText(/reachable/)).toBeNull();
    expect(statusLine('4 on·2 not responding')).toBeTruthy();
  });

  it('never lets the line wrap mid-phrase', () => {
    renderGroup(expanded);
    // A flex row's `min-width: auto` resolves to its widest *word*, so without
    // this "not responding" is free to break across two lines.
    expect(statusLine('4 on·2 not responding').className).toContain('whitespace-nowrap');
  });

  it('keeps the device count on one line', () => {
    renderGroup(expanded);
    const count = screen.getByText('9 devices');
    expect(count.className).toContain('whitespace-nowrap');
  });

  it('drops the unreachable half when every member answers', () => {
    renderGroup(expanded, ALL_REACHABLE);
    expect(screen.queryByText(/not responding/)).toBeNull();
    expect(statusLine('4 on')).toBeTruthy();
  });
});
