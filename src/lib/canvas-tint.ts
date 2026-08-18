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
  luminanceToHex,
} from './colorUtils';
import type { BackgroundSettings } from './graphql/types';

/** The theme's own background, for when there is no wallpaper to match. */
export const THEME_CANVAS = 'hsl(var(--background))';

export interface CanvasTintInput {
  /** The wallpaper currently on screen, if any. */
  background: BackgroundSettings | null | undefined;
  /** Colour sampled from the top rows of the image, once it has decoded. */
  sampledTopColor: string | null | undefined;
  /** Whether the wallpaper reads as dark, known before the sample lands. */
  isDark: boolean;
}

/**
 * The colour to paint the canvas behind a given wallpaper.
 *
 * Returns `THEME_CANVAS` when there is no wallpaper — the page really is the
 * theme colour then, and hardcoding a hex would fight a future dark mode.
 */
export function resolveCanvasTint({ background, sampledTopColor, isDark }: CanvasTintInput): string {
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
        ? applyBrightnessToHex(sampledTopColor, brightness)
        : pendingTint(isDark);
    }
    // A preset id we do not recognise: treat it as an image awaiting its sample
    // rather than falling through to the theme colour, which would flash.
    return sampledTopColor ? applyBrightnessToHex(sampledTopColor, brightness) : pendingTint(isDark);
  }

  if (bg.type === 'custom') {
    return sampledTopColor
      ? applyBrightnessToHex(sampledTopColor, brightness)
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
