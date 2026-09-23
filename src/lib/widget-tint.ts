/**
 * How much of a widget's colour to paint, and what ink goes on top of it.
 *
 * A tile used to be painted from one of two Tailwind classes — an off-state
 * grey, or the service type's accent at full strength — chosen by a single
 * boolean. So a light at 5% and a light at 100% looked identical, and a blind
 * cracked an inch looked exactly like one thrown wide open. The tint now tracks
 * how far on the accessory actually is.
 *
 * Two things follow from that, and both live here:
 *
 * 1. **The fill can no longer be a class.** `tailwind.config.ts` has no
 *    `safelist`, so a generated `bg-yellow-200/${pct}` is purged at build time
 *    and the tile renders untinted. The fill is computed as a concrete `rgba()`
 *    and applied inline.
 *
 * 2. **The ink can no longer be a constant.** The old rule was "an ON tile
 *    takes a pale accent fill and needs dark ink; only an OFF tile over a dark
 *    wallpaper goes white". A light at 15% over a dark photograph breaks that —
 *    it is a nearly-transparent wash over black, and dark ink on it is
 *    unreadable — so the ink is derived from the fill that actually lands.
 *
 * A leaf on purpose: no React, no DOM, no `window`. The caller applies the
 * result. That is what makes the awkward cases — a wallpaper still decoding, a
 * bulb that cannot dim, an accessory with no notion of "half on" — testable
 * without a browser.
 */

import { getLuminance, parseColor } from './colorUtils';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0-1. */
  a: number;
}

/**
 * The alpha an accent is painted at when the accessory is fully on. This was
 * the `/75` in every `bg-yellow-200/75`, and it is shared rather than
 * per-entry because every service type used the same value.
 */
export const TINT_ALPHA = 0.75;

/** slate-100/80 — what an off tile showed over a light wallpaper. */
export const OFF_TINT_LIGHT: Rgba = { r: 241, g: 245, b: 249, a: 0.8 };

/** black/20 — what an off tile showed over a dark one. */
export const OFF_TINT_DARK: Rgba = { r: 0, g: 0, b: 0, a: 0.2 };

/** blue-200. `iconStyle: 'standard'` paints every service type this colour. */
export const STANDARD_TINT = '#bfdbfe';

/** slate-200 — the inset hairline an off tile carries over a light wallpaper. */
export const OFF_RING: Rgba = { r: 226, g: 232, b: 240, a: 1 };

/**
 * The floor the proportion is mapped onto.
 *
 * True proportion would be prettier, but a tile's first job is to answer "is it
 * on?" at a glance, and a light at 5% rendered at 5% opacity is
 * indistinguishable from one that is off. So an accessory that is on at all
 * starts at `TINT_FLOOR` and the proportion modulates above it — 0.05 lands at
 * ~0.37, 0.5 at ~0.68, 1.0 at 1.0. Off is still 0, and stays visibly distinct.
 *
 * Tunable in one place on purpose; this number is a judgement, not a fact.
 */
export const TINT_FLOOR = 0.35;

/**
 * A wallpaper's luminance is unknown while its image decodes, and absent
 * entirely when there is no wallpaper. These stand in — the page's own
 * background is white (`--background` is `0 0% 100%`), and a dark wallpaper is
 * assumed near-black rather than mid-grey so the ink does not dither.
 */
const ASSUMED_LUMINANCE_LIGHT = 1;
const ASSUMED_LUMINANCE_DARK = 0.05;

/**
 * The luminance at which white and black ink contrast equally against the same
 * backdrop, by WCAG 2.0: solving 1.05/(L+0.05) = (L+0.05)/0.05 gives
 * L = sqrt(0.0525) - 0.05. Below it white wins, above it black does.
 *
 * This is independent of the wallpaper's mood threshold: a translucent tile
 * on a mid-grey wallpaper needs dark ink even if the page is styled as dark.
 */
const INK_CROSSOVER = Math.sqrt(0.0525) - 0.05;

/** White or black ink. */
type Tone = 'light' | 'dark';

/**
 * CSS blends sRGB channels, not their linear luminances. The wallpaper exposes
 * an average luminance, so reconstruct an equivalent neutral sRGB backdrop.
 * This is exact for flat greys and an estimate for coloured/spatial images.
 */
function compositeSurface(fill: Rgba, backdrop: number, rgb?: readonly number[] | null): number[] {
  const l = Math.max(0, Math.min(1, backdrop));
  const grey = 255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055);
  return [fill.r, fill.g, fill.b].map((c, i) => c * fill.a + (rgb?.[i] ?? grey) * (1 - fill.a));
}

function surfaceLuminance(rgb: number[]): number {
  return getLuminance(rgb[0], rgb[1], rgb[2]);
}

/** Keep secondary text subdued only while it remains readable on the glass. */
function secondaryInk(channel: number, surface: number[]): string {
  const backdrop = surfaceLuminance(surface);
  const contrast = (alpha: number) => {
    const ink = surfaceLuminance(surface.map(c => channel * alpha + c * (1 - alpha)));
    return (Math.max(ink, backdrop) + 0.05) / (Math.min(ink, backdrop) + 0.05);
  };
  // Leave headroom for texture and the difference between a label and tile average.
  const targetContrast = 5.5;
  let low = channel === 255 ? 0.7 : 0.55;
  let high = 1;
  if (contrast(low) < targetContrast) {
    for (let i = 0; i < 10; i++) {
      const mid = (low + high) / 2;
      if (contrast(mid) < targetContrast) low = mid;
      else high = mid;
    }
    low = Math.ceil(high * 1000) / 1000;
  }
  return rgbaToCss({ r: channel, g: channel, b: channel, a: low });
}

/**
 * Normalise a characteristic reading into the 0-1 an accessory's tint needs.
 *
 * Returns `null` — meaning "no proportion, paint at full strength" — when the
 * characteristic is absent (a bulb that cannot dim, a fan with no speed
 * control) or its range is unusable. HomeKit's min/max are honoured rather than
 * assuming 0-100: most are, some are not, and a fan reported on 0-7 would
 * otherwise sit permanently at the floor.
 */
export function intensityFrom(
  value: unknown,
  minValue?: number | null,
  maxValue?: number | null,
): number | null {
  if (typeof value !== 'number' || Number.isNaN(value)) return null;
  const min = typeof minValue === 'number' && !Number.isNaN(minValue) ? minValue : 0;
  const max = typeof maxValue === 'number' && !Number.isNaN(maxValue) ? maxValue : 100;
  if (max <= min) return null;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * How far into its range an accessory is, as a fill level.
 *
 * `null` means the accessory has no notion of "partly on" — a lock, a switch, a
 * bulb that cannot dim — and paints at full strength, exactly as it did before
 * any of this existed.
 */
export function tintLevel(intensity: number | null | undefined): number {
  if (intensity == null || Number.isNaN(intensity)) return 1;
  const clamped = Math.max(0, Math.min(1, intensity));
  return TINT_FLOOR + (1 - TINT_FLOOR) * clamped;
}

/**
 * Blend two translucent fills.
 *
 * Interpolating the channels directly would darken the midpoint whenever the
 * two ends differ in alpha — the off fill over a dark wallpaper is black at
 * 0.2, so a light coming on would smear through grey on its way to yellow.
 * Premultiplying first is what keeps the ramp clean.
 */
function mixPremultiplied(from: Rgba, to: Rgba, t: number): Rgba {
  const a = from.a + (to.a - from.a) * t;
  if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
  const channel = (f: number, o: number) => {
    const premul = f * from.a + (o * to.a - f * from.a) * t;
    return Math.round(premul / a);
  };
  return {
    r: channel(from.r, to.r),
    g: channel(from.g, to.g),
    b: channel(from.b, to.b),
    a,
  };
}

export function rgbaToCss({ r, g, b, a }: Rgba): string {
  return `rgba(${r}, ${g}, ${b}, ${Number(a.toFixed(3))})`;
}

export interface TintInput {
  /** The service type's accent hex, or null/undefined to fall back to the standard blue. */
  tint: string | null | undefined;
  /** How far on, 0-1. `null` for an accessory with no proportion. */
  intensity: number | null | undefined;
  /** Whether the accessory is on at all. */
  isOn: boolean;
  /** Whether the wallpaper behind the tile reads as dark. */
  isDarkWallpaper: boolean;
  /** The wallpaper's luminance 0-1, or null while it is unknown. */
  wallpaperLuminance: number | null | undefined;
  /** Local sampled image colour when available; includes brightness adjustment. */
  wallpaperRgb?: readonly number[] | null;
  /** The alpha this accent paints at when full. Defaults to {@link TINT_ALPHA}. */
  alpha?: number;
}

export interface TintResult {
  /** The glass layer's fill. */
  backgroundColor: string;
  /** Which ink the content needs: 'light' is white, 'dark' is the usual slate. */
  tone: Tone;
  foregroundColor: string;
  secondaryColor: string;
  /** The inset hairline's colour, faded out as the fill comes up. */
  ringColor: string;
  /** The resolved fill level, 0-1. Exposed for tests and callers that animate. */
  level: number;
}

/**
 * Resolve everything a tile needs to paint itself at a given intensity.
 *
 * The fill and ring retain the wallpaper's appearance; text follows the
 * estimated painted surface at every level, including off.
 */
export function resolveWidgetTint({
  tint,
  intensity,
  isOn,
  isDarkWallpaper,
  wallpaperLuminance,
  wallpaperRgb,
  alpha = TINT_ALPHA,
}: TintInput): TintResult {
  const off = isDarkWallpaper ? OFF_TINT_DARK : OFF_TINT_LIGHT;
  const accentRgb = parseColor(tint || STANDARD_TINT) ?? parseColor(STANDARD_TINT)!;
  const on: Rgba = { ...accentRgb, a: alpha };

  const level = isOn ? tintLevel(intensity) : 0;
  const fill = mixPremultiplied(off, on, level);

  // Composite the fill over the wallpaper to find what the ink actually sits
  // on. The tile is backdrop-blurred, so the wallpaper's average luminance is
  // the best read available on its backdrop — and it is already computed for
  // the wallpaper's own sake.
  const backdrop =
    wallpaperLuminance ??
    (isDarkWallpaper ? ASSUMED_LUMINANCE_DARK : ASSUMED_LUMINANCE_LIGHT);

  const surface = compositeSurface(fill, backdrop, wallpaperRgb);
  const tone: Tone = surfaceLuminance(surface) < INK_CROSSOVER ? 'light' : 'dark';
  const channel = tone === 'light' ? 255 : 0;

  // The ring marks an off tile's edge. Dropping it at the on/off boundary made
  // it pop, so it fades out as the fill comes up. Over a dark wallpaper it was
  // always transparent and stays that way — the class has to stay applied
  // either way, because an inset box-shadow cannot interpolate to `none`.
  const ringColor = isDarkWallpaper
    ? 'transparent'
    : rgbaToCss({ ...OFF_RING, a: 1 - level });

  return {
    backgroundColor: rgbaToCss(fill),
    tone,
    foregroundColor: rgbaToCss({ r: channel, g: channel, b: channel, a: 1 }),
    secondaryColor: secondaryInk(channel, surface),
    ringColor,
    level,
  };
}
