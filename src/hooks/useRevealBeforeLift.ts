import { useCallback, useEffect, useRef } from 'react';
import {
  LIFT_DRAGGABLE,
  LIFT_REVEAL_DELAY,
  LIFT_SENSOR_TOLERANCE,
  exceededSlop,
} from '@/lib/long-press';
import { holdScrollAnchor } from '@/lib/lift-scroll-anchor';

/**
 * Reveal hidden items in the gap between the finger settling and the drag
 * starting.
 *
 * The listeners for the ordering `LIFT_REVEAL_DELAY` documents: the reveal has
 * to finish moving the page *before* dnd-kit measures it, because nothing can
 * correct a page that moves afterwards. dnd-kit's own `TouchSensor` fires at
 * `LIFT_DELAY_IDLE`; this runs earlier, on the same press, and leaves the
 * difference for the revealed widgets to render in.
 *
 * Same split as `useBackgroundLongPress`: the decisions are pure and unit-tested
 * in `lib/long-press.ts`, this is the plumbing.
 *
 * Watches `touchstart` on the document rather than wiring into the sortables,
 * because the press that matters may land on any of ~28 widget components and
 * threading a handler through all of them is how the last one got missed.
 */
export function useRevealBeforeLift({
  enabled,
  onReveal,
  onAbandon,
}: {
  /** Touch device, not already arranging — otherwise there is nothing to reveal. */
  enabled: boolean;
  /** The hold has taken. Show hidden items now, while there is still time. */
  onReveal: () => void;
  /**
   * The press ended without ever becoming a drag, so the reveal was premature.
   * Called only when this hook fired; the caller decides whether to undo it,
   * since a press that *did* become a drag ends the same way.
   */
  onAbandon: () => void;
}): { releaseAnchor: () => void } {
  // Through refs so the listeners bind once: re-binding mid-press would drop the
  // pending timer along with the press it belongs to.
  const onRevealRef = useRef(onReveal);
  onRevealRef.current = onReveal;
  const onAbandonRef = useRef(onAbandon);
  onAbandonRef.current = onAbandon;
  /**
   * Stops the anchor. Replaced each time one starts, and called by the caller
   * the moment the drag activates — from then on a correcting scroll would be
   * counted by dnd-kit as the content moving, which is the failure this whole
   * ordering exists to avoid.
   */
  const releaseRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    let origin: { x: number; y: number } | null = null;
    let pressed: HTMLElement | null = null;
    let revealed = false;

    const cancelTimer = () => {
      window.clearTimeout(timer);
      timer = undefined;
    };

    const finish = () => {
      cancelTimer();
      releaseRef.current();
      origin = null;
      pressed = null;
      if (revealed) {
        revealed = false;
        onAbandonRef.current();
      }
    };

    const onTouchStart = (event: TouchEvent) => {
      // A second finger is a pinch or a scroll, never a hold.
      if (event.touches.length !== 1) return finish();
      const touch = event.touches[0];
      const target = event.target instanceof Element ? event.target.closest(LIFT_DRAGGABLE) : null;
      if (!target) return;

      origin = { x: touch.clientX, y: touch.clientY };
      pressed = target as HTMLElement;
      revealed = false;
      timer = window.setTimeout(() => {
        timer = undefined;
        revealed = true;
        // Anchor first: the reveal is what moves the page, and the anchor has to
        // have measured the "before" to know by how much.
        if (pressed) releaseRef.current = holdScrollAnchor(pressed);
        onRevealRef.current();
      }, LIFT_REVEAL_DELAY);
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!origin) return;
      const touch = event.touches[0];
      if (!touch) return;
      // Past the sensor's own tolerance this press is a scroll, and the drag it
      // was heading for has been abandoned too.
      if (exceededSlop(touch.clientX - origin.x, touch.clientY - origin.y, LIFT_SENSOR_TOLERANCE)) {
        finish();
      }
    };

    // Capture, so a tile that stops propagation cannot hide the press.
    const opts = { capture: true, passive: true } as const;
    document.addEventListener('touchstart', onTouchStart, opts);
    document.addEventListener('touchmove', onTouchMove, opts);
    document.addEventListener('touchend', finish, opts);
    document.addEventListener('touchcancel', finish, opts);

    return () => {
      cancelTimer();
      releaseRef.current();
      document.removeEventListener('touchstart', onTouchStart, opts);
      document.removeEventListener('touchmove', onTouchMove, opts);
      document.removeEventListener('touchend', finish, opts);
      document.removeEventListener('touchcancel', finish, opts);
    };
  }, [enabled]);

  return { releaseAnchor: useCallback(() => releaseRef.current(), []) };
}
