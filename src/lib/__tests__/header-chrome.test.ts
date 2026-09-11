/**
 * How the header's bare glyphs stay legible.
 *
 * The ink is not chosen here — it is the page's, so the row reads as one thing.
 * What is chosen here is whether the halo has to work harder, which is exactly
 * when the page's ink is the one that loses on contrast against the strip the
 * controls sit over. That is a calculation, so it is testable.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  whiteInkWins,
  headerHaloNeedsReinforcing,
  headerControlClass,
  headerDotClass,
  INK_CONTRAST_CROSSOVER,
} from '../header-chrome';

/** WCAG relative-contrast ratio against white and against black. */
const vsWhite = (L: number) => 1.05 / (L + 0.05);
const vsBlack = (L: number) => (L + 0.05) / 0.05;

describe('whiteInkWins', () => {
  it('agrees with the contrast ratios at every luminance', () => {
    for (const L of [0, 0.02, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 0.95, 1]) {
      expect(whiteInkWins(L), `at luminance ${L}`).toBe(vsWhite(L) > vsBlack(L));
    }
  });

  it('crosses over where the two ratios are equal', () => {
    // (L + 0.05)² = 1.05 × 0.05, solved for L.
    expect(INK_CONTRAST_CROSSOVER).toBeCloseTo(Math.sqrt(1.05 * 0.05) - 0.05, 3);
    expect(whiteInkWins(INK_CONTRAST_CROSSOVER - 0.01)).toBe(true);
    expect(whiteInkWins(INK_CONTRAST_CROSSOVER + 0.01)).toBe(false);
  });

  it('claims nothing when nothing has been measured', () => {
    expect(whiteInkWins(null)).toBe(false);
    expect(whiteInkWins(undefined)).toBe(false);
  });
});

describe('headerHaloNeedsReinforcing', () => {
  /**
   * The measured effective luminance of the header band on the real preset
   * wallpapers, against the ink the page uses over each (the `isDarkBackground`
   * verdict — white on all five, since its threshold is 0.8).
   *
   * The first four are the regression: a white glyph over a band measuring 0.24
   * to 0.82 is between about 1.3:1 and 3.6:1, which is what the filled discs
   * used to hide. Only `beach` is a background where white ink is also the
   * high-contrast choice, and only there is the ordinary halo enough.
   */
  it.each([
    ['countryside @78', 0.670, true],
    ['clouds @85', 0.821, true],
    ['mountains @60', 0.492, true],
    ['cliffs @35', 0.237, true],
    ['beach @30', 0.057, false],
  ])('%s with white ink → reinforced: %s', (_name, luminance, expected) => {
    expect(headerHaloNeedsReinforcing(true, luminance as number)).toBe(expected);
  });

  it('reinforces dark ink over a genuinely dark strip too', () => {
    // The mirror case, so this is not secretly "reinforce whenever white".
    expect(headerHaloNeedsReinforcing(false, 0.03)).toBe(true);
    expect(headerHaloNeedsReinforcing(false, 0.9)).toBe(false);
  });

  it('does not reinforce on no evidence', () => {
    // A permanently heavy halo is a worse default than a light one, and an
    // unmeasured background is not a reason to assume the worst.
    expect(headerHaloNeedsReinforcing(true, null)).toBe(false);
    expect(headerHaloNeedsReinforcing(false, undefined)).toBe(false);
  });
});

describe('header control classes', () => {
  const all = [
    headerControlClass(true), headerControlClass(false),
    headerControlClass(true, true), headerControlClass(false, true),
    headerDotClass(true), headerDotClass(false),
    headerDotClass(true, true), headerDotClass(false, true),
  ];

  it('never paints a resting background — a disc means "being pressed"', () => {
    for (const cls of [headerControlClass(true), headerControlClass(false)]) {
      expect(cls).toContain('!bg-transparent');
    }
    // The dot is not a shadcn Button, so it needs no `!` to win.
    for (const cls of [headerDotClass(true), headerDotClass(false)]) {
      expect(cls).toMatch(/(^|\s)bg-transparent(\s|$)/);
    }
  });

  it('haloes in the opposite colour to the ink', () => {
    expect(headerControlClass(true)).toContain('text-white');
    expect(headerControlClass(true)).toContain('rgba(0,0,0,');
    expect(headerControlClass(true)).not.toContain('rgba(255,255,255,');
    expect(headerControlClass(false)).toContain('text-foreground');
    expect(headerControlClass(false)).toContain('rgba(255,255,255,');
    expect(headerControlClass(false)).not.toContain('rgba(0,0,0,');
  });

  it('always carries at least a tight core and a wide spread', () => {
    // One tight shadow vanishes into mid-tone clutter; one wide one reads as a
    // smudge. Losing either is the failure mode, so count them.
    for (const cls of all) {
      expect((cls.match(/drop-shadow\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });

  it('reinforcing adds a layer rather than swapping one in', () => {
    for (const [plain, strong] of [
      [headerControlClass(true), headerControlClass(true, true)],
      [headerDotClass(false), headerDotClass(false, true)],
    ]) {
      expect((strong.match(/drop-shadow\(/g) ?? []).length)
        .toBeGreaterThan((plain.match(/drop-shadow\(/g) ?? []).length);
    }
  });

  it('reinforcing never changes the ink', () => {
    expect(headerControlClass(true, true)).toContain('text-white');
    expect(headerControlClass(false, true)).toContain('text-foreground');
  });

  /**
   * The bug this file exists to prevent, and the only one here that is about
   * the build rather than the design.
   *
   * Tailwind emits CSS for class names it can read *verbatim* in the source. It
   * scans text; it does not evaluate. A class assembled from a template literal
   * compiles, type-checks and passes every other test in this file while
   * shipping no rule at all — the element gets a class name nothing matches, and
   * the halo silently disappears in dev and production alike. That is exactly
   * what happened between parob/homecast-web#106's last push and its merge, and
   * nothing caught it: not tsc, not eslint, not the screenshots, which were
   * taken against the same broken CSS.
   *
   * So this asserts the scanner's own rule directly, against the real file.
   */
  it('every class it can return is a literal in its own source', () => {
    const source = fs.readFileSync(
      path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../header-chrome.ts'),
      'utf8',
    );
    for (const cls of all) {
      for (const token of cls.split(' ')) {
        expect(source, `"${token}" is not spelled out in header-chrome.ts, so Tailwind will not emit CSS for it`)
          .toContain(token);
      }
    }
  });

  it('builds no class name by interpolation', () => {
    // The same rule stated the other way round, so a future refactor that
    // reintroduces a template literal fails here even if it happens to produce
    // strings that exist elsewhere in the file.
    for (const cls of all) {
      expect(cls).not.toContain('${');
    }
  });

  it('stays a halo — no opaque plate creeps in', () => {
    // Every shadow layer must stay translucent; a 1.0 alpha would be a shape.
    for (const cls of all) {
      for (const [, alpha] of cls.matchAll(/rgba\([\d,]+,([\d.]+)\)/g)) {
        expect(Number(alpha)).toBeLessThan(1);
      }
    }
  });
});
