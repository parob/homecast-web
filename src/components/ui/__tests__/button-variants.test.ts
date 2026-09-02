import { describe, it, expect } from 'vitest';
import { buttonVariants } from '../button';

/**
 * A variant that paints its own background must also pin its own text colour.
 *
 * Every variant here sets both halves of the pair (`bg-primary` with
 * `text-primary-foreground`, and so on) — except where it doesn't, and then the
 * label is whatever colour the *container* happens to be using. That is fine
 * until the container is dark, at which point a near-white label lands on a
 * near-white button: `outline` measured 1.04:1 and `ghost` 1.05:1 against the
 * dark palette, versus 18.40:1 and 20.01:1 in light (Chromium, computed styles
 * on the real component). WCAG AA wants 4.5:1. The label isn't hard to read, it
 * is not there.
 *
 * Inheriting the colour is the bug, so the invariant is checked rather than the
 * two colours that happen to be wrong today: a seventh variant added later gets
 * the same guard for free.
 */

const VARIANTS = ['default', 'destructive', 'outline', 'secondary', 'ghost', 'link'] as const;

/** `text-sm` is a font size, not a colour — it satisfies nothing. */
const FONT_SIZES = new Set([
  'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl', 'text-2xl', 'text-3xl',
]);

const tokensOf = (variant: (typeof VARIANTS)[number]) =>
  buttonVariants({ variant }).split(/\s+/).filter(Boolean);

/**
 * The classes cva shares across every variant, discovered rather than restated:
 * a token present in all six comes from the base string, so whatever is left is
 * the variant's own contribution.
 */
const baseTokens = VARIANTS.map(tokensOf)
  .reduce((shared, tokens) => shared.filter((t) => tokens.includes(t)));

const contributionOf = (variant: (typeof VARIANTS)[number]) =>
  tokensOf(variant).filter((t) => !baseTokens.includes(t));

/** Unprefixed only — `hover:` and `dark:` are states, not the resting style. */
const unprefixed = (tokens: string[]) => tokens.filter((t) => !t.includes(':'));

describe('buttonVariants', () => {
  it.each(VARIANTS)('%s sets a text colour if it sets a background', (variant) => {
    const own = unprefixed(contributionOf(variant));
    const paintsBackground = own.some((t) => t.startsWith('bg-'));
    const pinsForeground = own.some((t) => t.startsWith('text-') && !FONT_SIZES.has(t));

    if (!paintsBackground) return; // `link` paints nothing; nothing to inherit onto.

    expect(
      pinsForeground,
      `variant "${variant}" sets a background (${own.filter((t) => t.startsWith('bg-')).join(' ')}) ` +
        `but no text colour, so its label inherits the container's — white-on-white on a dark surface`,
    ).toBe(true);
  });

  it('every variant that paints a light background also answers for the dark palette', () => {
    for (const variant of VARIANTS) {
      const own = contributionOf(variant);
      const lightBg = unprefixed(own).some((t) => t.startsWith('bg-'));
      if (!lightBg) continue;

      const answersDark = own.some((t) => t.startsWith('dark:bg-')) ||
        unprefixed(own).some((t) => t.startsWith('bg-') && !t.startsWith('bg-['));

      expect(
        answersDark,
        `variant "${variant}" hardcodes a background that cannot follow the theme, ` +
          `and gives no dark: counterpart`,
      ).toBe(true);
    }
  });
});
