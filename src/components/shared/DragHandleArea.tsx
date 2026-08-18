import type { ReactNode } from 'react';
import { useDragHandle } from './SortableItem';

/**
 * Makes everything inside it the drag handle.
 *
 * `SortableItem` publishes its listeners through context rather than spreading
 * them on its own wrapper, so that a tile can nominate part of itself — a
 * header, say — as the grip. A summary card has no such part: it is one small
 * row, so the whole thing is the grip.
 *
 * Safe to wrap a card that is also a button. The pointer sensor only starts a
 * drag after 8px of movement, and the touch sensor after a 250ms hold, neither
 * of which a tap satisfies. Inert outside a sortable, where the context is empty.
 */
export function DragHandleArea({ children, className }: { children: ReactNode; className?: string }) {
  const dragHandle = useDragHandle();
  return (
    <div
      className={className}
      {...(dragHandle?.attributes || {})}
      {...(dragHandle?.listeners || {})}
    >
      {children}
    </div>
  );
}
