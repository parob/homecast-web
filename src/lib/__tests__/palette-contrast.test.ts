import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The palette's text-on-fill pairs must clear WCAG AA.
 *
 * `buttonVariants` already guards the *structural* half of this — a variant
 * that paints a background must pin its own text colour — but a variant can do
 * that correctly and still be unreadable, because pinning white onto a colour
 * says nothing about how light the colour is. `--primary` was `217 91% 60%`,
 * which is white-on-blue at 3.64:1, and the most-pressed control in the app sat
 * below AA in both palettes with every structural test passing.
 *
 * So this reads the real tokens out of `index.css` and does the arithmetic.
 * Button labels are `text-sm` (14px) at `font-medium` — normal text, not large
 * — so the bar is 4.5:1, not 3:1.
 */

const CSS = readFileSync(
  fileURLToPath(new URL('../../index.css', import.meta.url)),
  'utf8',
);

/** Custom properties declared in one selector's block. */
function tokensIn(selector: string): Record<string, string> {
  // Non-greedy to the first closing brace at the start of a line: these blocks
  // contain no nested rules, and anchoring on the newline keeps a `}` inside a
  // value (there are none today) from ending the block early.
  const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(CSS);
  if (!block) throw new Error(`no ${selector} block in index.css`);
  const out: Record<string, string> = {};
  for (const [, name, value] of block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)) {
    out[name] = value.trim();
  }
  return out;
}

/** `"217 91% 51%"` — Tailwind's channel-less form — to sRGB. */
function hslToRgb(value: string): [number, number, number] {
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(value);
  if (!m) throw new Error(`not an HSL triple: "${value}"`);
  const h = Number(m[1]);
  const s = Number(m[2]) / 100;
  const l = Number(m[3]) / 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m0 = l - c / 2;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return [r, g, b].map((v) => Math.round((v + m0) * 255)) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (v: number) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [la, lb] = [relativeLuminance(hslToRgb(a)), relativeLuminance(hslToRgb(b))];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const AA_NORMAL_TEXT = 4.5;

/** fill → the text painted on it. Every one of these renders a real label. */
const PAIRS: Array<[string, string]> = [
  ['background', 'foreground'],
  ['primary', 'primary-foreground'],
  ['destructive', 'destructive-foreground'],
  ['secondary', 'secondary-foreground'],
  ['accent', 'accent-foreground'],
  ['card', 'card-foreground'],
  ['popover', 'popover-foreground'],
];

describe.each([
  ['light', ':root'],
  ['dark', '\\.dark'],
])('%s palette', (_label, selector) => {
  const tokens = tokensIn(selector);

  it.each(PAIRS)('%s / %s clears AA for normal text', (fill, text) => {
    const ratio = contrast(tokens[fill], tokens[text]);
    expect(
      ratio,
      `--${text} on --${fill} is ${ratio.toFixed(2)}:1, below the ${AA_NORMAL_TEXT}:1 ` +
        `AA needs for 14px labels (fill ${tokens[fill]}, text ${tokens[text]})`,
    ).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });

  // The `link` variant paints nothing: it is --primary as text on whatever the
  // page is. Same numbers as the filled button by symmetry, but it regresses
  // independently if anyone ever splits the two tokens apart.
  it('link text clears AA on the page background', () => {
    const ratio = contrast(tokens.primary, tokens.background);
    expect(ratio).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
  });
});
