// @vitest-environment jsdom
//
// The count badges in a group header, and why they must not wrap.
//
// "All lights" over a home of 136 bulbs renders "136 devices" beside a
// "130/136 reachable" badge in a flex row that had no wrap. A flex item's
// `min-width: auto` resolves to its widest *word*, not the whole string, so
// the row was free to squeeze the badge down to "130/136" and push "reachable"
// onto a second line — inside a box pinned to `h-4`, which cannot grow to hold
// two lines. The text spilled out above and below the pill, and the bare
// "136 devices" text node was crushed the same way. See homecast-cloud#34.
//
// jsdom has no layout engine, so this cannot assert the pixels; the browser
// reproduction is on the issue. What it can do is pin the three classes the
// fix rests on, so stripping one fails here rather than on someone's phone.
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
 * A set big enough to produce the long strings that broke it: some on, some
 * off (so the "N/M on" badge appears) and some unreachable (so does
 * "N/M reachable"). Both badges in one row is the worst case.
 */
const MIXED = [
  ...Array.from({ length: 4 }, (_, i) => lamp(`on-${i}`, true)),
  ...Array.from({ length: 3 }, (_, i) => lamp(`off-${i}`, false)),
  ...Array.from({ length: 2 }, (_, i) => lamp(`gone-${i}`, false, false)),
];

function renderGroup(expanded: boolean) {
  render(
    <ServiceGroupWidget
      {...({
        group: { id: 'grp-1', name: 'All lights', serviceIds: [], accessoryIds: MIXED.map(a => a.id) },
        accessories: MIXED,
        onToggle: vi.fn(),
        onSlider: vi.fn(),
        getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
        // Never the compact tile: it has no room for badges and renders a
        // third, plainer subtitle. The two headers that carry them are the
        // full-size inline card and the expanded panel.
        compact: false,
        expanded,
        iconStyle: 'colourful',
      } as unknown as Parameters<typeof ServiceGroupWidget>[0])}
    />
  );
}

/** Matched on whole-element text: each badge is built from several nodes. */
const badge = (text: string) =>
  screen.getByText((_c, el) => el?.textContent === text && el.className.includes('rounded-full'));

// The inline card and the expanded panel render the header twice, from two
// separate blocks. The bug was in both, so both are checked — fixing one and
// leaving the other is the likely way this regresses.
describe.each([
  ['the expanded panel', true],
  ['the inline card', false],
])('group header badges — %s', (_label, expanded) => {
  afterEach(cleanup);

  it('never lets a count badge wrap or be squeezed', () => {
    renderGroup(expanded);

    for (const text of ['7/9 reachable', '4/9 on']) {
      const el = badge(text);
      // Two lines in an h-4 pill is the glitch: the text spills out of the
      // background it is supposed to sit inside.
      expect(el.className).toContain('whitespace-nowrap');
      // And it must not be squeezed below its content width to begin with.
      expect(el.className).toContain('shrink-0');
    }
  });

  it('keeps the device count on one line', () => {
    renderGroup(expanded);
    const count = screen.getByText('9 devices');
    expect(count.className).toContain('whitespace-nowrap');
  });

  it('wraps the row instead of crushing what is in it', () => {
    renderGroup(expanded);
    // With every child refusing to shrink, the row itself has to be able to
    // take a second line — otherwise the badges just overflow sideways, under
    // the toggle.
    const row = badge('7/9 reachable').parentElement!;
    expect(row.className).toContain('flex-wrap');
  });
});
