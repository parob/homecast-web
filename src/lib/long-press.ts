/**
 * The hold that enters Edit Layout.
 *
 * On touch, a long press is the way into arranging: hold a tile and it lifts
 * with the mode, hold the page behind it and the mode comes on with nothing
 * picked up. Two gestures, one duration — so the numbers live here rather than
 * beside either of them, and the page can never resolve at a different moment
 * from the tiles on it.
 *
 * The tile half is dnd-kit's `TouchSensor`, which already knows how to wait and
 * how to give up. This module is for the other half: the decisions the
 * background handler needs, kept pure and unit-tested, with the listeners in
 * `hooks/useBackgroundLongPress.ts`. Same split as `swipe.ts`, for the same
 * reason — the interesting part is what counts as a hold, not the plumbing.
 */

/**
 * How long a finger rests before Edit Layout comes on.
 *
 * Deliberate rather than quick: this *enters a mode*, and a thumb parked on a
 * tile while reading must never do it by accident. Matched to iOS, where the
 * same gesture has meant the same thing for fifteen years.
 */
export const LIFT_DELAY_IDLE = 500;

/**
 * …and once the mode is already running, where the hold only picks something
 * up. Waiting half a second for every one of those is tedious, and there is no
 * mode left to enter by mistake.
 */
export const LIFT_DELAY_EDITING = 250;

/**
 * Travel that turns a hold into a scroll.
 *
 * Looser than the sensor's 5px on purpose. A tile has a rect to sort against,
 * so a few pixels of drift are meaningful there; the background has nothing to
 * aim at, and a hold that wanders 8px is still plainly a hold.
 */
export const LIFT_SLOP = 10;

/**
 * Things that own the press themselves, and so are never "the background".
 *
 * `data-draggable-item` is on every `SortableItem`, `data-sortable-id` on the
 * sidebar rows and `data-tab-slot` on the tab bar — those all have a lift of
 * their own via dnd-kit, and firing this as well would enter the mode twice.
 * The controls are here because a press on a switch or a slider is aimed at the
 * control, however long it lasts.
 */
export const LIFT_OPT_OUT = [
  '[data-draggable-item]',
  '[data-sortable-id]',
  '[data-tab-slot]',
  'button',
  'a',
  'input',
  'select',
  'textarea',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="switch"]',
  '[role="slider"]',
  '[data-no-lift]',
].join(', ');

/**
 * Is this press on the page itself, rather than on something that lives on it?
 *
 * Answered by walking up from the target, so a press on the label inside a tile
 * is still a press on the tile. A non-element target (a text node, nothing at
 * all) is treated as background: it can only be the page, since anything with a
 * gesture of its own is an element.
 */
export function isBackgroundTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  return !target.closest(LIFT_OPT_OUT);
}

/** Has the finger travelled far enough that it is scrolling, not holding? */
export function exceededSlop(dx: number, dy: number, slop: number = LIFT_SLOP): boolean {
  return Math.abs(dx) > slop || Math.abs(dy) > slop;
}

/**
 * The tolerance dnd-kit's `TouchSensor` is configured with. Past this it
 * abandons the hold, so anything keyed to that hold has to abandon with it.
 */
export const LIFT_SENSOR_TOLERANCE = 5;

/**
 * Things that carry a lift of their own, and so are what this module's early
 * reveal watches for. The inverse of the tail of {@link LIFT_OPT_OUT}: those are
 * excluded from the *background* hold precisely because they have their own.
 */
export const LIFT_DRAGGABLE = '[data-draggable-item], [data-sortable-id], [data-tab-slot]';

/**
 * When hidden items are revealed, measured from the finger going down.
 *
 * **This has to be before the drag activates, and that ordering is the whole
 * point.** Revealing grows the page — on the home view every room is its own
 * grid, so a room above the drag getting taller moves everything below it, 127px
 * on a 428pt phone. Do that *after* dnd-kit has measured and nothing can be
 * done about it: it takes the active item's rect once at drag start and derives
 * everything after from that plus the pointer delta, so a page that moves takes
 * the drag's frame of reference with it.
 *
 * Two fixes were driven and neither worked. Re-measuring only corrects the
 * targets, never the active rect. Cancelling the growth by scrolling the same
 * distance holds the page still to the eye, but dnd-kit watches its scrollable
 * ancestors and counts that scroll as the content having moved — trading a
 * visible 127px error for an invisible one.
 *
 * So the growth happens *first* instead, in the gap between the finger settling
 * and the sensor firing, and dnd-kit measures a page that has already finished
 * moving. Nothing to compensate, nothing to miscount.
 *
 * {@link LIFT_DELAY_IDLE} minus this is the settling budget — the revealed
 * tiles are real widgets and render asynchronously, so the gap has to be big
 * enough for them to land, and small enough that a hold this long is already
 * plainly a hold rather than a tap.
 */
export const LIFT_REVEAL_DELAY = 250;
