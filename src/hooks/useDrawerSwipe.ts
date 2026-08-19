import { useEffect, useRef, type RefObject } from 'react';

import {
  CLOSE_TRAVEL,
  EDGE_ZONE,
  OPEN_TRAVEL,
  blocksSwipe,
  commitsSwipe,
  hasOpenOverlay,
  resolveAxis,
  type SwipeAxis,
} from '@/lib/swipe';

/**
 * The two halves of the left menu's swipe: drag in from the edge to open it,
 * drag the open panel back out to close it. `lib/swipe.ts` holds the decisions;
 * this is the part that listens.
 *
 * Both commit mid-gesture rather than on lift, which is what makes the menu
 * feel attached to the finger: it starts sliding while you are still swiping.
 */

type Start = { x: number; y: number; time: number };

/**
 * Spend the click the finished swipe is about to produce.
 *
 * Cancelling the `touchmove` is supposed to suppress it, but WebKit decides
 * whether a gesture can be cancelled at `touchstart` — and at `touchstart` this
 * was still an ordinary scroll, with no non-passive listener attached. So the
 * click can arrive anyway, at wherever the finger came to rest: a menu row the
 * panel has just slid under it, or whatever the closing panel uncovered.
 *
 * Deliberately capture-phase and deliberately brief. A standing swallow there
 * would eat every Radix layer's touch dismissal (they dismiss on the *click*
 * after an outside press), so this one stands down on whichever comes first:
 * the click it was waiting for, the next gesture, or a quarter-second or so.
 */
function swallowNextClick(): () => void {
  const onClick = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); disarm(); };
  const timer = window.setTimeout(() => disarm(), 400);
  const disarm = () => {
    window.clearTimeout(timer);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('touchstart', disarm, true);
  };
  document.addEventListener('click', onClick, true);
  document.addEventListener('touchstart', disarm, true);
  return disarm;
}

/**
 * One horizontal swipe, on one host.
 *
 * `touchstart` is passive and always listening; the rest is only wired up once
 * a gesture has actually armed, so an ordinary scroll never pays for a
 * non-passive `touchmove` listener.
 */
function useHorizontalSwipe({
  enabled,
  dir,
  threshold,
  host,
  canStart,
  onCommit,
}: {
  enabled: boolean;
  /** Which way the finger travels: +1 rightwards to open, -1 leftwards to close. */
  dir: 1 | -1;
  threshold: number;
  /** Where the listeners live — the panel itself, or the whole document. */
  host: Document | HTMLElement | null;
  /** Vets the touch. Returns the element to stop the guard walk at, or false. */
  canStart: (touch: Touch) => Element | null | false;
  onCommit: () => void;
}) {
  const onCommitRef = useRef(onCommit);
  onCommitRef.current = onCommit;
  const canStartRef = useRef(canStart);
  canStartRef.current = canStart;

  useEffect(() => {
    if (!enabled || !host) return;
    const node: Document | HTMLElement = host;

    let start: Start | null = null;
    let axis: SwipeAxis = 'undecided';
    let disarmSwallow: (() => void) | null = null;

    function stop() {
      start = null;
      axis = 'undecided';
      node.removeEventListener('touchmove', onMove as EventListener);
      node.removeEventListener('touchend', stop);
      node.removeEventListener('touchcancel', stop);
    }

    function onMove(e: TouchEvent) {
      if (!start || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const dx = touch.clientX - start.x;
      const dy = touch.clientY - start.y;

      // Latched once, never revisited: a drawer's contents scroll vertically,
      // and a long scroll that drifts sideways must not close it halfway down.
      if (axis === 'undecided') axis = resolveAxis(dx, dy);
      if (axis === 'vertical') { stop(); return; }
      if (axis !== 'horizontal') return;

      // Ours now: hold the page still under the swipe, and ask for no
      // synthesised click when the finger lifts. That request is only honoured
      // where the gesture was cancellable to begin with — swallowNextClick
      // cleans up after the cases where it was not.
      if (e.cancelable) e.preventDefault();

      const travel = dx * dir;
      if (travel <= 0) return;
      if (commitsSwipe({ travel, elapsedMs: e.timeStamp - start.time, threshold })) {
        stop();
        // Commit first, then arm: a callback that closes through a real button
        // dispatches a click of its own, and the swallow must not eat that one.
        onCommitRef.current();
        disarmSwallow = swallowNextClick();
      }
    }

    function onStart(e: TouchEvent) {
      if (start) stop();
      if (e.touches.length !== 1) return;
      const touch = e.touches[0];
      const root = canStartRef.current(touch);
      if (root === false) return;
      if (blocksSwipe(touch.target as Element | null, dir, root)) return;

      start = { x: touch.clientX, y: touch.clientY, time: e.timeStamp };
      axis = 'undecided';
      node.addEventListener('touchmove', onMove as EventListener, { passive: false });
      node.addEventListener('touchend', stop);
      node.addEventListener('touchcancel', stop);
    }

    node.addEventListener('touchstart', onStart as EventListener, { passive: true });
    return () => {
      node.removeEventListener('touchstart', onStart as EventListener);
      stop();
      disarmSwallow?.();
    };
  }, [enabled, dir, threshold, host]);
}

/**
 * Swipe in from the left edge to open a collapsed left menu.
 *
 * Unscoped, the gesture belongs to the page, and stands down whenever anything
 * is layered over it — so a dialog either brings a swipe of its own or has
 * none, and never opens the menu behind itself.
 *
 * `container` says which layer the menu belongs to rather than drawing the
 * boundary itself: the swipe is scoped to the *dialog* that container sits in,
 * because a screen's own padding is not where the user thinks its edge is. A
 * container with no dialog over it — the same component hosted as a whole page
 * — is the page, and behaves unscoped.
 */
export function useEdgeSwipeOpen({
  enabled,
  onOpen,
  container,
}: {
  enabled: boolean;
  onOpen: () => void;
  container?: RefObject<HTMLElement | null>;
}) {
  const scoped = container !== undefined;
  useHorizontalSwipe({
    enabled,
    dir: 1,
    threshold: OPEN_TRAVEL,
    host: document,
    canStart: (touch) => {
      let scope: Element | null = null;
      if (scoped) {
        const root = container?.current ?? null;
        if (!root) return false;
        scope = root.closest('[role="dialog"]');
      }
      if (scope) {
        const target = touch.target as Element | null;
        if (!target || !scope.contains(target)) return false;
      } else if (hasOpenOverlay()) {
        return false;
      }
      const edge = scope ? scope.getBoundingClientRect().left : 0;
      if (touch.clientX < edge || touch.clientX - edge > EDGE_ZONE) return false;
      return scope;
    },
    onCommit: onOpen,
  });
}

/**
 * Swipe the open panel back out to the left to close it.
 *
 * Takes the panel element rather than a ref so the listeners attach the moment
 * it mounts — a sheet's content does not exist until it opens. Pass null to
 * turn the gesture off.
 */
export function useSwipeToClose(
  panel: HTMLElement | null,
  onClose: () => void,
) {
  useHorizontalSwipe({
    enabled: !!panel,
    dir: -1,
    threshold: CLOSE_TRAVEL,
    host: panel,
    canStart: () => panel,
    onCommit: onClose,
  });
}
