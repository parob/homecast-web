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
 * This decides the ink for a tile at FULL strength only. It deliberately does
 * not decide it for an off tile — see `resolveWidgetTint`, where using it for
 * both was a real regression.
 */
const INK_CROSSOVER = Math.sqrt(0.0525) - 0.05;

/** White ink or the usual slate. */
type Tone = 'light' | 'dark';

/** A translucent fill's luminance once composited over what sits behind it. */
function compositeLuminance(fill: Rgba, backdrop: number): number {
  return fill.a * getLuminance(fill.r, fill.g, fill.b) + (1 - fill.a) * backdrop;
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
  /** The alpha this accent paints at when full. Defaults to {@link TINT_ALPHA}. */
  alpha?: number;
}

export interface TintResult {
  /** The glass layer's fill. */
  backgroundColor: string;
  /** Which ink the content needs: 'light' is white, 'dark' is the usual slate. */
  tone: Tone;
  /** The inset hairline's colour, faded out as the fill comes up. */
  ringColor: string;
  /** The resolved fill level, 0-1. Exposed for tests and callers that animate. */
  level: number;
}

/**
 * Resolve everything a tile needs to paint itself at a given intensity.
 *
 * At `level` 0 and 1 this reproduces exactly what the old two-class swap
 * produced, so a lock, a switch and a non-dimmable bulb are pixel-identical to
 * before; everything in between is new.
 */
export function resolveWidgetTint({
  tint,
  intensity,
  isOn,
  isDarkWallpaper,
  wallpaperLuminance,
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

  // Ink is decided by interpolating between the two ENDS, not by thresholding
  // the composite luminance against an absolute constant.
  //
  // Thresholding was the obvious approach and it was wrong. This app calls a
  // wallpaper "dark" whenever its luminance is below 0.8 (isDarkLuminance) —
  // a deliberate choice that puts white ink on glass over almost any
  // photograph. WCAG's own crossover is 0.179. An off tile is only 20% black,
  // so its composite is dominated by the wallpaper, and every wallpaper in the
  // band between those two numbers — which is most photographs — flipped from
  // white ink to black. Interpolating the decision instead reproduces the old
  // behaviour at both ends *by construction*, for every wallpaper.
  const offTone: Tone = isDarkWallpaper ? 'light' : 'dark';
  const onLuminance = compositeLuminance({ ...accentRgb, a: alpha }, backdrop);
  const onTone: Tone = onLuminance < INK_CROSSOVER ? 'light' : 'dark';

  let tone: Tone;
  if (offTone === onTone) {
    // Nothing to interpolate — over a light wallpaper both ends are dark ink,
    // so the tile never flips however far it opens.
    tone = offTone;
  } else {
    // The ends disagree, so the ink turns over somewhere along the ramp. Take
    // the midpoint of the two composite luminances: it lands where the fill has
    // taken over from the wallpaper, and it cannot drift off either end.
    const offLuminance = compositeLuminance(off, backdrop);
    const midpoint = (offLuminance + onLuminance) / 2;
    tone = compositeLuminance(fill, backdrop) < midpoint ? offTone : onTone;
  }

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
    ringColor,
    level,
  };
}
