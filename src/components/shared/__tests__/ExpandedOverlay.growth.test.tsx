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
 * A panel that grows after it has opened rides up to stay on screen.
 *
 * The height cap used to be measured from where the panel was sitting, and the
 * position from the height — so a panel opened low froze at whatever it was
 * tall when it opened. Everything that appeared afterwards was squeezed off the
 * bottom, and it could not be scrolled to either: the collapse inside is a
 * `1fr` grid row, so a squeezed panel shrinks its contents rather than
 * overflowing them. Service groups showed it because their panels change size
 * after opening — switch the group on and two hero bars arrive — while an
 * accessory panel barely changes and looked fine.
 */
describe('a panel that grows while it is open', () => {
  const VH = 844;

  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: VH, configurable: true });
    notify = null;
    observed = null;
  });
  afterEach(cleanup);

  /** Mount an overlay whose trigger sits `triggerTop` down the screen. */
  const open = (triggerTop: number, bottomInset = 0) => {
    // The rect has to be in place before the overlay's layout effect reads it,
    // and a ref callback runs in the same commit, just before one.
    const stub = (el: HTMLDivElement | null) => {
      if (!el) return;
      el.getBoundingClientRect = () => ({
        left: 40, right: 180, top: triggerTop, bottom: triggerTop + 44,
        x: 40, y: triggerTop, width: 140, height: 44, toJSON: () => ({}),
      }) as DOMRect;
    };
    render(
      <div ref={stub}>
        <ExpandedOverlay isExpanded onClose={vi.fn()} bottomInset={bottomInset}>
          <div>content</div>
        </ExpandedOverlay>
      </div>,
    );
    const panel = document.body.querySelector<HTMLElement>('[data-expandable-widget]')!;
    return {
      /** Report a new content height, the way the real ResizeObserver would. */
      grow(height: number) {
        Object.defineProperty(observed!, 'offsetHeight', { value: height, configurable: true });
        act(() => { notify!(); });
      },
      top: () => parseFloat(panel.style.top || '0'),
      cap: () => parseFloat(
        panel.querySelector<HTMLElement>('[style*="max-height"]')!.style.maxHeight,
      ),
    };
  };

  it('lets a panel opened low grow taller than the room below it', () => {
    const p = open(700);
    p.grow(336);
    // It has already been pulled up to fit, so the room *below* it is 336 — and
    // that is exactly what the cap used to be, freezing it at that size.
    expect(p.cap()).toBeGreaterThan(336);
  });

  it('rides up as it grows rather than running off the bottom', () => {
    const p = open(700);
    p.grow(336);
    const first = p.top();
    p.grow(608);
    expect(p.top()).toBeLessThan(first);
    // Bottom edge = top + the wrapper's 10px ring on each side + the panel.
    expect(p.top() + 20 + 608).toBeLessThanOrEqual(VH);
  });

  it('caps at the viewport however low the trigger is', () => {
    const low = open(700).cap();
    cleanup();
    const high = open(80).cap();
    expect(low).toBe(high);
    expect(low).toBeLessThanOrEqual(VH);
  });

  it('still keeps a growing panel clear of a reserved strip', () => {
    const p = open(700, 140);
    p.grow(400);
    expect(p.top() + 20 + 400).toBeLessThanOrEqual(VH - 140);
    expect(p.cap()).toBeLessThanOrEqual(VH - 140);
  });
});
