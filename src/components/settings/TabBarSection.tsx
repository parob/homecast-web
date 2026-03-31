import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { GripVertical, Pin, X } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import type { PinnedTab } from '@/lib/graphql/types';

interface TabBarSectionProps {
  pinnedTabs: PinnedTab[];
  handleUnpinTab: (type: string, id: string) => void;
  handleUpdateTabName: (type: string, id: string, customName: string | undefined) => void;
  handleReorderTabs: (reordered: PinnedTab[]) => void;
  maxPinnedTabs: number;
}

export function TabBarSection({
  pinnedTabs,
  handleUnpinTab,
  handleUpdateTabName,
  handleReorderTabs,
  maxPinnedTabs,
}: TabBarSectionProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = pinnedTabs.map((tab) => `${tab.type}-${tab.id}`);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    handleReorderTabs(arrayMove(pinnedTabs, oldIndex, newIndex));
  }, [itemIds, pinnedTabs, handleReorderTabs]);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Pin up to {maxPinnedTabs} homes, rooms, or collections for quick access on mobile. Long-press items in the sidebar to pin them.
      </p>
      {pinnedTabs.length > 0 ? (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {pinnedTabs.map((tab) => (
                <TabRow
                  key={`${tab.type}-${tab.id}`}
                  tab={tab}
                  onUnpin={() => handleUnpinTab(tab.type, tab.id)}
                  onUpdateName={(customName) => handleUpdateTabName(tab.type, tab.id, customName)}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="text-xs text-muted-foreground italic">No pinned items</p>
      )}
    </div>
  );
}

function TabRow({ tab, onUnpin, onUpdateName }: {
  tab: PinnedTab;
  onUnpin: () => void;
  onUpdateName: (customName: string | undefined) => void;
}) {
  const [value, setValue] = useState(tab.customName ?? '');
  const sortableId = `${tab.type}-${tab.id}`;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sortableId });

  const style = {
    transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const save = () => {
    const trimmed = value.trim();
    const newName = trimmed || undefined;
    if (newName !== (tab.customName ?? undefined)) {
      onUpdateName(newName);
    }
  };

  return (
    <div ref={setNodeRef} style={style} className="py-1.5 px-2 rounded-lg hover:bg-muted/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <button type="button" className="touch-none cursor-grab shrink-0" {...attributes} {...listeners}>
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <span className="text-sm truncate">{tab.name}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{tab.type}</span>
        </div>
        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={onUnpin}>
          <X className="h-3 w-3" />
        </Button>
      </div>
      <div className="relative mt-1 ml-5.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          placeholder="Custom label"
          maxLength={20}
          className="w-full text-xs bg-transparent border border-border/50 rounded px-2 py-1 pr-6 placeholder:text-muted-foreground/50 focus:outline-none focus:border-border"
        />
        {value && (
          <button
            type="button"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => { setValue(''); onUpdateName(undefined); }}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
