import { useEffect } from 'react';
import { useDndContext } from '@dnd-kit/core';

/** The summary row's height transition — `duration-base`. */
const ROW_ANIMATION_MS = 200;

/**
 * Re-measure the grid while the summary row is growing above it.
 *
 * Entering Edit Layout rewraps that row, and on a narrow phone that is a second
 * line: every tile below shifts down by ~32px, animated over 200ms. The catch is
 * *when* it happens — Edit Layout is entered by a long press that is already a
 * drag, so the shift lands after dnd-kit has measured. Its cached rects then
 * describe where the tiles used to be, and the drop lands a row out.
 *
 * dnd-kit re-measures on its own schedule (`BeforeDragging` for the scene and
 * automation grids, the default for the accessory grid), and none of those
 * strategies know about a CSS transition, which moves the page without any React
 * render or scroll event to notice. So the measurement is asked for explicitly,
 * across the animation rather than only at its end: a drop can happen mid-slide.
 *
 * Cheaper than switching those grids to `MeasuringStrategy.Always`, which would
 * re-measure for the whole drag to cover 200ms of it — and the accessory grid can
 * hold a hundred tiles.
 *
 * Renders nothing; it must simply be a child of the DndContext it measures.
 */
export function RemeasureDuringLift({ active }: { active: boolean }) {
  const { measureDroppableContainers } = useDndContext();

  useEffect(() => {
    if (!active) return;
    // Start, middle and settled. The last one is what finally matters; the
    // earlier two keep a drop that happens mid-animation roughly honest.
    const timers = [0, ROW_ANIMATION_MS / 2, ROW_ANIMATION_MS + 40].map(delay =>
      // `[]` is every container, not none: the skip-this-one branch is guarded
      // on the queue being non-empty.
      window.setTimeout(() => measureDroppableContainers([]), delay),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [active, measureDroppableContainers]);

  return null;
}
