/**
 * What colour the page canvas should be painted.
 *
 * The wallpaper is a `position: fixed` layer, so it cannot reach the strip iOS
 * exposes during rubber-band overscroll. Whatever shows there comes from the
 * canvas, and the canvas is white by default — `--background` is `0 0% 100%`
 * and nothing in the app ever applies the `dark` class. Against a dark nature
 * photograph that reads as the wallpaper being clipped.
 *
 * So the canvas is tinted to match the wallpaper. This module is the decision
 * only — a leaf with no React, no DOM and no `window`, so the awkward cases
 * (nothing set yet, an image still being sampled) are testable without a
 * browser. Applying the result is the caller's job.
 *
 * Nothing here may return a hardcoded white. That was the original bug: the
 * no-wallpaper branch returned '#ffffff' outright, and the still-sampling
 * branches returned a flat '#aaaaaa' that flashed pale over a dark photo.
 */

import {
  PRESET_SOLID_COLORS,
  PRESET_GRADIENTS,
  PRESET_IMAGES,
  getDominantColor,
  applyBrightnessToHex,
  lightenHex,
  luminanceToHex,
  setLuminanceHex,
} from './colorUtils';
import type { BackgroundSettings } from './graphql/types';

/** The theme's own background, for when there is no wallpaper to match. */
export const THEME_CANVAS = 'hsl(var(--background))';

/**
 * How far a sampled wallpaper colour is lifted towards white before it is
 * used as the canvas. The sample is an average of the wallpaper's outermost
 * rows, which on a photograph are usually its darkest — the sky's deep edge,
 * the ground's shadow — so taken as-is it read a shade too dark against the
 * wallpaper it borders, at the bars and in the scrims that fade into it.
 */
export const SAMPLED_TINT_LIFT = 0.12;

/**
 * Brightness, as the wallpaper's own overlay applies it, on a 0–1 luminance.
 * The same curve `useBackgroundDarkness` uses, so the target the canvas is
 * matched to is in the same register as the wallpaper that will be on screen.
 */
function withBrightness(luminance: number, brightness: number): number {
  if (brightness < 50) return luminance * (1 - (50 - brightness) / 50);
  if (brightness > 50) return luminance + (1 - luminance) * ((brightness - 50) / 50);
  return luminance;
}

/**
 * What the colour is being asked for, because the two answers differ.
 *
 * `bars` — iOS 26 Safari's glass bars, and the scrims the wallpaper fades into
 * on its way to them. A band the depth of the status bar, sitting beside a
 * whole screen of wallpaper and read as chrome. Both adjustments below exist
 * for it and only for it.
 *
 * `backdrop` — the WKWebView's own background in an app shell, which is seen
 * in one place: the strip the page is pulled away from on a rubber-band
 * overscroll, immediately against the wallpaper's own top rows (and, on
 * iOS 26, what the scroll view's `topEdgeEffect` runs out into). Nothing there
 * reads as chrome and there is nothing to match but that edge, so the sample
 * is used as sampled. Adjusting it for a bar the shell does not have is what
 * put a band four times brighter than the wallpaper it borders on top of the
 * iOS app — parob/homecast-cloud#161.
 */
export type CanvasTintSurface = 'bars' | 'backdrop';

/**
 * A sampled colour, made the canvas.
 *
 * The sample is an average of the wallpaper's outermost rows, and it decides
 * the canvas's HUE. It does not decide its brightness, because those rows are
 * not representative of the picture: on a photograph of a building against the
 * sky the top 5% is sky and nothing else gets a vote, which is how a dark brick
 * facade came to sit between two bright blue bands (parob/homecast-cloud#157 —
 * measured at 1.9× the luminance of the wallpaper they bordered).
 *
 * So the sampled colour is re-exposed at the luminance of the whole wallpaper
 * and keeps its own hue. That is also the only answer that can be fair to BOTH
 * ends: one colour serves the top band and the bottom band, and a wallpaper
 * that runs sky-to-sand has no single edge worth matching.
 *
 * Then the existing lift, unchanged: a band that reads a shade darker than the
 * wallpaper beside it looks like a shadow, so it is nudged towards white last.
 *
 * With no whole-image luminance yet (it lands with the sample, but a caller
 * that tracks neither passes null) this is the old behaviour exactly — the
 * sample's own brightness, lifted.
 *
 * Both of those are for the bars. A `backdrop` gets neither: see
 * `CanvasTintSurface`.
 */
function sampledTint(
  sampled: string,
  brightness: number,
  wallpaperLuminance: number | null | undefined,
  surface: CanvasTintSurface,
): string {
  const adjusted = applyBrightnessToHex(sampled, brightness);
  if (surface === 'backdrop') return adjusted;
  const matched = wallpaperLuminance == null
    ? adjusted
    : setLuminanceHex(adjusted, withBrightness(wallpaperLuminance, brightness));
  return lightenHex(matched, SAMPLED_TINT_LIFT);
}

export interface CanvasTintInput {
  /** The wallpaper currently on screen, if any. */
  background: BackgroundSettings | null | undefined;
  /** Colour sampled from the top rows of the image, once it has decoded. */
  sampledTopColor: string | null | undefined;
  /** Whether the wallpaper reads as dark, known before the sample lands. */
  isDark: boolean;
  /**
   * Relative luminance (0–1) of the wallpaper as a whole, before brightness —
   * `analyzeLoadedImage`'s figure, the one the dark/light decision already
   * runs on. What the sampled edge colour is re-exposed to. Null or absent
   * keeps the pre-#157 behaviour, so a caller that tracks no image is safe.
   */
  wallpaperLuminance?: number | null;
  /**
   * What the colour is for — see `CanvasTintSurface`. Absent means `bars`,
   * which is what every browser caller wants and what this module did before
   * an app shell was told apart from one.
   */
  surface?: CanvasTintSurface;
}

/**
 * The colour to paint the canvas behind a given wallpaper.
 *
 * Returns `THEME_CANVAS` when there is no wallpaper — the page really is the
 * theme colour then, and hardcoding a hex would fight a future dark mode.
 */
export function resolveCanvasTint({ background, sampledTopColor, isDark, wallpaperLuminance, surface = 'bars' }: CanvasTintInput): string {
  const bg = background;
  if (!bg || bg.type === 'none') return THEME_CANVAS;

  const brightness = bg.brightness ?? 50;

  if (bg.type === 'preset' && bg.presetId) {
    // Solid colours and gradients are known up front — no sampling needed.
    if (PRESET_SOLID_COLORS[bg.presetId] || PRESET_GRADIENTS[bg.presetId]) {
      return getDominantColor(bg.presetId, brightness);
    }
    if (PRESET_IMAGES[bg.presetId]) {
      return sampledTopColor
        ? sampledTint(sampledTopColor, brightness, wallpaperLuminance, surface)
        : pendingTint(isDark);
    }
    // A preset id we do not recognise: treat it as an image awaiting its sample
    // rather than falling through to the theme colour, which would flash.
    return sampledTopColor ? sampledTint(sampledTopColor, brightness, wallpaperLuminance, surface) : pendingTint(isDark);
  }

  if (bg.type === 'custom') {
    return sampledTopColor
      ? sampledTint(sampledTopColor, brightness, wallpaperLuminance, surface)
      : pendingTint(isDark);
  }

  return THEME_CANVAS;
}

/**
 * Stand-in while an image is still decoding.
 *
 * Derived from the luminance we already know rather than a flat grey, so the
 * placeholder is in the right register from the first frame and the swap to the
 * sampled colour is not visible.
 */
function pendingTint(isDark: boolean): string {
  return luminanceToHex(isDark ? 0.2 : 0.67);
}
