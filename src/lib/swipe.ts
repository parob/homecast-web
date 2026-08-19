/**
 * The gestures that open and close a left menu.
 *
 * Two halves of one interaction: a drag in from the screen's left edge opens
 * the menu, and a drag back out of the open panel closes it. The maths is here
 * — pure, and unit-tested — because the interesting part is not the listeners
 * but the decisions: when a movement stops being a scroll and becomes a swipe,
 * and how far it has to travel before we act on it. `hooks/useDrawerSwipe.ts`
 * is the thin layer that feeds this real touch events.
 */

/** How far in from the panel's edge a touch may start and still arm an open. */
export const EDGE_ZONE = 24;
/** Horizontal travel that commits an open on its own. */
export const OPEN_TRAVEL = 48;
/** …and a close. Slightly further: closing by accident loses your place. */
export const CLOSE_TRAVEL = 56;
/** Movement before we are willing to call a gesture horizontal or vertical. */
export const AXIS_SLOP = 8;
/** How far horizontal has to beat vertical for the gesture to be a swipe. */
export const AXIS_RATIO = 1.2;
/** px/ms at which a short, fast flick commits without reaching the travel. */
export const FLICK_VELOCITY = 0.45;
/** …but a flick still has to be a movement, not a tap that wobbled. */
export const FLICK_MIN_TRAVEL = 16;

/** Elements that own horizontal drags of their own, and must keep them. */
const SWIPE_OPT_OUT = 'input[type="range"], [role="slider"], [data-no-swipe]';

export type SwipeAxis = 'undecided' | 'horizontal' | 'vertical';

/**
 * Which way a gesture is going, once it has moved far enough to tell.
 *
 * The answer is latched by the caller on first sight: a drawer's contents
 * scroll vertically, so a swipe that starts as a scroll must stay a scroll even
 * if the finger later drifts sideways. Re-deciding every frame would let a
 * long, wandering scroll close the menu underneath it.
 */
export function resolveAxis(dx: number, dy: number, slop: number = AXIS_SLOP): SwipeAxis {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (Math.max(ax, ay) < slop) return 'undecided';
  return ax > ay * AXIS_RATIO ? 'horizontal' : 'vertical';
}

/**
 * Has the gesture gone far enough to act on?
 *
 * `travel` is distance in the gesture's own direction, so both directions read
 * the same way here. Either it covers the ground, or it is a flick — fast
 * enough that the intent is obvious well before the distance is.
 */
export function commitsSwipe({
  travel,
  elapsedMs,
  threshold,
}: {
  travel: number;
  elapsedMs: number;
  threshold: number;
}): boolean {
  if (travel >= threshold) return true;
  if (travel < FLICK_MIN_TRAVEL || elapsedMs <= 0) return false;
  return travel / elapsedMs >= FLICK_VELOCITY;
}

/**
 * Would this scroller have moved instead?
 *
 * `dir` is the direction the *finger* travels: +1 rightwards, -1 leftwards. A
 * finger going right drags content right, which walks `scrollLeft` down — so
 * only a scroller with something still to its left claims that swipe. A
 * scroller already parked at its end has nothing to do with the gesture and
 * lets it through, which is what makes a swipe work from the first screen of a
 * horizontal row.
 */
export function scrollBlocksSwipe(
  dir: 1 | -1,
  metrics: { scrollLeft: number; scrollWidth: number; clientWidth: number },
): boolean {
  const { scrollLeft, scrollWidth, clientWidth } = metrics;
  // 1px of slack: fractional layout widths leave scrollWidth a hair above
  // clientWidth on elements that do not actually scroll.
  if (scrollWidth - clientWidth <= 1) return false;
  return dir > 0 ? scrollLeft > 0 : scrollLeft < scrollWidth - clientWidth - 1;
}

function isHorizontallyScrollable(el: Element): boolean {
  const overflowX = getComputedStyle(el).overflowX;
  return overflowX === 'auto' || overflowX === 'scroll';
}

/**
 * Does anything between `from` and `stopAt` want this swipe more than we do?
 *
 * Walks the ancestor chain looking for a control that drags horizontally
 * (a slider, or anything marked `data-no-swipe`) or a scroller with room to
 * move the way the finger is going.
 */
export function blocksSwipe(
  from: Element | null,
  dir: 1 | -1,
  stopAt?: Element | null,
): boolean {
  let el: Element | null = from;
  while (el && el !== stopAt?.parentElement) {
    if (el.matches?.(SWIPE_OPT_OUT)) return true;
    if (
      isHorizontallyScrollable(el) &&
      scrollBlocksSwipe(dir, {
        scrollLeft: el.scrollLeft,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      })
    ) {
      return true;
    }
    if (el === stopAt) break;
    el = el.parentElement;
  }
  return false;
}

/**
 * Is something layered above the page?
 *
 * The whole-page edge swipe is the bottom of the stack: a dialog covers it, and
 * either has a menu of its own — which scopes its swipe to itself — or has no
 * menu at all, in which case opening the one behind it is never what was meant.
 */
export function hasOpenOverlay(doc: Document = document): boolean {
  return !!doc.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  );
}
