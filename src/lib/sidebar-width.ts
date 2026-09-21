/**
 * How wide the dashboard's navigation panel is at a given window width.
 *
 * It holds names — rooms, room groups, collections — and it used to be a flat
 * 248px at every window size, so "Downstairs Bathroom" truncated on a 27"
 * display with several hundred unused pixels beside it
 * (parob/homecast-cloud#157).
 *
 * The shape is: flat up to `SIDEBAR_GROW_FROM`, because below that the grid
 * cannot spare the width; then linear; then flat again at `SIDEBAR_MAX`,
 * because a navigation panel that keeps pace with a 4K monitor stops reading
 * as chrome and starts reading as a column.
 *
 * Lives here, pure, for two reasons: the curve is arithmetic worth testing
 * without a browser, and the CSS the panel actually uses is generated from the
 * same four numbers as the arithmetic, so the two cannot drift apart.
 */

/** Below this window width nothing changes — the width every install had. */
export const SIDEBAR_MIN = 248;
/**
 * The ceiling, reached at `SIDEBAR_GROW_TO` and held past it.
 *
 * Chosen by measuring rather than by taste: a row spends about 125px of the
 * panel on the inset, the padding, the icon and the trailing control, so the
 * name gets the rest. At 320px a 22-character room name was still seven pixels
 * short of fitting, which is a poor place to stop. 360 gives the name ~235px
 * and clears the names in the report with room to spare.
 */
export const SIDEBAR_MAX = 360;
/** Where growth starts. A hair under a 1280px window's content area. */
export const SIDEBAR_GROW_FROM = 1280;
/** Where growth stops. */
export const SIDEBAR_GROW_TO = 1920;

/** Extra panel width per extra pixel of window, between the two thresholds. */
export const SIDEBAR_GROW_RATE = +(
  (SIDEBAR_MAX - SIDEBAR_MIN) / (SIDEBAR_GROW_TO - SIDEBAR_GROW_FROM)
).toFixed(4);

/**
 * The width, in px, at a given window width.
 *
 * `extra` is added at both ends of the range rather than to the result, so
 * edit mode widens the panel by exactly that much at every window width
 * instead of being swallowed by the ceiling on a wide screen.
 */
export function sidebarWidthAt(viewportWidth: number, extra = 0): number {
  const grown = SIDEBAR_MIN + extra + (viewportWidth - SIDEBAR_GROW_FROM) * SIDEBAR_GROW_RATE;
  return Math.min(SIDEBAR_MAX + extra, Math.max(SIDEBAR_MIN + extra, grown));
}

/**
 * The same curve as a CSS length.
 *
 * A `clamp()` rather than a resize listener: it tracks a window being dragged
 * frame by frame, with no measurement pass and no re-render. `100vw` counts
 * the scrollbar, which the content box does not — worth about two pixels of
 * panel at this rate, and not worth a container query to avoid.
 */
export function sidebarWidthCss(extra = 0): string {
  const lo = SIDEBAR_MIN + extra;
  const hi = SIDEBAR_MAX + extra;
  return `clamp(${lo}px, calc(${lo}px + (100vw - ${SIDEBAR_GROW_FROM}px) * ${SIDEBAR_GROW_RATE}), ${hi}px)`;
}
