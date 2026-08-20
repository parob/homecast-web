/**
 * The backdrop every overlay puts between itself and the page.
 *
 * There were three different answers to "what is behind this thing" before:
 * `ExpandedOverlay` blurred by 1px over a barely-there dim, while `Sheet` and
 * `Dialog` painted a flat `bg-black/80` and blurred nothing. Opening a widget
 * pushed the wallpaper back; opening the left menu switched it off. Same app,
 * same gesture, two different rooms.
 *
 * One blur, one dim, named once. The dim adapts because a 25% wash reads as
 * heavy over a pale wallpaper and as nothing over a dark one; the blur never
 * changes, which is what actually makes the surfaces feel like one system.
 */

/**
 * The shared blur. Every scrim in the app uses exactly this.
 *
 * 2px. A heavy blur reads as a modal takeover, which is right for almost
 * nothing here: these sit over a photo wallpaper, and the job is to push it
 * back a step behind a menu you opened to pick "Rename" — not to replace it.
 * 12px turned the wallpaper to soup and 4px was still too much; this is one
 * notch above the 1px the widget overlay used before any of this.
 */
export const OVERLAY_SCRIM_BLUR = 'backdrop-blur-[2px]';

/**
 * Full scrim classes.
 *
 * @param isDarkBackground the wallpaper is dark enough that a black wash is
 *   nearly invisible against it, so the dim goes up rather than down.
 */
export function overlayScrim(isDarkBackground?: boolean): string {
  return `${OVERLAY_SCRIM_BLUR} ${isDarkBackground ? 'bg-black/40' : 'bg-black/20'}`;
}

/**
 * The scrim for surfaces that cannot reach `BackgroundContext` — the `ui/`
 * primitives, which are shared with the marketing pages and the cloud UI.
 * Sits between the two adaptive values so it is never badly wrong either way.
 */
export const OVERLAY_SCRIM = `${OVERLAY_SCRIM_BLUR} bg-black/30`;

/**
 * Corner rounding used only when the trigger's own could not be read.
 *
 * Every real caller passes the measured radius; this is the jsdom/oddity
 * fallback, and it is a squircle rather than a circle because squaring a round
 * hole off is the more visible of the two mistakes.
 */
export const SCRIM_HOLE_RADIUS = 11;

/**
 * A `clip-path` covering a scrim except for the trigger's own footprint.
 *
 * **Every coordinate here is in the scrim's own border box, not the viewport.**
 * They are the same thing for a `fixed inset-0` scrim and emphatically not for
 * `.fixed-full-screen`, which is inset by `-safe-area-top`/`-left` and is
 * larger than the viewport so it can reach behind the notch. Passing viewport
 * numbers there put the hole a notch-height away from the trigger and left an
 * unpainted strip along the bottom of the screen — which, being unpainted, also
 * let taps through. Measure the scrim and subtract its origin.
 *
 * This is how the trigger of an open menu stays lit. Raising it over the scrim
 * cannot work: `AppHeader` and the tab bar are `fixed z-[10001]`, a dnd-kit
 * drag transform and a `backdrop-filter` glass tile each open a stacking
 * context, and nothing inside one paints above something outside it whatever
 * z-index it carries. So nothing is reordered — the scrim simply never paints
 * over that patch, and since `backdrop-filter` only applies where an element
 * paints, the hole has no blur either.
 *
 * The hole is the trigger's box exactly, `radius` and all. It used to be 5px
 * larger on every side with a fixed 11px rounding, which around the header's
 * 40px `rounded-full` ⋮ drew a 50px squircle: a halo of undimmed, still-blurred
 * wallpaper in a visibly different shape from the button sitting in it. Sized
 * to the button, the button's own opaque fill covers the hole and there is no
 * halo left to be the wrong shape.
 *
 * Returns undefined for a rect with no area, so a caller with nothing to
 * measure renders an uncut scrim rather than an empty clip that hides it.
 */
export function scrimCutout(
  scrimWidth: number,
  scrimHeight: number,
  rect: { left: number; top: number; width: number; height: number } | null | undefined,
  /**
   * The trigger's own corner radius in px, already resolved from any
   * percentage. Clamped here the way CSS clamps it, so the 9999px that
   * `rounded-full` computes to arrives as "circle" rather than as nonsense.
   */
  radius?: number,
): string | undefined {
  if (!rect || rect.width <= 0 || rect.height <= 0) return undefined;

  const x = rect.left;
  const y = rect.top;
  const w = rect.width;
  const h = rect.height;
  const r = radius === undefined || !Number.isFinite(radius) ? SCRIM_HOLE_RADIUS : radius;
  const a = Math.max(0, Math.min(r, w / 2, h / 2));

  const outer = `M0,0 H${scrimWidth} V${scrimHeight} H0 Z`;
  const inner = [
    `M${x + a},${y}`,
    `H${x + w - a}`, `A${a},${a} 0 0 1 ${x + w},${y + a}`,
    `V${y + h - a}`, `A${a},${a} 0 0 1 ${x + w - a},${y + h}`,
    `H${x + a}`, `A${a},${a} 0 0 1 ${x},${y + h - a}`,
    `V${y + a}`, `A${a},${a} 0 0 1 ${x + a},${y}`, 'Z',
  ].join(' ');

  // Even-odd is what makes the second ring a hole rather than more coverage.
  return `path(evenodd, "${outer} ${inner}")`;
}
