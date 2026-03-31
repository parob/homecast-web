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
export interface SortableItemProps {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
  /** When true, don't apply transforms (useful for cross-group dragging) */
  disableTransform?: boolean;
}

export const SortableItem: React.FC<SortableItemProps> = memo(({ id, children, disabled, disableTransform }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = useMemo(() => ({
    // Only use translate, not scale - prevents stretching when items of different sizes swap
    // When disableTransform is true, don't apply transforms (used for cross-group dragging)
    transform: transform && !disableTransform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition: disableTransform ? undefined : transition,
    // When dragging, dim the placeholder - the DragOverlay shows the dragged item on top
    opacity: isDragging ? 0.5 : 1,
    position: 'relative' as const,
    // GPU acceleration for smoother transforms
    willChange: transform ? 'transform' : undefined,
  }), [transform, disableTransform, transition, isDragging]);

  const contextValue = useMemo(() => ({
    attributes,
    listeners,
    isDragging,
  }), [attributes, listeners, isDragging]);

  // When disabled, just render without drag functionality
  if (disabled) {
    return <div ref={setNodeRef} style={style}>{children}</div>;
  }

  // Provide drag handle context so children (WidgetCard) can apply listeners to specific areas
  return (
    <DragHandleContext.Provider value={contextValue}>
      <div ref={setNodeRef} style={style}>
        {children}
      </div>
    </DragHandleContext.Provider>
  );
});
