// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act, cleanup } from '@testing-library/react';
import React from 'react';
import { ExpandedOverlay } from '../ExpandedOverlay';

vi.mock('@/contexts/BackgroundContext', () => ({
  useBackgroundContext: () => ({ isDarkBackground: false }),
  BackgroundContext: React.createContext({ isDarkBackground: false }),
}));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => true }));

// jsdom has neither; the overlay watches its panel and clamps to the viewport.
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

/**
 * Where the panel lands when its trigger is not fully on screen.
 *
 * The pinned tab bar scrolls, so a chip with a long name can be half off the
 * side when you press it. The placement branches align the panel to the
 * trigger's own edge, which quietly assumes the trigger has one on screen —
 * with a negative `left` the panel went off the same edge and half the widget
 * was unreachable.
 */
describe('panel placement against an off-screen trigger', () => {
  const PORTRAIT_WIDTH = 300;
  const PADDING = 10;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });

  /** Render an overlay whose trigger sits at `left`, and read the panel's x. */
  const panelLeftFor = (left: number, width = 140, centred = false) => {
    const { container } = render(
      <div>
        <ExpandedOverlay isExpanded onClose={vi.fn()} centred={centred}>
          <div>content</div>
        </ExpandedOverlay>
      </div>,
    );
    const placeholder = container.querySelector<HTMLElement>('.hidden')!;
    const trigger = placeholder.parentElement!;
    trigger.getBoundingClientRect = () => ({
      left, right: left + width, top: 700, bottom: 744,
      x: left, y: 700, width, height: 44, toJSON: () => ({}),
    }) as DOMRect;
    act(() => { window.dispatchEvent(new Event('resize')); });

    const panel = document.body.querySelector<HTMLElement>('[data-expandable-widget]')!;
    return parseFloat(panel.style.left || '0');
  };

  const maxLeft = 390 - (PORTRAIT_WIDTH + PADDING * 2);

  it('never places the panel off the left edge', () => {
    // A chip clipped by the scroller reports a negative left.
    expect(panelLeftFor(-60)).toBeGreaterThanOrEqual(0);
  });

  it('never places the panel off the right edge', () => {
    expect(panelLeftFor(340)).toBeLessThanOrEqual(maxLeft);
  });

  it('leaves a trigger with room where it is', () => {
    const x = panelLeftFor(120);
    expect(x).toBeGreaterThanOrEqual(0);
    expect(x).toBeLessThanOrEqual(maxLeft);
  });
});

/**
 * A pinned panel is centred, because its chip is on its way to the centre.
 *
 * Anchoring to the trigger meant setting off from wherever the chip happened to
 * be — off the side of the screen, for one that started there — and chasing it.
 * The destination is known before the journey starts.
 */
describe('a centred panel', () => {
  const PORTRAIT_WIDTH = 300;
  const PADDING = 10;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });

  const centredLeftFor = (triggerLeft: number) => {
    const { container } = render(
      <div>
        <ExpandedOverlay isExpanded onClose={vi.fn()} centred>
          <div>content</div>
        </ExpandedOverlay>
      </div>,
    );
    const trigger = container.querySelector<HTMLElement>('.hidden')!.parentElement!;
    trigger.getBoundingClientRect = () => ({
      left: triggerLeft, right: triggerLeft + 140, top: 700, bottom: 744,
      x: triggerLeft, y: 700, width: 140, height: 44, toJSON: () => ({}),
    }) as DOMRect;
    act(() => { window.dispatchEvent(new Event('resize')); });
    const panel = document.body.querySelector<HTMLElement>('[data-expandable-widget]')!;
    return parseFloat(panel.style.left || '0');
  };

  const expected = (390 - (PORTRAIT_WIDTH + PADDING * 2)) / 2;

  it('sits in the middle whatever the trigger is doing', () => {
    expect(centredLeftFor(-60)).toBeCloseTo(expected, 0);
    expect(centredLeftFor(340)).toBeCloseTo(expected, 0);
    expect(centredLeftFor(120)).toBeCloseTo(expected, 0);
  });
});

/**
 * A panel never runs past the space it was given at the bottom.
 *
 * `top` was clamped to keep the panel on screen but nothing clamped its height,
 * so a tall one simply ran past `bottomInset`. Opened from the pinned tab bar
 * that put its bottom edge under the bar — which is painted above it — and a
 * tap meant for the widget pressed a tab instead. It showed on service groups
 * and shortcuts because their cards are tall; an accessory panel was never long
 * enough to reach.
 */
describe('a panel taller than the room above the bar', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  });

  const panelFor = (bottomInset: number) => {
    const { container } = render(
      <div>
        <ExpandedOverlay isExpanded onClose={vi.fn()} bottomInset={bottomInset} centred>
          <div>content</div>
        </ExpandedOverlay>
      </div>,
    );
    const trigger = container.querySelector<HTMLElement>('.hidden')!.parentElement!;
    trigger.getBoundingClientRect = () => ({
      left: 40, right: 180, top: 700, bottom: 744,
      x: 40, y: 700, width: 140, height: 44, toJSON: () => ({}),
    }) as DOMRect;
    act(() => { window.dispatchEvent(new Event('resize')); });
    const outer = document.body.querySelector<HTMLElement>('[data-expandable-widget]')!;
    const inner = outer.querySelector<HTMLElement>('[style*="max-height"]');
    return { outer, inner };
  };

  it('caps its height so the bottom of it clears the bar', () => {
    const { outer, inner } = panelFor(140);
    const top = parseFloat(outer.style.top);
    const cap = parseFloat(inner!.style.maxHeight);

    expect(cap).toBeGreaterThan(0);
    // Bottom edge = top + height + the wrapper's own 10px ring, and it must
    // land above the reserved strip.
    expect(top + cap).toBeLessThanOrEqual(844 - 140);
  });

  it('leaves more room when less is reserved', () => {
    const tight = parseFloat(panelFor(300).inner!.style.maxHeight);
    cleanup();
    const roomy = parseFloat(panelFor(100).inner!.style.maxHeight);
    expect(roomy).toBeGreaterThan(tight);
  });
});
