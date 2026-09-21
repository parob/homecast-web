import { describe, it, expect } from 'vitest';
import { resolveCanvasTint, THEME_CANVAS } from '../canvas-tint';
import { PRESET_IMAGES, PRESET_SOLID_COLORS, PRESET_GRADIENTS, getLuminance, setLuminanceHex } from '../colorUtils';
import type { BackgroundSettings } from '../graphql/types';

const bg = (over: Partial<BackgroundSettings>): BackgroundSettings => ({
  type: 'none', blur: 20, brightness: 50, ...over,
});

const firstKey = (o: Record<string, unknown>) => Object.keys(o)[0];

describe('resolveCanvasTint', () => {
  it('uses the theme colour when there is no wallpaper', () => {
    // Not a hardcoded #ffffff: the page really is the theme colour here, and a
    // literal would fight any future dark mode.
    expect(resolveCanvasTint({ background: null, sampledTopColor: null, isDark: false })).toBe(THEME_CANVAS);
    expect(resolveCanvasTint({ background: undefined, sampledTopColor: null, isDark: false })).toBe(THEME_CANVAS);
    expect(resolveCanvasTint({ background: bg({ type: 'none' }), sampledTopColor: null, isDark: false })).toBe(THEME_CANVAS);
  });

  it('never falls back to white once a wallpaper is set', () => {
    // The original bug: every one of these fell through to '#ffffff'.
    // 'solid-white' is excluded on purpose — see the test below.
    const cases = [
      bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }),
      bg({ type: 'preset', presetId: firstKey(PRESET_IMAGES) }),
      bg({ type: 'preset', presetId: 'solid-blue' }),
      bg({ type: 'preset', presetId: firstKey(PRESET_GRADIENTS) }),
      bg({ type: 'preset', presetId: 'a-preset-we-do-not-know' }),
    ];
    for (const background of cases) {
      for (const isDark of [true, false]) {
        for (const sampledTopColor of [null, '#123456']) {
          const tint = resolveCanvasTint({ background, sampledTopColor, isDark });
          expect(tint).not.toBe(THEME_CANVAS);
          expect(tint.toLowerCase()).not.toBe('#ffffff');
          expect(tint.toLowerCase()).not.toBe('#fff');
        }
      }
    }
  });

  it('does paint white when the wallpaper itself is white', () => {
    // Not the bug. A white canvas under a white wallpaper is the correct
    // answer; what was wrong was reaching white by falling through.
    const tint = resolveCanvasTint({
      background: bg({ type: 'preset', presetId: 'solid-white' }),
      sampledTopColor: null,
      isDark: false,
    });
    expect(tint.toLowerCase()).toBe('#ffffff');
  });

  it('drops the flat grey placeholders the old code flashed', () => {
    // '#aaaaaa' over a dark nature photograph was the visible flash.
    const pending = resolveCanvasTint({
      background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }),
      sampledTopColor: null,
      isDark: true,
    });
    expect(pending.toLowerCase()).not.toBe('#aaaaaa');
    expect(pending.toLowerCase()).not.toBe('#888888');
  });

  it('places the pending tint on the right side of mid grey', () => {
    const shared = { background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }), sampledTopColor: null };
    const channel = (hex: string) => parseInt(hex.slice(1, 3), 16);
    expect(channel(resolveCanvasTint({ ...shared, isDark: true }))).toBeLessThan(128);
    expect(channel(resolveCanvasTint({ ...shared, isDark: false }))).toBeGreaterThan(128);
  });

  it('prefers the sampled colour over the placeholder once it lands', () => {
    const shared = { background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }), isDark: true };
    const pending = resolveCanvasTint({ ...shared, sampledTopColor: null });
    const sampled = resolveCanvasTint({ ...shared, sampledTopColor: '#204080' });
    expect(sampled).not.toBe(pending);
  });

  it('lifts a sampled colour a little towards white', () => {
    // The sample is the wallpaper's outermost rows, its darkest on most
    // photographs; used raw it sat a shade too dark against the wallpaper.
    const tint = resolveCanvasTint({ background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }), sampledTopColor: '#025260', isDark: true });
    const channel = (hex: string, i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
    for (let i = 0; i < 3; i++) expect(channel(tint, i)).toBeGreaterThan(channel('#025260', i));
    expect(channel(tint, 0)).toBeLessThan(0x02 + 255 * 0.2); // a lift, not a wash
  });

  // ── The canvas takes the edge's hue and the picture's brightness (#157) ────
  //
  // A photograph of a building against the sky: the top 5% the sampler reads
  // is sky and nothing else about the picture gets a vote. Taken as-is that
  // put two bright blue bands around a dark brick facade, measured on the
  // reporter's own screenshot at 1.9x the luminance of what they bordered.

  /** The sky strip and the whole picture, as measured off that report. */
  const SKY_EDGE = '#91abd9';
  const DARK_WALLPAPER_LUMINANCE = getLuminance(0x5a, 0x5a, 0x55); // the page body, ~0.1

  const lumOf = (hex: string) =>
    getLuminance(
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    );

  const skyOverDark = (over: Partial<Parameters<typeof resolveCanvasTint>[0]> = {}) =>
    resolveCanvasTint({
      background: bg({ type: 'custom', customUrl: 'https://example.test/house.jpg' }),
      sampledTopColor: SKY_EDGE,
      isDark: true,
      wallpaperLuminance: DARK_WALLPAPER_LUMINANCE,
      ...over,
    });

  it('does not paint a bright band around a dark wallpaper', () => {
    const before = resolveCanvasTint({
      background: bg({ type: 'custom', customUrl: 'https://example.test/house.jpg' }),
      sampledTopColor: SKY_EDGE,
      isDark: true,
    });
    const after = skyOverDark();

    // What the report showed: without the picture's luminance, the canvas is
    // the sky, several times brighter than the wallpaper it borders.
    expect(lumOf(before) / DARK_WALLPAPER_LUMINANCE).toBeGreaterThan(3);
    // With it, the band is in the wallpaper's own register. Not equal to it:
    // the lift still keeps the band from reading as a shadow.
    expect(lumOf(after) / DARK_WALLPAPER_LUMINANCE).toBeLessThan(2);
    expect(lumOf(after)).toBeLessThan(lumOf(before));
  });

  it('keeps the edge hue while changing its brightness', () => {
    const tint = skyOverDark();
    const [r, g, b] = [1, 3, 5].map(i => parseInt(tint.slice(i, i + 2), 16));
    // The sky is blue; so is the band that replaces it.
    expect(b).toBeGreaterThan(r);
    expect(b).toBeGreaterThan(g);
  });

  it('leaves a wallpaper whose edge already matches it alone', () => {
    // An evenly lit picture: edge and average agree, so there is nothing to
    // correct and the answer must not move.
    const even = '#6b6f74';
    const shared = {
      background: bg({ type: 'custom', customUrl: 'https://example.test/even.jpg' }),
      sampledTopColor: even,
      isDark: true,
    };
    const matched = resolveCanvasTint({ ...shared, wallpaperLuminance: lumOf(even) });
    const unmatched = resolveCanvasTint(shared);
    // Within a channel step of each other, not bit-identical: the round trip
    // through linear light and back costs a unit here and there.
    for (let i = 0; i < 3; i++) {
      const c = (hex: string) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
      expect(Math.abs(c(matched) - c(unmatched))).toBeLessThanOrEqual(2);
    }
  });

  it('lifts a dark edge on a bright wallpaper, the same rule the other way', () => {
    // A bright photograph with a dark foreground at the edge sampled: the band
    // belongs to the picture, so it goes up rather than down.
    const darkEdge = '#2b2a28';
    const bright = getLuminance(0xd0, 0xcf, 0xc8);
    const tint = resolveCanvasTint({
      background: bg({ type: 'custom', customUrl: 'https://example.test/beach.jpg' }),
      sampledTopColor: darkEdge,
      isDark: false,
      wallpaperLuminance: bright,
    });
    expect(lumOf(tint)).toBeGreaterThan(lumOf(darkEdge) * 3);
  });

  it('is the old behaviour exactly when no luminance is known yet', () => {
    const shared = {
      background: bg({ type: 'custom', customUrl: 'https://example.test/a.jpg' }),
      sampledTopColor: SKY_EDGE,
      isDark: true,
    };
    expect(resolveCanvasTint({ ...shared, wallpaperLuminance: null })).toBe(resolveCanvasTint(shared));
    expect(resolveCanvasTint({ ...shared, wallpaperLuminance: undefined })).toBe(resolveCanvasTint(shared));
  });

  it('darkens the band further when the wallpaper is dimmed', () => {
    // Brightness is the wallpaper's own overlay; the band has to follow it
    // down or it stops matching the picture the moment the slider moves.
    const full = skyOverDark();
    const dimmed = skyOverDark({
      background: bg({ type: 'custom', customUrl: 'https://example.test/house.jpg', brightness: 20 }),
    });
    expect(lumOf(dimmed)).toBeLessThan(lumOf(full));
  });

  it('resolves solid and gradient presets without waiting for a sample', () => {
    for (const presetId of [firstKey(PRESET_SOLID_COLORS), firstKey(PRESET_GRADIENTS)]) {
      const withSample = resolveCanvasTint({ background: bg({ type: 'preset', presetId }), sampledTopColor: '#abcdef', isDark: false });
      const without = resolveCanvasTint({ background: bg({ type: 'preset', presetId }), sampledTopColor: null, isDark: false });
      // Known up front, so sampling cannot change the answer.
      expect(withSample).toBe(without);
    }
  });
});

describe('setLuminanceHex', () => {
  const lumOf = (hex: string) =>
    getLuminance(
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    );

  it('hits the luminance it is asked for', () => {
    // Within 0.02, not to the last bit: the result is three 8-bit channels and
    // each one rounds on its own, so a couple of steps of slack is the format
    // rather than the maths. 0.02 is far below anything the eye separates.
    for (const hex of ['#91abd9', '#025260', '#d0cfc8', '#7f3f1f']) {
      for (const target of [0.05, 0.18, 0.4]) {
        expect(Math.abs(lumOf(setLuminanceHex(hex, target)) - target)).toBeLessThan(0.02);
      }
    }
  });

  it('keeps the channel ratios, so the hue survives the move', () => {
    const out = setLuminanceHex('#91abd9', 0.1);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(out.slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(r);
  });

  it('answers a neutral grey for black, which has no hue to keep', () => {
    const out = setLuminanceHex('#000000', 0.2);
    expect(out.slice(1, 3)).toBe(out.slice(3, 5));
    expect(out.slice(3, 5)).toBe(out.slice(5, 7));
    expect(lumOf(out)).toBeCloseTo(0.2, 2);
  });

  it('clamps rather than throwing on a target the colour cannot reach', () => {
    const out = setLuminanceHex('#0000ff', 1);
    expect(out).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('returns non-hex input unchanged', () => {
    expect(setLuminanceHex('rebeccapurple', 0.3)).toBe('rebeccapurple');
  });
});

/**
 * parob/homecast-cloud#161: the two adjustments above are for iOS 26 Safari's
 * glass bars. An app shell has no bars — it is asking what to paint the
 * WKWebView's backdrop, which is only ever seen against the wallpaper's own
 * top rows — so it gets the sample as sampled.
 */
describe('resolveCanvasTint for an app shell backdrop', () => {
  const background = { type: 'custom' as const, customUrl: 'https://example.test/night.jpg', blur: 0, brightness: 50 };

  it('returns the sampled edge colour untouched', () => {
    const tint = resolveCanvasTint({
      background,
      sampledTopColor: '#231d2e',
      isDark: true,
      wallpaperLuminance: 0.28,
      surface: 'backdrop',
    });
    expect(tint.toLowerCase()).toBe('#231d2e');
  });

  it('differs from the bars answer on the same wallpaper', () => {
    const input = { background, sampledTopColor: '#231d2e', isDark: true, wallpaperLuminance: 0.28 };
    expect(resolveCanvasTint({ ...input, surface: 'backdrop' }))
      .not.toBe(resolveCanvasTint({ ...input, surface: 'bars' }));
    // Absent means bars, so every existing caller is unchanged.
    expect(resolveCanvasTint(input)).toBe(resolveCanvasTint({ ...input, surface: 'bars' }));
  });

  it('still applies the wallpaper\'s own brightness setting', () => {
    const dimmed = resolveCanvasTint({
      background: { ...background, brightness: 20 },
      sampledTopColor: '#808080',
      isDark: true,
      surface: 'backdrop',
    });
    expect(dimmed.toLowerCase()).not.toBe('#808080');
  });
});
