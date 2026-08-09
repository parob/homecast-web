/**
 * Colour temperature, in the two units this app has to keep straight.
 *
 * HomeKit's `color_temperature` is in **mireds** (140–500), where the number
 * RISES as the light gets warmer — the reciprocal of how people talk about it.
 * Sliders were fed the raw mired value, which put cool at the low end and so
 * ran cool→warm left to right, under captions reading "Warm … Cool". The
 * gradient and the words disagreed, and the words were the ones matching Apple
 * Home, where the strip runs warm on the left to cool on the right.
 *
 * So the sliders travel on a mirrored axis: still mireds, still perceptually
 * even to drag (Kelvin is not — the warm end would crawl), but reversed, so
 * moving away from the origin gets cooler. `toMired` converts back before the
 * value is written, and nothing outside a slider ever sees the mirrored number.
 */

/** Mirror a mired value onto the warm→cool axis, and back — the map is its own inverse. */
export function mirrorMired(value: number, min: number, max: number): number {
  return min + max - value;
}

/** What people actually call it. Rounded to 50K: bulbs are not precise, and a jittering final digit reads as noise. */
export function miredToKelvin(mired: number): number {
  if (!mired) return 0;
  return Math.round(1e6 / mired / 50) * 50;
}

/** Label for a slider sitting on the mirrored axis. */
export function formatMirroredAsKelvin(sliderValue: number, min: number, max: number): string {
  return `${miredToKelvin(mirrorMired(sliderValue, min, max))}K`;
}
