import React, { useState, useCallback, createContext, useContext, ReactNode, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragOverlay,
  MeasuringStrategy,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable';

// Measuring configuration to reduce layout measurements during drag
const measuringConfig = {
  droppable: {
    strategy: MeasuringStrategy.BeforeDragging,
  },
};

// Context to expose activeId to children
interface DraggableGridContextType {
  activeId: string | null;
  isDragging: boolean;
}

const DraggableGridContext = createContext<DraggableGridContextType>({
  activeId: null,
  isDragging: false,
});

export const useDraggableGrid = () => useContext(DraggableGridContext);

export interface DraggableGridProps {
  /** Array of item IDs for sorting */
  itemIds: string[];
  /** Callback when items are reordered - receives new order */
  onReorder: (newOrder: string[]) => void;
  /** Grid content - use SortableItem to wrap each draggable item */
  children: ReactNode;
  /** Render function for the drag overlay - receives active item ID */
  renderDragOverlay?: (activeId: string) => ReactNode;
  /** Callback when drag starts - receives active ID and the full event */
  onDragStart?: (activeId: string, event: DragStartEvent) => void;
  /** Callback when drag ends (after reorder) - receives the event */
  onDragEnd?: (event: DragEndEvent, reordered: boolean) => void;
  /** Whether drag and drop is enabled (default true) */
  enabled?: boolean;
  /** Use touch-friendly sensors (long-press to drag) instead of pointer sensors */
  touchMode?: boolean;
}

export const DraggableGrid: React.FC<DraggableGridProps> = ({
  itemIds,
  onReorder,
  children,
  renderDragOverlay,
  onDragStart,
  onDragEnd,
  enabled = true,
  touchMode = false,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);

  const pointerSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const touchSensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  // Empty sensors for disabled state (hooks must be called unconditionally)
  const disabledSensors = useSensors();
  const sensors = touchMode ? touchSensors : pointerSensors;

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const id = String(event.active.id);
    setActiveId(id);
    onDragStart?.(id, event);
  }, [onDragStart]);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;

    setActiveId(null);

    if (!over || active.id === over.id) {
      onDragEnd?.(event, false);
      return;
    }

    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));

    if (oldIndex === -1 || newIndex === -1) {
      onDragEnd?.(event, false);
      return;
    }

    const reordered = arrayMove(itemIds, oldIndex, newIndex);
    onReorder(reordered);
    onDragEnd?.(event, true);
  }, [itemIds, onReorder, onDragEnd]);

  const contextValue: DraggableGridContextType = useMemo(() => ({
    activeId,
    isDragging: activeId !== null,
  }), [activeId]);

  return (
    <DraggableGridContext.Provider value={enabled ? contextValue : { activeId: null, isDragging: false }}>
      <DndContext
        sensors={enabled ? sensors : disabledSensors}
        collisionDetection={enabled ? closestCenter : undefined}
        onDragStart={enabled ? handleDragStart : undefined}
        onDragEnd={enabled ? handleDragEnd : undefined}
        measuring={enabled ? measuringConfig : undefined}
      >
        <SortableContext items={itemIds} strategy={rectSortingStrategy}>
          {children}
        </SortableContext>
        {enabled && createPortal(
          <DragOverlay>
            {activeId && renderDragOverlay?.(activeId)}
          </DragOverlay>,
          document.body
        )}
      </DndContext>
    </DraggableGridContext.Provider>
  );
};
