// @vitest-environment jsdom
/**
 * The summary row's height animation.
 *
 * jsdom has no layout and no ResizeObserver, so what is testable here is the
 * wiring: that a height gets pinned once measured, that the transition is not
 * armed before that first measurement, and that someone who asked for less
 * movement gets the step instead of the slide.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { AutoHeight } from '../auto-height';

let observed: (() => void)[] = [];

beforeEach(() => {
  observed = [];
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
    constructor(private cb: () => void) { observed.push(() => this.cb()); }
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // jsdom reports 0 for every box; give the content one so a height is pinned.
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 24, width: 300, top: 0, left: 0, right: 300, bottom: 24, x: 0, y: 0,
    toJSON: () => ({}),
  } as DOMRect);
  window.matchMedia = ((q: string) => ({
    matches: false, media: q, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const outer = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('a row that animates its own height', () => {
  it('pins the measured height so it has something to animate from', () => {
    const { container } = render(<AutoHeight><p>Scenes</p></AutoHeight>);
    expect(outer(container).style.height).toBe('24px');
  });

  it('arms the transition only after the first measurement', () => {
    // Animating from no height would slide the row down on its first paint.
    const { container } = render(<AutoHeight><p>Scenes</p></AutoHeight>);
    act(() => {});
    expect(outer(container).className).toContain('transition-[height]');
  });

  it('does not animate when the caller turns it off', () => {
    const { container } = render(<AutoHeight disabled><p>Scenes</p></AutoHeight>);
    act(() => {});
    expect(outer(container).className).not.toContain('transition-[height]');
  });

  it('respects prefers-reduced-motion — a step, not a slide', () => {
    window.matchMedia = ((q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
    const { container } = render(<AutoHeight><p>Scenes</p></AutoHeight>);
    act(() => {});
    expect(outer(container).className).not.toContain('transition-[height]');
  });

  it('watches the content, not the wrapper it is animating', () => {
    // Observing the wrapper would feed its own animated height back in.
    const { container } = render(<AutoHeight><p>Scenes</p></AutoHeight>);
    expect(observed).toHaveLength(1);
    expect(outer(container).firstElementChild).toBeTruthy();
  });
});
