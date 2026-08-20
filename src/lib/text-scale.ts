/**
 * Text size: a type-only scale.
 *
 * The setting used to be the root font size — 16 / 18 / 20px. Every rem in the
 * app is measured from that, so picking "Small" shrank control heights, the tab
 * bar, icons, padding and gaps along with the words. The setting reads as "make
 * the text smaller"; it was making the whole interface smaller.
 *
 * So the root font size is now fixed at {@link TEXT_SCALE_BASE_PX} — the rung
 * the default (large) already sat on, so nothing moves for the people who never
 * touched the setting — and the setting drives the `--text-scale` custom
 * property instead. Only Tailwind's `text-*` tokens and the inherited `body`
 * size multiply by it (tailwind.config.ts, index.css). Everything sized in rem
 * is deliberately left out.
 *
 * The scales are each rung over the base, so type still renders at exactly the
 * size it did: `text-sm` at small is 0.875rem × 20px × 0.8 = the same 14px it
 * was at a 16px root.
 */

export type TextSize = 'small' | 'medium' | 'large';

/** The fixed root font size. Chrome is built in rem off this and never moves. */
export const TEXT_SCALE_BASE_PX = 20;

/** What each rung multiplies type by. Was 16 / 18 / 20px of root font size. */
export const TEXT_SCALES: Record<TextSize, number> = {
  small: 0.8,
  medium: 0.9,
  large: 1,
};

/**
 * What a `1rem` font is worth in px right now, for the handful of places that
 * have to size type in a canvas rather than in CSS (charts). Reads the live
 * values so it stays right if the base ever moves, and falls back to the
 * browser default before the app has applied anything.
 */
export function textScalePx(): number {
  if (typeof document === 'undefined') return TEXT_SCALE_BASE_PX;
  const style = getComputedStyle(document.documentElement);
  const root = parseFloat(style.fontSize) || 16;
  const scale = parseFloat(style.getPropertyValue('--text-scale')) || 1;
  return root * scale;
}
