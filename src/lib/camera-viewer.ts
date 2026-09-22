/**
 * When the expanded camera viewer puts its chrome ON the image rather than
 * above and below it.
 *
 * Stacked, the card spends a header (~90px) and an action row (~44px) before
 * the image gets anything. That is most of a phone held sideways: at 956x440
 * the image was left 119px of height, and since it takes its width from that
 * height it came out 212px wide — a stamp. Laid over the image instead, the
 * same card gives the image everything it has.
 *
 * Portrait phones and desktops keep the stacked card: they have the height to
 * spend, and chrome over the image is worse when it does not have to be there.
 */
export const IMMERSIVE_MAX_VIEWPORT_HEIGHT = 500;

export function prefersImmersiveCamera(viewport: { width: number; height: number }): boolean {
  // Wider than tall AND genuinely short. A narrow-but-short window (a very
  // squat portrait) has no width to spend either, so overlaying the chrome
  // would cost legibility and buy nothing.
  return viewport.height > 0
    && viewport.height <= IMMERSIVE_MAX_VIEWPORT_HEIGHT
    && viewport.width > viewport.height;
}
