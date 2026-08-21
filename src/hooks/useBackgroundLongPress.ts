import { useEffect, useRef } from 'react';
import { exceededSlop, isBackgroundTarget, LIFT_DELAY_IDLE } from '@/lib/long-press';

/**
 * A hold on the page itself enters Edit Layout.
 *
 * The tiles get there through dnd-kit — hold one and it lifts with the mode.
 * That leaves the gaps between them, and the empty space below the last row,
 * where the same gesture did nothing at all. Holding the wallpaper is how the
 * iOS Home screen has always started arranging, and a person who has just
 * learned that holding a tile works will try it.
 *
 * Nothing is picked up here, so unlike the lift there is no drag to protect:
 * this can run the whole tidy-up straight away.
 *
 * The decisions live in `lib/long-press.ts` and are unit-tested there; this is
 * only the listeners. Same split as `useDrawerSwipe`/`swipe.ts`.
 */
export function useBackgroundLongPress(
  hostRef: React.RefObject<HTMLElement | null>,
  onLift: () => void,
  enabled: boolean,
) {
  // Kept in a ref so changing the callback between renders never re-arms the
  // listeners mid-press — re-attaching would drop the pointerdown we are
  // already timing.
  const onLiftRef = useRef(onLift);
  onLiftRef.current = onLift;

  useEffect(() => {
    const host = hostRef.current;
    if (!enabled || !host) return;

    let timer: number | undefined;
    let origin: { x: number; y: number } | null = null;

    const cancel = () => {
      window.clearTimeout(timer);
      timer = undefined;
      origin = null;
    };

    const onPointerDown = (e: PointerEvent) => {
      cancel();
      // A tile, a row, a control: all own the press themselves, and firing here
      // as well would enter the mode twice over.
      if (!isBackgroundTarget(e.target)) return;
      origin = { x: e.clientX, y: e.clientY };
      timer = window.setTimeout(() => {
        cancel();
        onLiftRef.current();
      }, LIFT_DELAY_IDLE);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!origin) return;
      // A finger that travels has chosen to scroll.
      if (exceededSlop(e.clientX - origin.x, e.clientY - origin.y)) cancel();
    };

    // Capture, so the scroller's own scroll cancels us rather than the other way
    // round: a momentum scroll produces no pointermove at all.
    const onScroll = () => cancel();

    host.addEventListener('pointerdown', onPointerDown, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', cancel, { passive: true });
    window.addEventListener('pointercancel', cancel, { passive: true });
    window.addEventListener('scroll', onScroll, true);
    // Backgrounding the app mid-hold must not fire the mode on return.
    document.addEventListener('visibilitychange', cancel);

    return () => {
      cancel();
      host.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('visibilitychange', cancel);
    };
  }, [hostRef, enabled]);
}
