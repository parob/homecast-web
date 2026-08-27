/**
 * Hold one element still while the page grows underneath it.
 *
 * Revealing hidden items grows the page, and on the home view every room is its
 * own grid — so a room *above* the tile you are pressing getting taller moves
 * that tile out from under your finger. Measured at 127px, one full row, on a
 * 428pt phone.
 *
 * The growth is cancelled by scrolling the same distance, so nothing moves on
 * screen. **This is only safe before the drag starts.** dnd-kit watches its
 * scrollable ancestors and treats a scroll as the content having moved, so the
 * same correction applied mid-drag is counted twice and puts the drop out by
 * exactly the amount it just corrected — a 127px error that is invisible
 * instead of visible, which is worse. Run before the sensor fires there is
 * nothing to miscount: dnd-kit measures once, afterwards, on a settled page.
 *
 * See `LIFT_REVEAL_DELAY` for the ordering this depends on.
 */

/** What an anchored element looked like on the last frame. */
export interface AnchorSample {
  /** The anchor's viewport-relative top. */
  top: number;
  /** Its scroller's offset at the same moment. */
  scrollTop: number;
}

/**
 * How far the anchor moved for reasons other than scrolling — i.e. how much
 * content appeared above it.
 *
 * Scrolling down by 10 moves everything up by 10, so a pure scroll cancels to
 * zero and only real growth survives. That is what keeps a correction from
 * chasing its own tail, and what would let this coexist with a scroll it did
 * not cause.
 */
export function unexplainedShift(before: AnchorSample, after: AnchorSample): number {
  const movedBy = after.top - before.top;
  const explainedByScrolling = -(after.scrollTop - before.scrollTop);
  return movedBy - explainedByScrolling;
}

/** Sub-pixel noise from rounding, not something worth correcting. */
const DEAD_ZONE_PX = 0.5;

/** The scroller an element actually lives in, or null for the document. */
function scrollParentOf(el: Element): HTMLElement | null {
  let node = el.parentElement;
  while (node) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  // The native app wraps the page in its own `overflow-y-auto` div; a browser
  // scrolls the document. Null means the latter.
  return null;
}

function readScrollTop(scroller: HTMLElement | null): number {
  return scroller ? scroller.scrollTop : (window.scrollY || document.documentElement.scrollTop || 0);
}

function scrollBy(scroller: HTMLElement | null, delta: number): void {
  if (scroller) scroller.scrollTop += delta;
  // `scrollBy` rather than assigning: the document's scrolling element differs
  // between standards and quirks mode, and this needs neither to be right.
  else window.scrollBy(0, delta);
}

/**
 * Keep `anchor` where it is until the returned function is called.
 *
 * Runs per frame — one `getBoundingClientRect` each — rather than on a timer,
 * because the tiles being revealed are real widgets that render asynchronously
 * and there is no moment after which the page is known to have settled. It is
 * alive only for the gap between the reveal and the drag starting, so this is a
 * handful of frames, not the length of a gesture.
 */
export function holdScrollAnchor(anchor: HTMLElement): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {};

  const scroller = scrollParentOf(anchor);
  let last: AnchorSample = {
    top: anchor.getBoundingClientRect().top,
    scrollTop: readScrollTop(scroller),
  };
  let frame = 0;
  let stopped = false;

  const tick = () => {
    if (stopped) return;
    // A detached anchor cannot be measured; the element is re-created whenever
    // the reveal re-renders its grid, and a stale node reads as a wild shift.
    if (anchor.isConnected) {
      const now: AnchorSample = {
        top: anchor.getBoundingClientRect().top,
        scrollTop: readScrollTop(scroller),
      };
      const drift = unexplainedShift(last, now);
      if (Math.abs(drift) >= DEAD_ZONE_PX) {
        scrollBy(scroller, drift);
        // Re-read rather than assuming the scroll landed: it clamps at the ends
        // of the range, and a correction that silently failed must not be
        // recorded as one that worked.
        last = { top: anchor.getBoundingClientRect().top, scrollTop: readScrollTop(scroller) };
      } else {
        last = now;
      }
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };
}
