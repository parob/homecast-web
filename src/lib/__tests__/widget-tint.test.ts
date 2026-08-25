import { describe, it, expect } from 'vitest';
import {
  resolveWidgetTint,
  tintLevel,
  rgbaToCss,
  TINT_FLOOR,
  TINT_ALPHA,
  STANDARD_TINT,
  OFF_TINT_LIGHT,
  OFF_TINT_DARK,
  type TintInput,
} from '../widget-tint';

const YELLOW = '#fef08a'; // yellow-200, what a lightbulb paints with

/** A tile over a plain white page, which is what no wallpaper means. */
const onWhite = (over: Partial<TintInput> = {}): TintInput => ({
  tint: YELLOW,
  intensity: null,
  isOn: true,
  isDarkWallpaper: false,
  wallpaperLuminance: 1,
  ...over,
});

/** A tile over a dark photograph. */
const onDark = (over: Partial<TintInput> = {}): TintInput => ({
  ...onWhite(),
  isDarkWallpaper: true,
  wallpaperLuminance: 0.03,
  ...over,
});

describe('tintLevel', () => {
  it('paints an accessory with no proportion at full strength', () => {
    // A lock, a switch, a bulb that cannot dim. These must look exactly as
    // they did before the feature existed.
    expect(tintLevel(null)).toBe(1);
    expect(tintLevel(undefined)).toBe(1);
  });

  it('lifts a barely-on accessory onto the floor', () => {
    // The whole point of the floor: 5% must still read as on.
    expect(tintLevel(0.05)).toBeCloseTo(TINT_FLOOR + 0.65 * 0.05, 5);
    expect(tintLevel(0.05)).toBeGreaterThan(TINT_FLOOR);
  });

  it('spans floor..1 across the range', () => {
    expect(tintLevel(0)).toBeCloseTo(TINT_FLOOR, 5);
    expect(tintLevel(1)).toBeCloseTo(1, 5);
    expect(tintLevel(0.5)).toBeCloseTo(TINT_FLOOR + (1 - TINT_FLOOR) / 2, 5);
  });

  it('is monotonic', () => {
    const levels = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1].map(tintLevel);
    const sorted = [...levels].sort((a, b) => a - b);
    expect(levels).toEqual(sorted);
  });

  it('clamps nonsense rather than painting outside the range', () => {
    // HomeKit has handed us out-of-range values before.
    expect(tintLevel(-5)).toBeCloseTo(TINT_FLOOR, 5);
    expect(tintLevel(42)).toBeCloseTo(1, 5);
    expect(tintLevel(Number.NaN)).toBe(1);
  });
});

describe('resolveWidgetTint — the ends reproduce what the two-class swap painted', () => {
  it('paints an off tile slate-100/80 over a light wallpaper', () => {
    const { backgroundColor, level } = resolveWidgetTint(onWhite({ isOn: false }));
    expect(level).toBe(0);
    expect(backgroundColor).toBe(rgbaToCss(OFF_TINT_LIGHT));
  });

  it('paints an off tile black/20 over a dark wallpaper', () => {
    const { backgroundColor } = resolveWidgetTint(onDark({ isOn: false }));
    expect(backgroundColor).toBe(rgbaToCss(OFF_TINT_DARK));
  });

  it('paints a fully-on tile the accent at its full alpha', () => {
    const { backgroundColor, level } = resolveWidgetTint(onWhite({ intensity: 1 }));
    expect(level).toBeCloseTo(1, 5);
    expect(backgroundColor).toBe(`rgba(254, 240, 138, ${TINT_ALPHA})`);
  });

  it('paints a binary accessory identically to a fully-on one', () => {
    // A lock must not change appearance because of this feature.
    expect(resolveWidgetTint(onWhite({ intensity: null })).backgroundColor).toBe(
      resolveWidgetTint(onWhite({ intensity: 1 })).backgroundColor,
    );
  });

  it('falls back to the standard blue when a type has no accent', () => {
    const { backgroundColor } = resolveWidgetTint(onWhite({ tint: null, intensity: 1 }));
    expect(backgroundColor).toBe(`rgba(191, 219, 254, ${TINT_ALPHA})`);
  });

  it('falls back to the standard blue rather than throwing on an unparseable accent', () => {
    const { backgroundColor } = resolveWidgetTint(
      onWhite({ tint: 'not-a-colour', intensity: 1 }),
    );
    expect(backgroundColor).toBe(rgbaToCss({ ...{ r: 191, g: 219, b: 254 }, a: TINT_ALPHA }));
    expect(STANDARD_TINT).toBe('#bfdbfe');
  });
});

describe('resolveWidgetTint — the middle is proportional', () => {
  it('lands a half-open blind between off and fully open', () => {
    const off = resolveWidgetTint(onWhite({ isOn: false }));
    const half = resolveWidgetTint(onWhite({ intensity: 0.5 }));
    const full = resolveWidgetTint(onWhite({ intensity: 1 }));
    expect(half.level).toBeGreaterThan(off.level);
    expect(half.level).toBeLessThan(full.level);
    expect(half.backgroundColor).not.toBe(off.backgroundColor);
    expect(half.backgroundColor).not.toBe(full.backgroundColor);
  });

  it('never emits a Tailwind class — the fill has to survive purging', () => {
    // The bug this guards: `bg-yellow-200/${pct}` is not in the content scan,
    // so it is purged and the tile renders untinted.
    for (const i of [0, 0.3, 0.7, 1]) {
      expect(resolveWidgetTint(onWhite({ intensity: i })).backgroundColor).toMatch(
        /^rgba\(\d+, \d+, \d+, [\d.]+\)$/,
      );
    }
  });

  it('moves alpha monotonically toward the accent as the accessory opens', () => {
    // Direction differs by wallpaper and that is not a bug: the off fill is
    // slate-100 at .80 over a light one but black at .20 over a dark one,
    // while the accent is .75 either way. So opening a tile *lowers* alpha on
    // a light wallpaper and raises it on a dark one. Both must be monotonic.
    const alphaAt = (input: TintInput) =>
      Number(/,\s*([\d.]+)\)$/.exec(resolveWidgetTint(input).backgroundColor)![1]);
    const steps = [0, 0.25, 0.5, 0.75, 1];

    const light = steps.map(i => alphaAt(onWhite({ intensity: i })));
    expect(light).toEqual([...light].sort((a, b) => b - a));

    const dark = steps.map(i => alphaAt(onDark({ intensity: i })));
    expect(dark).toEqual([...dark].sort((a, b) => a - b));

    expect(alphaAt(onWhite({ intensity: 1 }))).toBeCloseTo(TINT_ALPHA, 3);
    expect(alphaAt(onDark({ intensity: 1 }))).toBeCloseTo(TINT_ALPHA, 3);
  });

  it('does not smear a dimming light through grey over a dark wallpaper', () => {
    // Interpolating channels directly rather than premultiplied would pull the
    // midpoint toward the off fill's black. The mid tint must stay yellow-ish:
    // red and green well ahead of blue.
    const mid = resolveWidgetTint(onDark({ intensity: 0.5 })).backgroundColor;
    const [r, g, b] = /rgba\((\d+), (\d+), (\d+)/.exec(mid)!.slice(1).map(Number);
    expect(r).toBeGreaterThan(b);
    expect(g).toBeGreaterThan(b);
  });

  it('honours a per-entry alpha, for the timer override', () => {
    const { backgroundColor } = resolveWidgetTint(
      onWhite({ tint: '#d1fae5', intensity: 1, alpha: 0.7 }),
    );
    expect(backgroundColor).toBe('rgba(209, 250, 229, 0.7)');
  });
});

describe('resolveWidgetTint — ink', () => {
  it('keeps the four cases the old rule got right', () => {
    // ON pale accent → dark ink, on either wallpaper.
    expect(resolveWidgetTint(onWhite({ intensity: 1 })).tone).toBe('dark');
    expect(resolveWidgetTint(onDark({ intensity: 1 })).tone).toBe('dark');
    // OFF over a light wallpaper → dark ink. OFF over a dark one → white.
    expect(resolveWidgetTint(onWhite({ isOn: false })).tone).toBe('dark');
    expect(resolveWidgetTint(onDark({ isOn: false })).tone).toBe('light');
  });

  it('goes white for a barely-on light over a dark wallpaper', () => {
    // The case the old `!isOn && isDarkBackground` rule got wrong: isOn is
    // true, so it chose dark ink over what is essentially black.
    expect(resolveWidgetTint(onDark({ intensity: 0 })).tone).toBe('light');
  });

  it('crosses over exactly once as a light is dimmed up over a dark wallpaper', () => {
    const tones = Array.from({ length: 41 }, (_, i) =>
      resolveWidgetTint(onDark({ intensity: i / 40 })).tone,
    );
    const flips = tones.filter((t, i) => i > 0 && t !== tones[i - 1]).length;
    expect(flips).toBeLessThanOrEqual(1);
    expect(tones[0]).toBe('light');
    expect(tones[tones.length - 1]).toBe('dark');
  });

  it('assumes the white page when there is no wallpaper to measure', () => {
    const { tone } = resolveWidgetTint(
      onWhite({ isOn: false, wallpaperLuminance: null }),
    );
    expect(tone).toBe('dark');
  });

  it('falls back on the dark flag while an image is still decoding', () => {
    const { tone } = resolveWidgetTint(
      onDark({ isOn: false, wallpaperLuminance: null }),
    );
    expect(tone).toBe('light');
  });
});

describe('resolveWidgetTint — the inset hairline', () => {
  it('shows at full strength on an off tile over a light wallpaper', () => {
    expect(resolveWidgetTint(onWhite({ isOn: false })).ringColor).toBe('rgba(226, 232, 240, 1)');
  });

  it('fades out as the fill comes up, instead of popping at the boundary', () => {
    const alphaOf = (i: number | null, isOn = true) =>
      Number(/,\s*([\d.]+)\)$/.exec(resolveWidgetTint(onWhite({ intensity: i, isOn })).ringColor)![1]);
    expect(alphaOf(null, false)).toBe(1);
    expect(alphaOf(0)).toBeCloseTo(1 - TINT_FLOOR, 5);
    expect(alphaOf(1)).toBeCloseTo(0, 5);
    expect(alphaOf(0.5)).toBeGreaterThan(alphaOf(1));
  });

  it('stays transparent over a dark wallpaper, but stays a colour', () => {
    // It must remain a paintable value: an inset box-shadow cannot animate to
    // `none`, so dropping the ring outright would snap.
    expect(resolveWidgetTint(onDark({ isOn: false })).ringColor).toBe('transparent');
    expect(resolveWidgetTint(onDark({ intensity: 1 })).ringColor).toBe('transparent');
  });
});
