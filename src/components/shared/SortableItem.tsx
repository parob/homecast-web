import React, { createContext, useContext, useMemo, memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import type { DraggableAttributes } from '@dnd-kit/core';
import type { SyntheticListenerMap } from '@dnd-kit/core/dist/hooks/utilities';

// Context for passing drag handle props to children (e.g., WidgetCard header)
interface DragHandleContextType {
  attributes: DraggableAttributes;
  listeners: SyntheticListenerMap | undefined;
  isDragging: boolean;
}

const DragHandleContext = createContext<DragHandleContextType | null>(null);

export const useDragHandle = () => useContext(DragHandleContext);

// Sortable wrapper for cards - used by both Dashboard and CollectionDetail
//
// Both branches carry `data-draggable-item`, on the element that owns the drag,
// so a press can be told apart from a press on the page behind it. The
// background long-press (lib/long-press.ts) needs to know "is there a tile under
// this finger?" and had nothing to ask: sidebar rows have `data-sortable-id`,
// but a grid tile rendered nothing but a bare div. A marker beats matching class
// names, which change whenever the layout does.
export interface SortableItemProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  /** When true, don't apply transforms (useful for cross-group dragging) */
  disableTransform?: boolean;
  /**
   * Grid placement for a tile that is not 1×1 (see lib/widget-sizes.ts).
   *
   * It has to land here rather than on the card inside, because this is the
   * element the grid actually lays out — a span set on a descendant is a span
   * set on nothing. Merged under the drag transform, never over it: a lift
   * must still be able to move the tile it is carrying.
   */
  style?: React.CSSProperties;
}

export const SortableItem: React.FC<SortableItemProps> = memo(({ id, children, disabled, disableTransform, style: styleOverride }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = useMemo(() => ({
    // The grid span first, so the drag properties below always win a collision.
    ...styleOverride,
    // Only use translate, not scale - prevents stretching when items of different sizes swap
    // When disableTransform is true, don't apply transforms (used for cross-group dragging)
    transform: transform && !disableTransform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: disableTransform ? undefined : transition,
    // When dragging, dim the placeholder - the DragOverlay shows the dragged item on top
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    // GPU acceleration for smoother transforms
    willChange: transform ? 'transform' : undefined,
  }), [styleOverride, transform, disableTransform, transition, isDragging]);

  const contextValue = useMemo(() => ({
    attributes,
    listeners,
    isDragging,
  }), [attributes, listeners, isDragging]);

  // When disabled, just render without drag functionality
  if (disabled) {
    return <div ref={setNodeRef} style={style} data-draggable-item="">{children}</div>;
  }

  // Provide drag handle context so children (WidgetCard) can apply listeners to specific areas
  return (
    <DragHandleContext.Provider value={contextValue}>
      <div ref={setNodeRef} style={style} data-draggable-item="">
        {children}
      </div>
    </DragHandleContext.Provider>
  );
});
