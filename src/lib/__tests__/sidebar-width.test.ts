import { describe, it, expect } from 'vitest';
import {
  sidebarWidthAt,
  sidebarWidthCss,
  SIDEBAR_MIN,
  SIDEBAR_MAX,
  SIDEBAR_GROW_FROM,
  SIDEBAR_GROW_TO,
} from '../sidebar-width';

const EDIT_EXTRA = 56;

describe('sidebarWidthAt', () => {
  it('is the width every install already had, below the threshold', () => {
    // The change must be invisible on a laptop. 248px is what shipped.
    for (const w of [900, 1024, 1180, SIDEBAR_GROW_FROM]) {
      expect(sidebarWidthAt(w)).toBe(SIDEBAR_MIN);
    }
  });

  it('reaches the ceiling at the far threshold and stops there', () => {
    expect(sidebarWidthAt(SIDEBAR_GROW_TO)).toBeCloseTo(SIDEBAR_MAX, 0);
    for (const w of [2200, 2560, 3840, 7680]) {
      expect(sidebarWidthAt(w)).toBe(SIDEBAR_MAX);
    }
  });

  it('grows gradually in between, never in a step', () => {
    // "Gradually" is the ask, so the test is monotonic and small-stepped
    // rather than a handful of sampled widths.
    let previous = sidebarWidthAt(SIDEBAR_GROW_FROM);
    for (let w = SIDEBAR_GROW_FROM + 10; w <= SIDEBAR_GROW_TO; w += 10) {
      const width = sidebarWidthAt(w);
      expect(width).toBeGreaterThanOrEqual(previous);
      expect(width - previous).toBeLessThan(4);
      previous = width;
    }
    expect(previous).toBeGreaterThan(sidebarWidthAt(SIDEBAR_GROW_FROM));
  });

  it('is about halfway across at the midpoint', () => {
    const mid = (SIDEBAR_GROW_FROM + SIDEBAR_GROW_TO) / 2;
    expect(sidebarWidthAt(mid)).toBeCloseTo((SIDEBAR_MIN + SIDEBAR_MAX) / 2, 0);
  });

  it('adds edit mode’s extra at every window width, ceiling included', () => {
    // The reason `extra` goes into the clamp rather than onto the result: on a
    // wide screen the panel is already at its ceiling, and adding afterwards
    // would be clamped away — so entering edit mode would widen the panel on a
    // laptop and do nothing on a desktop.
    for (const w of [1024, 1600, 2560]) {
      expect(sidebarWidthAt(w, EDIT_EXTRA) - sidebarWidthAt(w)).toBe(EDIT_EXTRA);
    }
  });
});

describe('sidebarWidthCss', () => {
  /** Evaluate a `clamp(a, calc(b + (100vw - c) * r), d)` at a viewport width. */
  const evaluate = (css: string, viewport: number): number => {
    const m = css.match(
      /^clamp\((\d+)px, calc\((\d+)px \+ \(100vw - (\d+)px\) \* ([\d.]+)\), (\d+)px\)$/,
    );
    if (!m) throw new Error(`not the shape this test can evaluate: ${css}`);
    const [lo, base, from, rate, hi] = m.slice(1).map(Number);
    return Math.min(hi, Math.max(lo, base + (viewport - from) * rate));
  };

  it('is the same curve the arithmetic describes', () => {
    // The panel uses the CSS and the tests above use the function; this is
    // what stops the two drifting apart.
    for (const extra of [0, EDIT_EXTRA]) {
      const css = sidebarWidthCss(extra);
      for (const w of [800, 1280, 1400, 1600, 1920, 2560]) {
        expect(evaluate(css, w)).toBeCloseTo(sidebarWidthAt(w, extra), 6);
      }
    }
  });

  it('is a length a browser will accept', () => {
    expect(sidebarWidthCss()).toMatch(/^clamp\(\d+px, calc\(.+\), \d+px\)$/);
  });
});
