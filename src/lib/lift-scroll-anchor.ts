/**
 * Hold one element still while the page grows underneath it.
 *
 * Revealing hidden items grows the page, and on the home view every room is its
 * own grid — so a room *above* the tile you are pressing getting taller moves
 * that tile out from under your finger. Measured at 127px, one full row, on a
 * 428pt phone.
 *
 * The growth is cancelled by scrolling the same distance, so nothing moves on
 * screen. **On the lift path this is only safe before the drag starts.** dnd-kit
 * watches its scrollable ancestors and treats a scroll as the content having
 * moved, so the same correction applied mid-drag is counted twice and puts the
 * drop out by exactly the amount it just corrected — a 127px error that is
 * invisible instead of visible, which is worse. Run before the sensor fires
 * there is nothing to miscount: dnd-kit measures once, afterwards, on a settled
 * page.
 *
 * See `LIFT_REVEAL_DELAY` for the ordering this depends on.
 *
 * The same machinery holds your PLACE, not a tile, across entering and leaving
 * Edit Layout — where the anchor is not a pressed element but whatever is at
 * the top of the screen, and there is no drag to keep out of the way of. That
 * is what `pickPageAnchor` is for. Both paths want the same thing: the page
 * gets taller or shorter above you, and nothing you can see moves.
 *
 * Chrome and Firefox do this themselves and call it scroll anchoring. Safari
 * has never implemented it, and Safari is what an iPhone runs.
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
  //
  // `instant`, and not by omission. `scroll-behavior: smooth` is set on `html`
  // and a two-argument `scrollBy` inherits it, so every correction here was
  // being *animated* — a compensating scroll easing into place over 300ms while
  // the thing it is compensating for has already moved. It converged in the end
  // because the next frame re-measures, but it converged by chasing.
  else window.scrollBy({ top: delta, behavior: 'instant' as ScrollBehavior });
}

/** Where the scroller's own viewport starts, in the coordinates a rect uses. */
function viewportTopOf(scroller: HTMLElement | null): number {
  return scroller ? scroller.getBoundingClientRect().top : 0;
}

/**
 * What can be held onto when the anchor is not a pressed tile: a room, or one
 * tile inside it.
 *
 * Both, rather than rooms alone, because the change is usually inside a room —
 * revealed tiles land at the end of that room's grid. Holding the room would
 * hold a top edge that never moved and correct nothing; holding the tile at the
 * top of the screen holds what you are actually looking at.
 */
export const PAGE_ANCHOR_SELECTOR = '[data-room-container], [data-draggable-item]';

/** One measured candidate. Split from the DOM so the choice can be tested. */
export interface AnchorCandidate<T> {
  el: T;
  top: number;
  bottom: number;
  /** False for anything that may not survive the change — see `pickPageAnchor`. */
  usable: boolean;
}

/**
 * The topmost candidate still on screen.
 *
 * "Still on screen" is `bottom > viewportTop`: something scrolled entirely past
 * is no use, because holding it still would hold a point nobody can see — and
 * would leave every change between it and the top edge uncorrected.
 */
export function pickAnchor<T>(
  candidates: Array<AnchorCandidate<T>>,
  viewportTop: number,
): AnchorCandidate<T> | null {
  let best: AnchorCandidate<T> | null = null;
  for (const c of candidates) {
    if (!c.usable || c.bottom <= viewportTop) continue;
    if (!best || c.top < best.top) best = c;
  }
  return best;
}

/**
 * Whether a change sits entirely above the anchor — above everything on screen.
 *
 * Document order rather than geometry, because this is decided across a layout
 * change and rects from either side of one do not share coordinates. A
 * container the anchor is INSIDE does not count: part of it is on screen.
 */
export function isAboveAnchor(el: Element, anchorEl: Element): boolean {
  if (el === anchorEl) return false;
  const pos = el.compareDocumentPosition(anchorEl);
  return !!(pos & Node.DOCUMENT_POSITION_FOLLOWING) && !(pos & Node.DOCUMENT_POSITION_CONTAINED_BY);
}

/**
 * Take hold of whatever is at the top of the screen, BEFORE the change.
 *
 * Returns the sample as well as the element, because the caller applies the
 * change before it can hold anything — `holdScrollAnchor` needs to be told what
 * "before" looked like or it will measure from the jumped layout and correct
 * nothing.
 *
 * Anything marked `data-hidden-item`, or containing something marked it, is
 * refused: those are the revealed items themselves, and on the way out they
 * unmount. An anchor that stops existing part way through cannot be measured
 * against, which is the one failure this has to avoid.
 */
export function pickPageAnchor(
  root: ParentNode = document,
  selector: string = PAGE_ANCHOR_SELECTOR,
): { el: HTMLElement; from: AnchorSample } | null {
  const els = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
  if (!els.length) return null;
  const scroller = scrollParentOf(els[0]);
  const viewportTop = viewportTopOf(scroller);

  const picked = pickAnchor(els.map(el => {
    const r = el.getBoundingClientRect();
    return {
      el,
      top: r.top,
      bottom: r.bottom,
      usable: r.height > 0
        && !el.closest('[data-hidden-item]')
        && !el.querySelector('[data-hidden-item]'),
    };
  }), viewportTop);

  return picked
    ? { el: picked.el, from: { top: picked.top, scrollTop: readScrollTop(scroller) } }
    : null;
}

/**
 * Keep `anchor` where it is until the returned function is called.
 *
 * Runs per frame — one `getBoundingClientRect` each — rather than on a timer,
 * because the tiles being revealed are real widgets that render asynchronously
 * and there is no moment after which the page is known to have settled.
 *
 * `from` is what the anchor looked like BEFORE the change, for a caller that
 * cannot start the hold until after it — the Edit Layout path, which learns
 * which element to hold and then hands the change to React. Given it, the first
 * correction is applied on the spot rather than on the next frame, which is the
 * difference between the jump being corrected and being corrected after it has
 * painted once. Omitted, the anchor holds from wherever it is now, which is what
 * the lift path wants: it starts before the reveal, so now IS before.
 *
 * `forMs` stops it by itself. The lift path leaves it out and releases by hand
 * the instant the drag activates — from then on a correcting scroll would be
 * counted by dnd-kit as the content moving.
 */
export function holdScrollAnchor(
  anchor: HTMLElement,
  { from, forMs }: { from?: AnchorSample; forMs?: number } = {},
): () => void {
  if (typeof requestAnimationFrame === 'undefined') return () => {};

  const scroller = scrollParentOf(anchor);
  const sample = (): AnchorSample => ({
    top: anchor.getBoundingClientRect().top,
    scrollTop: readScrollTop(scroller),
  });
  let last: AnchorSample = from ?? sample();
  const started = performance.now();
  let frame = 0;
  let stopped = false;

  const stop = () => {
    stopped = true;
    cancelAnimationFrame(frame);
  };

  const correct = () => {
    // A detached anchor cannot be measured; the element is re-created whenever
    // the reveal re-renders its grid, and a stale node reads as a wild shift.
    if (!anchor.isConnected) return;
    const now = sample();
    const drift = unexplainedShift(last, now);
    if (Math.abs(drift) >= DEAD_ZONE_PX) {
      scrollBy(scroller, drift);
      // Re-read rather than assuming the scroll landed: it clamps at the ends
      // of the range, and a correction that silently failed must not be
      // recorded as one that worked.
      last = sample();
    } else {
      last = now;
    }
  };

  const tick = () => {
    if (stopped) return;
    correct();
    if (forMs !== undefined && performance.now() - started >= forMs) return stop();
    frame = requestAnimationFrame(tick);
  };

  // Synchronously, when there is a "before" to correct against — see `from`.
  if (from) correct();
  frame = requestAnimationFrame(tick);

  return stop;
}
