// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import { PendingRing } from '../shared/PendingRing';
import { WidgetCard } from '../WidgetCard';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import {
  trackWrite,
  accessoryKey,
  __resetPendingWrites,
  SHOW_DELAY_MS,
} from '@/lib/pending-writes';

// jsdom has no matchMedia; the mobile hook asks for it at render.
window.matchMedia = window.matchMedia || (((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia);

vi.mock('@/lib/config', () => ({ isCommunity: false, config: { version: 'test', isStaging: false } }));
vi.mock('@/lib/accessoryRefresh', () => ({ requestAccessoryRefresh: vi.fn() }));
vi.mock('@/contexts/DealsContext', () => ({
  useDeals: () => ({ isTracked: () => false, openPriceHistory: vi.fn() }),
}));
vi.mock('@/contexts/HistoryContext', () => ({
  useHistory: () => ({
    historyAvailable: () => true,
    analyticsAvailable: true,
    analyticsAvailableFor: () => true,
    openHistory: vi.fn(),
    openGroupHistory: vi.fn(),
    openAnalytics: vi.fn(),
  }),
}));
vi.mock('../VirtualAccessoryEditContext', () => ({
  useVirtualAccessoryEditor: () => undefined,
  useVirtualAccessoryRemover: () => undefined,
}));

const ACC_ID = 'ACC-1';
const KEY = accessoryKey(ACC_ID);

const makeAccessory = (isReachable: boolean): HomeKitAccessory => ({
  id: ACC_ID, name: 'Desk Switch', roomName: 'Study', isReachable,
  services: [{
    id: 's', name: 'Switch', serviceType: 'switch',
    characteristics: [{ id: 'c', characteristicType: 'power_state', value: true, isReadable: true, isWritable: true }],
  }],
} as HomeKitAccessory);

/** The arc is the only aria-hidden span carrying animate-spin. */
const arcs = (root: HTMLElement = document.body) =>
  Array.from(root.querySelectorAll('span.animate-spin[aria-hidden="true"]'));

const advance = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => {
  vi.useFakeTimers();
  __resetPendingWrites();
});

afterEach(() => {
  cleanup();
  __resetPendingWrites();
  vi.useRealTimers();
});

describe('PendingRing', () => {
  it('draws nothing while no write is registered', async () => {
    render(<PendingRing pendingKey={KEY}><span>icon</span></PendingRing>);
    await advance(SHOW_DELAY_MS * 2);
    expect(arcs()).toHaveLength(0);
  });

  it('draws an arc once a write outlives the delay, keeping the glyph', async () => {
    render(<PendingRing pendingKey={KEY}><span data-testid="glyph">icon</span></PendingRing>);

    let resolve!: () => void;
    trackWrite(KEY, new Promise<void>((r) => { resolve = r; }));

    await advance(SHOW_DELAY_MS);
    expect(arcs()).toHaveLength(1);
    // Around, not instead of: the glyph must still be there.
    expect(screen.getByTestId('glyph')).toBeTruthy();
    resolve();
  });

  // The reason the delay lives in the store rather than in the component: one
  // accessory is routinely mounted twice at once (grid tile plus its expanded
  // overlay), and per-component timers would drift out of phase.
  it('rings every mount of the same accessory together', async () => {
    render(
      <>
        <PendingRing pendingKey={KEY}><span>a</span></PendingRing>
        <PendingRing pendingKey={KEY}><span>b</span></PendingRing>
      </>,
    );

    let resolve!: () => void;
    trackWrite(KEY, new Promise<void>((r) => { resolve = r; }));

    await advance(SHOW_DELAY_MS);
    expect(arcs()).toHaveLength(2);
    resolve();
  });

  it('never rings a key nothing registers', async () => {
    // The MQTT browser's guarantee: fire-and-forget publishes are never tracked.
    render(<PendingRing pendingKey={undefined}><span>icon</span></PendingRing>);
    trackWrite(KEY, new Promise<void>(() => {}));
    await advance(SHOW_DELAY_MS * 2);
    expect(arcs()).toHaveLength(0);
  });
});

describe('WidgetCard pending ring', () => {
  it('rings on the icon at the size the variant uses', async () => {
    const { container } = render(
      <WidgetCard title="Desk Switch" icon={<span />} accessory={makeAccessory(true)} expanded />,
    );
    trackWrite(KEY, new Promise<void>(() => {}));
    await advance(SHOW_DELAY_MS);

    const arc = arcs(container)[0];
    expect(arc).toBeTruthy();
    // Expanded circles are h-11; the arc is inset-0 on a wrapper of that size.
    expect(arc.parentElement?.className).toContain('h-11 w-11');
  });

  // A No Response tile fades twice: the whole card to 50%, and the icon circle
  // on top of that to 20%. The arc shares the first — it is the tile saying it
  // is not responding, and 50% still reads — but must escape the second, which
  // would leave "still sending" invisible on exactly the tile that needs it.
  it('escapes the faded-icon wrapper when the accessory is unreachable', async () => {
    const { container } = render(
      <WidgetCard title="Desk Switch" icon={<span />} accessory={makeAccessory(false)} isReachable={false} />,
    );
    trackWrite(KEY, new Promise<void>(() => {}));
    await advance(SHOW_DELAY_MS);

    const arc = arcs(container)[0];
    expect(arc).toBeTruthy();
    // Prove the scenario is real before asserting the escape, so this cannot
    // pass just because the fade stopped being applied.
    const iconFade = container.querySelector('.opacity-20.grayscale');
    expect(iconFade).toBeTruthy();
    expect(iconFade!.contains(arc)).toBe(false);
    for (let el = arc.parentElement; el; el = el.parentElement) {
      expect(el.className).not.toContain('opacity-20');
    }
  });
});
