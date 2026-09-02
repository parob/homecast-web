// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { ExpandedOverlay } from '../ExpandedOverlay';

vi.mock('@/contexts/BackgroundContext', () => ({
  useBackgroundContext: () => ({ isDarkBackground: false }),
  BackgroundContext: React.createContext({ isDarkBackground: false }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));

/** The panel's own ResizeObserver, held so the test can say when it fired. */
let notify: (() => void) | null = null;
let observed: HTMLElement | null = null;
class ResizeObserverStub {
  constructor(private cb: () => void) {}
  observe(el: HTMLElement) { observed = el; notify = () => this.cb(); }
  unobserve() {}
  disconnect() { notify = null; }
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/**
 * A panel whose child lays out in two passes is PLACED, not flown in.
 *
 * The overlay measures once in its layout effect and clamps `top` to keep the
 * panel on screen — but a service group's member grid renders in full, measures
 * itself, and only then caps to two rows (useGridRowCap). The overlay's first
 * measurement is therefore the uncapped height, which overflows the viewport,
 * so `top` collapses to MIN_TOP: the top of the screen. The real height lands a
 * frame later.
 *
 * That correction used to be eased, because the glide was armed by `ready` —
 * which is set the frame the open BEGINS. So a group panel slid 200px down the
 * screen while fading in, instead of growing out of the tile it came from, and
 * a single accessory (one layout pass, measured right first time) did not.
 * homecast-cloud#57.
 */
describe('a panel whose height is corrected as it opens', () => {
  const VH = 844;
  const TRIGGER_TOP = 300;
  // coords.y - PADDING + TOP_OFFSET.
  const ANCHORED = TRIGGER_TOP - 10 + 16;

  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: VH, configurable: true });
    notify = null;
    observed = null;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const open = () => {
    const stub = (el: HTMLDivElement | null) => {
      if (!el) return;
      el.getBoundingClientRect = () => ({
        left: 40, right: 180, top: TRIGGER_TOP, bottom: TRIGGER_TOP + 44,
        x: 40, y: TRIGGER_TOP, width: 140, height: 44, toJSON: () => ({}),
      }) as DOMRect;
    };
    render(
      <div ref={stub}>
        <ExpandedOverlay isExpanded onClose={vi.fn()}>
          <div>content</div>
        </ExpandedOverlay>
      </div>,
    );
    // `ready` is set in a rAF, and it is what starts the settle window. One
    // frame, so the open animation has begun and the settle window is running —
    // which is exactly the state the correction used to be eased in.
    act(() => { vi.advanceTimersByTime(16); });
    const panel = document.body.querySelector<HTMLElement>('[data-expandable-widget]')!;
    return {
      /** Report a new content height, the way the real ResizeObserver would. */
      measure(height: number) {
        Object.defineProperty(observed!, 'offsetHeight', { value: height, configurable: true });
        act(() => { notify!(); });
      },
      top: () => parseFloat(panel.style.top || '0'),
      glides: () => panel.className.includes('transition-[top]'),
    };
  };

  it('does not ease the correction that lands while it is opening', () => {
    const p = open();
    // First pass: the whole member grid, taller than the viewport. The clamp
    // has nowhere to put it but the ceiling.
    p.measure(VH - 24);
    expect(p.top()).toBeLessThan(ANCHORED);
    // Second pass: capped to two rows, and now it fits where its tile is.
    p.measure(400);
    expect(p.top()).toBe(ANCHORED);
    // The panel is not visible yet — this has to be a placement, not a journey.
    expect(p.glides()).toBe(false);
  });

  it('still glides once the panel has arrived', () => {
    const p = open();
    p.measure(400);
    act(() => { vi.advanceTimersByTime(400); });
    expect(p.glides()).toBe(true);
    // Switching a group on adds hero bars; the panel rides up to fit, eased.
    p.measure(700);
    expect(p.top()).toBeLessThan(ANCHORED);
    expect(p.glides()).toBe(true);
  });
});
