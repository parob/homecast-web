/**
 * Animating the space, not just the things in it.
 *
 * Revealing the hidden items adds tiles to a room's grid, and a grid that gains
 * a row gets taller — so every room below it moves down. `data-hidden-item`
 * fades the arriving tiles, but that move happened in a single frame: the
 * revealed tile faded in politely while the four rooms under it jumped 128px.
 *
 * This closes that gap by animating the HEIGHT of the container that grew.
 * Everything below reflows from it, frame by frame, and nothing else has to be
 * touched.
 *
 * Height rather than a transform, deliberately, and it is not a matter of
 * taste. The usual FLIP idiom — measure, translate the delta, transition it to
 * zero — would put an animated transform on the room containers, which are
 * ancestors of every tile's `backdrop-filter` glass layer. An animated
 * transform or opacity on such an ancestor establishes a new backdrop root and
 * switches the glass off for as long as it runs (the same trap documented on
 * `WidgetWrapper.hiddenItem`, on `timer-alarm`, and on `timer-finished`). It
 * would smooth the movement by flattening every tile on screen while it moved.
 * Height is not a compositing property, so it costs a layout per frame and
 * nothing else.
 */

/** Long enough to read, short enough not to be in the way — and the same beat
 *  as the tiles' own arrival, so the two read as one movement. */
export const REFLOW_MS = 260;

/** The same curve as the hidden items' fade: furthest first, then settle. */
export const REFLOW_EASE = 'cubic-bezier(0.32, 0.72, 0, 1)';

/** What an element measured, before whatever changed it. */
export type HeightMap = Map<Element, number>;

export interface HeightChange {
  el: HTMLElement;
  /** Where it was. 0 for an element that was not there at all. */
  from: number;
  to: number;
}

/** Every container whose height the reveal could move. */
export const REFLOW_SELECTOR = '[data-room-container], [data-drop-container]';

export function captureHeights(
  root: ParentNode = document,
  selector: string = REFLOW_SELECTOR,
): HeightMap {
  const map: HeightMap = new Map();
  root.querySelectorAll(selector).forEach(el => {
    map.set(el, (el as HTMLElement).getBoundingClientRect().height);
  });
  return map;
}

/**
 * What actually changed, and by how much.
 *
 * Pure, and the part worth testing: an element in `next` but not `prev` is new
 * and grows from nothing; one in `prev` but not `next` has been removed and
 * cannot be animated at all; sub-pixel noise is not a change.
 *
 * Nested containers are reduced to the outermost. A room container and the drop
 * container inside it both grow by the same row, and animating both would clip
 * the inner one against the outer while they ran. Animating the outer alone
 * moves everything below it, which is the whole point.
 */
export function heightChanges(prev: HeightMap, next: HeightMap, minDelta = 1): HeightChange[] {
  const changed: HeightChange[] = [];
  next.forEach((to, el) => {
    const from = prev.get(el) ?? 0;
    if (Math.abs(to - from) < minDelta) return;
    changed.push({ el: el as HTMLElement, from, to });
  });
  return changed.filter(({ el }) => !changed.some(other => other.el !== el && other.el.contains(el)));
}

/**
 * Play them. Returns a cancel that puts every element back the way it was —
 * call it if the component unmounts mid-flight, or an inline height outlives
 * the thing it was animating.
 */
export function playHeightChanges(
  changes: HeightChange[],
  { durationMs = REFLOW_MS, ease = REFLOW_EASE }: { durationMs?: number; ease?: string } = {},
): () => void {
  const finishers: Array<() => void> = [];

  for (const { el, from, to } of changes) {
    const style = el.style;
    const hadHeight = style.height;
    const hadOverflow = style.overflow;
    const hadTransition = style.transition;

    style.transition = 'none';
    style.height = `${from}px`;
    // The extra row exists in the DOM already and would hang out of a container
    // that is still short. Only while this runs.
    style.overflow = 'hidden';
    // Force the "from" height to be committed. Without this read the browser
    // coalesces both writes into one style change and nothing transitions.
    void el.offsetHeight;
    style.transition = `height ${durationMs}ms ${ease}`;
    style.height = `${to}px`;

    let done = false;
    let timer = 0;
    const finish = () => {
      if (done) return;
      done = true;
      style.height = hadHeight;
      style.overflow = hadOverflow;
      style.transition = hadTransition;
      el.removeEventListener('transitionend', onEnd);
      window.clearTimeout(timer);
    };
    const onEnd = (e: Event) => {
      if ((e as TransitionEvent).propertyName === 'height') finish();
    };
    el.addEventListener('transitionend', onEnd);
    // `transitionend` never arrives for an element that is removed mid-flight,
    // or whose transition is interrupted. The timer is what guarantees the
    // inline height comes back off — leaving one on would freeze that room at
    // the size it happened to be.
    timer = window.setTimeout(finish, durationMs + 80);
    finishers.push(finish);
  }

  return () => finishers.forEach(f => f());
}

/** True when the viewer has asked for less movement. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
