import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_COLLECTIONS } from '@/lib/graphql/queries';
import { cn } from '@/lib/utils';
import type { GetCollectionsResponse, Collection, CollectionGroup } from '@/lib/graphql/types';
import { parseCollectionPayload } from '@/lib/graphql/types';
import { CreateCollectionDialog } from './CreateCollectionDialog';
import { Button } from '@/components/ui/button';
import { Plus, Folder, Loader2, Layers, Pencil, Trash2, FolderPlus, Share2, ImageIcon, Pin, PinOff } from 'lucide-react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface SortableCollectionItemProps {
  collection: Collection;
  isSelected: boolean;
  hasSelectedChild?: boolean;
  onSelect: () => void;
  onShare?: () => void;
  onSelectAccessories?: () => void;
  onCreateGroup?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onBackgroundSettings?: () => void;
  onPin?: () => void;
  isPinned?: boolean;
  pinFull?: boolean;
  isDarkBackground?: boolean;
  dragDisabled?: boolean;
  disableContextMenu?: boolean;
  editMode?: boolean;
  children?: React.ReactNode;
}

const SortableCollectionItem: React.FC<SortableCollectionItemProps> = ({
  collection,
  isSelected,
  hasSelectedChild,
  onSelect,
  onShare,
  onSelectAccessories,
  onCreateGroup,
  onRename,
  onDelete,
  onBackgroundSettings,
  onPin,
  isPinned,
  pinFull,
  isDarkBackground,
  dragDisabled,
  disableContextMenu,
  editMode,
  children,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: collection.id, disabled: dragDisabled });

  const style = {
    transform: CSS.Translate.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const collectionWiggleOffset = editMode ? { '--wiggle-offset': `${(collection.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;

  const buttonContent = (
    <div ref={setNodeRef} style={style} className="relative cursor-pointer" onClick={onSelect}>
      <div className={editMode ? 'wiggle' : ''} style={collectionWiggleOffset}>
      <button
        {...attributes}
        {...listeners}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        className={`flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${isDragging ? 'cursor-grabbing' : ''} ${
          isDarkBackground
            ? `text-white ${hasSelectedChild ? 'bg-white/10' : isSelected ? 'bg-white/20' : 'hover:bg-white/10'}`
            : `${hasSelectedChild ? 'bg-muted' : isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
        }`}
      >
        <Folder className="h-4 w-4" />
        <span className="flex-1 truncate font-semibold">{collection.name}</span>
        <span className={`text-xs ${
          isDarkBackground
            ? 'text-white/70'
            : isSelected && !hasSelectedChild ? 'text-primary-foreground/70' : 'text-muted-foreground'
        }`}>
          {parseCollectionPayload(collection.payload).items.length}
        </span>
      </button>
      </div>
    </div>
  );

  if (disableContextMenu) return (
    <div>
      {buttonContent}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {buttonContent}
        </ContextMenuTrigger>
        <ContextMenuContent>
          <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
            {collection.name}
          </div>
          {onShare && (
            <ContextMenuItem onClick={onShare}>
              <Share2 className="h-4 w-4 mr-2" />
              Share Collection
            </ContextMenuItem>
          )}
          {onPin && (
            <ContextMenuItem onClick={onPin} disabled={!isPinned && pinFull}>
              {isPinned ? (
                <>
                  <PinOff className="h-4 w-4 mr-2" />
                  Unpin from Tab Bar
                </>
              ) : pinFull ? (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Tab Bar Full
                </>
              ) : (
                <>
                  <Pin className="h-4 w-4 mr-2" />
                  Pin to Tab Bar
                </>
              )}
            </ContextMenuItem>
          )}
          {onSelectAccessories && (
            <ContextMenuItem onClick={onSelectAccessories}>
              <Plus className="h-4 w-4 mr-2" />
              Select Accessories
            </ContextMenuItem>
          )}
          {onCreateGroup && (
            <ContextMenuItem onClick={onCreateGroup}>
              <FolderPlus className="h-4 w-4 mr-2" />
              Create Group
            </ContextMenuItem>
          )}
          {onRename && (
            <ContextMenuItem onClick={onRename}>
              <Pencil className="h-4 w-4 mr-2" />
              Rename Collection
            </ContextMenuItem>
          )}
          {onDelete && (
            <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Collection
            </ContextMenuItem>
          )}
          {onBackgroundSettings && (
            <ContextMenuItem onClick={onBackgroundSettings}>
              <ImageIcon className="h-4 w-4 mr-2" />
              Set Collection Background
            </ContextMenuItem>
          )}
        </ContextMenuContent>
      </ContextMenu>
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
};

interface CollectionListProps {
  selectedId?: string | null;
  onSelect: (collection: Collection | null) => void;
  onLoadFromUrl?: (collection: Collection) => void;
  /** Called with refetch function on mount */
  onRefetchReady?: (refetch: () => Promise<void>) => void;
  /** Called when loading state changes */
  onLoadingChange?: (loading: boolean) => void;
  /** Groups to display under the selected collection */
  groups?: CollectionGroup[];
  /** Currently selected group ID */
  selectedGroupId?: string | null;
  /** Callback when a group is selected */
  onGroupSelect?: (groupId: string) => void;
  /** Map of group ID to item count */
  groupItemCounts?: Record<string, number>;
  /** Whether to hide accessory counts */
  hideAccessoryCounts?: boolean;
  /** Content to render for groups (for drag-and-drop support) */
  groupsContent?: React.ReactNode;
  /** Whether the groups section is expanded (for toggle support) */
  groupsExpanded?: boolean;
  /** Callback when share is requested for a collection */
  onShare?: (collection: Collection) => void;
  /** Callback when select accessories is requested for a collection */
  onSelectAccessories?: (collection: Collection) => void;
  /** Callback when rename is requested for a collection */
  onRename?: (collection: Collection) => void;
  /** Callback when delete is requested for a collection */
  onDelete?: (collection: Collection) => void;
  /** Callback when collections are reordered */
  onReorder?: (collectionIds: string[]) => void;
  /** Callback when create group is requested */
  onCreateGroup?: () => void;
  /** Callback when background settings is requested for a collection */
  onBackgroundSettings?: (collection: Collection) => void;
  /** Whether the background is dark (for light text mode) */
  isDarkBackground?: boolean;
  /** Whether drag-and-drop reordering is disabled */
  dragDisabled?: boolean;
  /** Use touch-friendly sensors (long-press to drag) */
  touchMode?: boolean;
  /** Disable context menus on items (for iOS edit mode) */
  disableContextMenu?: boolean;
  /** Whether edit mode is active (enables wiggle animation) */
  editMode?: boolean;
  /** Callback when pin is requested for a collection */
  onPin?: (collection: Collection) => void;
  /** Check if a collection is pinned */
  isPinned?: (collectionId: string) => boolean;
  /** Whether the pin tab bar is full */
  pinFull?: boolean;
}

export function CollectionList({ selectedId, onSelect, onLoadFromUrl, onRefetchReady, onLoadingChange, groups, selectedGroupId, onGroupSelect, groupItemCounts, hideAccessoryCounts, groupsContent, groupsExpanded = true, onShare, onSelectAccessories, onRename, onDelete, onReorder, onCreateGroup, onBackgroundSettings, isDarkBackground, dragDisabled, touchMode, disableContextMenu, editMode, onPin, isPinned, pinFull }: CollectionListProps) {
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [loadedFromUrl, setLoadedFromUrl] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [draggingCollectionId, setDraggingCollectionId] = useState<string | null>(null);

  const pointerSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const touchSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
  const disabledSensors = useSensors();
  const sensors = touchMode ? touchSensors : pointerSensors;

  const { data, loading, refetch } = useQuery<GetCollectionsResponse>(GET_COLLECTIONS, {
    fetchPolicy: 'cache-and-network',
  });

  // Expose refetch function to parent
  useEffect(() => {
    if (onRefetchReady) {
      onRefetchReady(async () => {
        setIsRefetching(true);
        try {
          await refetch();
        } finally {
          setIsRefetching(false);
        }
      });
    }
  }, [onRefetchReady, refetch]);

  // Notify parent of loading state changes
  useEffect(() => {
    onLoadingChange?.(loading || isRefetching);
  }, [loading, isRefetching, onLoadingChange]);

  const serverCollections = data?.collections ?? [];

  // Sort collections by local order if available
  const collections = useMemo(() => {
    if (!localOrder) return serverCollections;
    const orderMap = new Map(localOrder.map((id, index) => [id, index]));
    return [...serverCollections].sort((a, b) => {
      const aIndex = orderMap.get(a.id) ?? Infinity;
      const bIndex = orderMap.get(b.id) ?? Infinity;
      return aIndex - bIndex;
    });
  }, [serverCollections, localOrder]);

  // When collections load and we have a selectedId from URL, notify parent with full collection object
  // Uses onLoadFromUrl to avoid triggering URL updates (since URL is already set)
  useEffect(() => {
    if (selectedId && collections.length > 0 && !loadedFromUrl) {
      const collection = collections.find(c => c.id === selectedId);
      if (collection) {
        setLoadedFromUrl(true);
        // Use onLoadFromUrl if provided, otherwise fall back to onSelect
        if (onLoadFromUrl) {
          onLoadFromUrl(collection);
        } else {
          onSelect(collection);
        }
      }
    }
  }, [selectedId, collections, loadedFromUrl, onLoadFromUrl, onSelect]);

  // Reset loadedFromUrl when selectedId is cleared
  useEffect(() => {
    if (!selectedId) {
      setLoadedFromUrl(false);
    }
  }, [selectedId]);

  const hasGroups = groups && groups.length > 0;

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingCollectionId(event.active.id as string);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingCollectionId(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = collections.findIndex(c => c.id === active.id);
    const newIndex = collections.findIndex(c => c.id === over.id);

    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...collections];
    const [removed] = newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, removed);

    const newOrderIds = newOrder.map(c => c.id);
    setLocalOrder(newOrderIds);
    onReorder?.(newOrderIds);
  };

  return (
    <>
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className={cn("text-xs font-semibold", isDarkBackground ? "text-white/70" : "text-muted-foreground")}>
            Collections
          </h3>
          {selectedId && onCreateGroup ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn("h-5 w-5", isDarkBackground && "!bg-transparent text-white hover:!bg-white/10 hover:text-white")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => setCreateDialogOpen(true)}>
                  <FolderPlus className="h-4 w-4 mr-2" />
                  New Collection
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                  {collections.find(c => c.id === selectedId)?.name || 'Collection'}
                </div>
                <DropdownMenuItem onClick={onCreateGroup}>
                  <Layers className="h-4 w-4 mr-2" />
                  New Group
                </DropdownMenuItem>
                {onSelectAccessories && (
                  <DropdownMenuItem onClick={() => {
                    const collection = collections.find(c => c.id === selectedId);
                    if (collection) onSelectAccessories(collection);
                  }}>
                    <Plus className="h-4 w-4 mr-2" />
                    Select Accessories
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-5 w-5", isDarkBackground && "!bg-transparent text-white hover:!bg-white/10 hover:text-white")}
              onClick={() => setCreateDialogOpen(true)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {loading && collections.length === 0 ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        ) : collections.length === 0 ? (
          <p className={cn("text-xs px-3", isDarkBackground ? "text-white/50" : "text-muted-foreground")}>No collections</p>
        ) : (
          <DndContext
            sensors={dragDisabled ? disabledSensors : sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={collections.map(c => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1">
                {collections.map((collection) => (
                    <SortableCollectionItem
                      key={collection.id}
                      collection={collection}
                      isSelected={selectedId === collection.id}
                      hasSelectedChild={selectedId === collection.id && selectedGroupId !== null}
                      onSelect={() => onSelect(collection)}
                      onShare={onShare ? () => onShare(collection) : undefined}
                      onSelectAccessories={onSelectAccessories ? () => onSelectAccessories(collection) : undefined}
                      onCreateGroup={onCreateGroup}
                      onRename={onRename ? () => onRename(collection) : undefined}
                      onDelete={onDelete ? () => onDelete(collection) : undefined}
                      onBackgroundSettings={onBackgroundSettings ? () => onBackgroundSettings(collection) : undefined}
                      onPin={onPin ? () => onPin(collection) : undefined}
                      isPinned={isPinned ? isPinned(collection.id) : false}
                      pinFull={pinFull}
                      isDarkBackground={isDarkBackground}
                      dragDisabled={dragDisabled}
                      disableContextMenu={disableContextMenu}
                      editMode={editMode}
                    >
                    {/* Groups nested under selected collection */}
                    <AnimatedCollapse open={selectedId === collection.id && hasGroups && groupsExpanded}>
                      <div className="ml-2 space-y-1 pt-1">
                        {groupsContent || (groups || []).map((group) => (
                          <button
                            key={group.id}
                            onClick={(e) => { e.stopPropagation(); onGroupSelect?.(group.id); }}
                            className={`flex w-full items-center gap-2 rounded-[12px] px-3 py-2 text-left text-sm transition-colors ${
                              isDarkBackground
                                ? `text-white ${selectedGroupId === group.id ? 'bg-white/20' : 'hover:bg-white/10'}`
                                : `${selectedGroupId === group.id ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`
                            }`}
                          >
                            <Layers className="h-4 w-4" />
                            <span className="flex-1 truncate">{group.name}</span>
                            {!hideAccessoryCounts && (
                              <span className={`text-xs ${
                                isDarkBackground
                                  ? 'text-white/70'
                                  : selectedGroupId === group.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                              }`}>
                                {groupItemCounts?.[group.id] || 0}
                              </span>
                            )}
                          </button>
                        ))}
                      </div>
                    </AnimatedCollapse>
                    </SortableCollectionItem>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <CreateCollectionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={(collection) => {
          refetch();
          onSelect(collection);
        }}
      />
    </>
  );
}

export { type Collection };
