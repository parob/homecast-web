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
 * 4px, not 12px. A heavy blur reads as a modal takeover, which is right for
 * almost nothing here: most of these overlays sit over a photo wallpaper, and
 * at 12px the wallpaper turned to soup behind a menu you were only using to
 * pick "Rename".
 */
export const OVERLAY_SCRIM_BLUR = 'backdrop-blur-sm';

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
