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

/** What a reveal puts on the page, and takes back off it. */
export const HIDDEN_ITEM_SELECTOR = '[data-hidden-item="true"]';

/**
 * Containers that will have nothing left in them once the revealed items go.
 *
 * `heightChanges` walks the map taken AFTER the change, so an element that no
 * longer exists is never in it and can never be animated. One kind of element
 * reliably does not: a room whose every tile was a revealed hidden one has
 * nothing to show once the reveal ends, so it unmounts whole and takes its
 * height with it between one frame and the next. Measured leaving Edit Layout
 * on the fixture home, that was 170px — 59% of the entire movement, in a single
 * frame, which is what "the remaining items don't scroll nicely onto the
 * screen" is in parob/homecast-cloud#60.
 *
 * They can only be found while they are still here, which is why this is
 * separate from `heightChanges` and runs before the unmount rather than after
 * it. The caller collapses them over the same beat their contents fade, so by
 * the time React removes them they already occupy nothing.
 *
 * The mark sits INSIDE the draggable for a hidden tile (`WidgetWrapper` puts it
 * on the widget, `SortableItem` owns the `data-draggable-item` above it) and on
 * the container ITSELF for a whole revealed room, so both directions are asked.
 * A container with no draggables at all is not "emptying", it is already empty,
 * and collapsing it would animate something nobody is losing.
 */
export function emptyingContainers(
  root: ParentNode = document,
  selector: string = REFLOW_SELECTOR,
): HTMLElement[] {
  const isRevealed = (el: Element) =>
    !!el.querySelector(HIDDEN_ITEM_SELECTOR) || !!el.closest(HIDDEN_ITEM_SELECTOR);

  const all = Array.from(root.querySelectorAll(selector)) as HTMLElement[];
  const emptying = all.filter(el => {
    const items = Array.from(el.querySelectorAll('[data-draggable-item]'));
    return items.length > 0 && items.every(isRevealed);
  });

  // Outermost only, for the reason `heightChanges` reduces its own: a room and
  // the drop container inside it both empty together, and collapsing both would
  // animate the inner one against the outer while they ran.
  return emptying.filter(el => !emptying.some(other => other !== el && other.contains(el)));
}

/**
 * Collapse them to nothing over `durationMs`. Returns a cancel that puts them
 * back, for a put-away that is abandoned part way through.
 *
 * The Web Animations API rather than {@link playHeightChanges}, and the reason
 * is specific: these containers are collapsing WHILE they fade, under
 * `[data-hidden-exiting]`, which is a CSS transition on opacity and transform.
 * `playHeightChanges` drives its animation by writing `style.transition`, and
 * that is the shorthand — it deletes the rule's opacity and transform
 * transitions outright, so the room blinks out instead of leaving. Nor can the
 * old value simply be read and re-appended: this runs in the same tick as
 * `setHiddenExiting(true)`, before React has put the attribute on the root, so
 * at this moment there is nothing there to read.
 *
 * `animate()` sidesteps all of it. It composes with the transition rather than
 * replacing it, and it touches no inline style at all.
 */
export function collapseContainers(els: HTMLElement[], durationMs = REFLOW_MS): () => void {
  const running = els.map(el => {
    const from = el.getBoundingClientRect().height;
    const hadOverflow = el.style.overflow;
    // The contents are still in there, fading, and would hang out of a box that
    // is now shorter than they are. `clip` for the reason given above.
    el.style.overflow = 'clip';
    const anim = el.animate(
      [{ height: `${from}px` }, { height: '0px' }],
      // `forwards`, so it stays closed for the frames between the animation
      // ending and React removing it — those two are meant to coincide, and a
      // container that sprang back open in between would undo the whole point.
      { duration: durationMs, easing: REFLOW_EASE, fill: 'forwards' },
    );
    return { el, anim, hadOverflow };
  });

  return () => running.forEach(({ el, anim, hadOverflow }) => {
    anim.cancel();
    el.style.overflow = hadOverflow;
  });
}

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
    //
    // `clip` rather than `hidden`, and the difference is not stylistic: `hidden`
    // establishes a block formatting context, which stops margins collapsing
    // through the container and moves everything inside it down by whatever
    // margin used to collapse out. Measured on every room grid on the fixture
    // home, that was exactly 5px — applied when this starts and taken back when
    // it ends. Invisible on its own, except that `holdScrollAnchor` is watching
    // an element inside the container and reads both as content moving, so it
    // scrolls the whole page 5px one way here and 5px back at the end. That
    // second correction is the snap in parob/homecast-cloud#60.
    //
    // `clip` establishes no formatting context, so margins collapse exactly as
    // they do untouched. A browser that does not know the value drops it and
    // the row hangs out for the length of the animation — cosmetic, and no
    // worse than not animating at all.
    style.overflow = 'clip';
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
