/**
 * Which ink the header's bare glyphs are drawn in.
 *
 * The rule is a contrast calculation, not a taste call, so it is testable: at
 * any given background luminance, exactly one of white and black has the better
 * WCAG ratio, and the threshold is where they cross.
 */
import { describe, it, expect } from 'vitest';
import { headerInkIsLight, headerControlClass, headerDotClass, INK_CONTRAST_CROSSOVER } from '../header-chrome';

/** WCAG relative-contrast ratio against white and against black. */
const vsWhite = (L: number) => 1.05 / (L + 0.05);
const vsBlack = (L: number) => (L + 0.05) / 0.05;

describe('headerInkIsLight', () => {
  it('picks whichever ink actually has more contrast', () => {
    for (const L of [0, 0.02, 0.05, 0.1, 0.15, 0.25, 0.4, 0.6, 0.8, 0.95, 1]) {
      const whiteWins = vsWhite(L) > vsBlack(L);
      expect(headerInkIsLight(L), `at luminance ${L}`).toBe(whiteWins);
    }
  });

  it('crosses over where the two ratios are equal', () => {
    // (L + 0.05)² = 1.05 × 0.05, solved for L.
    const exact = Math.sqrt(1.05 * 0.05) - 0.05;
    expect(INK_CONTRAST_CROSSOVER).toBeCloseTo(exact, 3);
    expect(headerInkIsLight(INK_CONTRAST_CROSSOVER - 0.01)).toBe(true);
    expect(headerInkIsLight(INK_CONTRAST_CROSSOVER + 0.01)).toBe(false);
  });

  it('falls back to the theme ink when there is nothing measured', () => {
    // Not merely a default: `text-foreground` is correct in both themes, which
    // is the only answer that cannot be wrong while the answer is unknown.
    expect(headerInkIsLight(null)).toBe(false);
    expect(headerInkIsLight(undefined)).toBe(false);
  });

  /**
   * The regression this whole rule exists for. These are the measured effective
   * luminances of the header band on real preset wallpapers (see the probe in
   * parob/homecast-web#106). Under `isDarkLuminance`'s 0.8 threshold every one
   * of them counted as dark and got white icons — including the two well above
   * 0.5, which is a contrast ratio near 1.3:1.
   */
  it.each([
    ['countryside @78', 0.670, false],
    ['clouds @85', 0.821, false],
    ['mountains @60', 0.492, false],
    ['cliffs @35', 0.237, false],
    ['beach @30', 0.057, true],
  ])('%s → light ink: %s', (_name, luminance, expected) => {
    expect(headerInkIsLight(luminance as number)).toBe(expected);
  });
});

describe('header control classes', () => {
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
    expect(headerControlClass(false)).toContain('text-foreground');
    expect(headerControlClass(false)).toContain('rgba(255,255,255,');
  });

  it('carries both halo layers — a tight core and a wide spread', () => {
    // One tight shadow vanishes into mid-tone clutter; one wide one reads as a
    // smudge. Losing either is the failure mode, so count them.
    for (const cls of [headerControlClass(true), headerControlClass(false), headerDotClass(true), headerDotClass(false)]) {
      expect(cls.match(/drop-shadow\(/g) ?? []).toHaveLength(2);
    }
  });
});
