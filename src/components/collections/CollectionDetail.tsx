import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useMutation } from '@apollo/client/react';
import { SET_SERVICE_GROUP } from '@/lib/graphql/queries';
import { UPDATE_COLLECTION, DELETE_COLLECTION } from '@/lib/graphql/mutations';
import type {
  Collection,
  CollectionItem,
  CollectionGroup,
  CollectionPayload,
  GetServiceGroupsResponse,
  SetServiceGroupResponse,
  UpdateCollectionResponse,
  HomeKitAccessory,
  HomeKitServiceGroup,
} from '@/lib/graphql/types';
import { useHomes, useAccessoriesForHomes, updateAccessoryCharacteristicInCache, setServiceGroupsInCache } from '@/hooks/useHomeKitData';
import { NoDeviceConnected } from '@/components/shared/NoDeviceConnected';
import { ErrorWithTrace } from '@/components/shared/ErrorWithTrace';
import { serverConnection } from '@/server/connection';
import { isRelayCapable } from '@/native/homekit-bridge';
import { useWebSocket } from '@/contexts/WebSocketContext';
import { useAccessoryUpdates } from '@/hooks/useAccessoryUpdates';
import { parseCollectionPayload } from '@/lib/graphql/types';
import { AccessoryPicker } from '@/components/AccessoryPicker';
import { ShareDialog } from '@/components/shared/ShareDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { MasonryGrid } from '@/components/MasonryGrid';
import { AreaSummary } from '@/components/summary';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { SliderControl } from '@/components/widgets/shared/SliderControl';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  X,
  Lightbulb,
  Pencil,
  MoreVertical,
  Share2,
  Copy,
  Trash2,
  Loader2,
  Plus,
  FolderPlus,
  ArrowRight,
  RefreshCw,
  Settings,
  WifiOff,
} from 'lucide-react';
import { toast } from 'sonner';
import { AccessoryWidget, getPrimaryServiceType } from '@/components/widgets';
import { ServiceGroupWidget } from '@/components/widgets/ServiceGroupWidget';
import { getIconColor } from '@/components/widgets/iconColors';
import { SortableItem } from '@/components/shared/SortableItem';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  DndContext,
  closestCenter,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  DragOverlay,
  MeasuringStrategy,
  type DragEndEvent,
  type DragStartEvent,
  type DragOverEvent,
  type CollisionDetection,
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

interface CollectionDetailProps {
  collection: Collection;
  onBack: () => void;
  onUpdate: (updatedCollection?: Collection) => void;
  compactMode: boolean;
  onCompactModeChange: (compact: boolean) => void;
  layoutMode: 'grid' | 'masonry';
  onRefresh: () => void;
  onSettingsOpen: () => void;
  collectionItemOrder: Record<string, string[]>;
  onSaveItemOrder: (collectionId: string, order: string[]) => void;
  hideAccessoryCounts: boolean;
  // Controlled state for toolbar buttons (lifted to parent)
  addingGroup: boolean;
  onAddingGroupChange: (adding: boolean) => void;
  addItemsOpen: boolean;
  onAddItemsOpenChange: (open: boolean) => void;
  // Selected group for filtering
  selectedGroupId: string | null;
  // Accessory control handlers
  onToggle: (accessoryId: string, characteristicType: string, currentValue: boolean) => void;
  onSlider: (accessoryId: string, characteristicType: string, value: number) => void;
  getEffectiveValue: (accessoryId: string, characteristicType: string, serverValue: any) => any;
  // Free plan filtering — only show these accessories in the picker
  includedAccessoryIds?: string[] | null;
  // Styling
  isDarkBackground?: boolean;
  iconStyle?: 'standard' | 'colourful';
  // Whether running on a touch-primary device (affects drag sensor type)
  isTouchDevice?: boolean;
  // Edit mode (wiggle animation)
  editMode?: boolean;
  // Called when drag state changes (for parent scroll disable)
  onDragActiveChange?: (isDragging: boolean) => void;
}

// SortableItem imported from shared components - same as Dashboard uses

// Droppable group wrapper for cross-group drag-and-drop
interface DroppableGroupProps {
  id: string;
  children: React.ReactNode;
  isOver?: boolean;
}

function DroppableGroup({ id, children, isOver }: DroppableGroupProps) {
  const { setNodeRef, isOver: isDirectlyOver } = useDroppable({ id: `droppable-${id}` });
  const showHighlight = isOver || isDirectlyOver;

  return (
    <div
      ref={setNodeRef}
      className={`transition-colors rounded-lg p-2 -m-2 min-h-[80px] ${showHighlight ? 'bg-primary/10 ring-2 ring-primary/30' : ''}`}
    >
      {children}
    </div>
  );
}

// Custom collision detection that prioritizes droppable groups
const customCollisionDetection: CollisionDetection = (args) => {
  // First check if pointer is within any droppable group
  const pointerCollisions = pointerWithin(args);
  const droppableCollision = pointerCollisions.find(c =>
    (c.id as string).startsWith('droppable-')
  );

  // If we're over a droppable group, prioritize it
  if (droppableCollision) {
    // But also check for sortable items to enable reordering
    const rectCollisions = rectIntersection(args);
    const sortableCollision = rectCollisions.find(c =>
      !(c.id as string).startsWith('droppable-')
    );

    // If there's a sortable collision, return both (sortable first for reordering)
    if (sortableCollision) {
      return [sortableCollision, droppableCollision];
    }
    return [droppableCollision];
  }

  // Fall back to closestCenter for normal reordering
  return closestCenter(args);
};

export function CollectionDetail({
  collection,
  onBack,
  onUpdate,
  compactMode,
  onCompactModeChange,
  layoutMode,
  onRefresh,
  onSettingsOpen,
  collectionItemOrder,
  onSaveItemOrder,
  hideAccessoryCounts,
  addingGroup,
  onAddingGroupChange,
  addItemsOpen,
  onAddItemsOpenChange,
  selectedGroupId,
  onToggle,
  onSlider,
  getEffectiveValue,
  includedAccessoryIds,
  isDarkBackground,
  iconStyle = 'standard',
  isTouchDevice,
  editMode,
  onDragActiveChange,
}: CollectionDetailProps) {
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [payload, setPayload] = useState<CollectionPayload>(() => parseCollectionPayload(collection.payload));
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [addGroupDialogOpen, setAddGroupDialogOpen] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [renameGroupDialogOpen, setRenameGroupDialogOpen] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);

  // Track which group we're adding items to (when clicking from a specific group's empty state)
  const [addingToGroupId, setAddingToGroupId] = useState<string | null>(null);

  // Click-to-expand state (same pattern as Dashboard)
  const [expandedWidgetId, setExpandedWidgetId] = useState<string | null>(null);
  const collapseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state for cross-group drag-and-drop
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overGroupId, setOverGroupId] = useState<string | null>(null);
  const [activeDragRect, setActiveDragRect] = useState<{ width: number; height: number } | null>(null);

  // Service groups for collection display (fetched for all homes with service group items)
  const [allServiceGroups, setAllServiceGroups] = useState<HomeKitServiceGroup[]>([]);

  // Sharing state for individual accessories and service groups
  const [shareAccessory, setShareAccessory] = useState<{ accessory: HomeKitAccessory; homeId: string } | null>(null);
  const [shareServiceGroup, setShareServiceGroup] = useState<{ group: HomeKitServiceGroup; homeId: string } | null>(null);

  const isMobile = useIsMobile();

  // Click-to-expand handlers (same as Dashboard)
  const handleWidgetClick = useCallback((widgetId: string) => {
    setExpandedWidgetId(prev => prev === widgetId ? null : widgetId);
  }, []);

  const cancelCollapseTimeout = useCallback(() => {
    if (collapseTimeoutRef.current) {
      clearTimeout(collapseTimeoutRef.current);
      collapseTimeoutRef.current = null;
    }
  }, []);

  const handleWidgetMouseLeave = useCallback(() => {
    collapseTimeoutRef.current = setTimeout(() => {
      setExpandedWidgetId(null);
    }, 100);
  }, []);

  const collapseExpandedWidget = useCallback(() => {
    cancelCollapseTimeout();
    setExpandedWidgetId(null);
  }, [cancelCollapseTimeout]);

  // Sync payload state when payload changes from external source (e.g., group reordering in sidebar)
  useEffect(() => {
    setPayload(parseCollectionPayload(collection.payload));
  }, [collection.payload]);

  // Reset dialog states only when switching to a different collection
  useEffect(() => {
    setRenameDialogOpen(false);
    onAddItemsOpenChange(false);
    setShareDialogOpen(false);
    setDeleteDialogOpen(false);
    onAddingGroupChange(false);
    setAddGroupDialogOpen(false);
    setRenameGroupDialogOpen(false);
    setDeleteGroupDialogOpen(false);
    setEditingGroupId(null);
    setExpandedWidgetId(null);
    setAddingToGroupId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id]);

  const [updateCollection] = useMutation<UpdateCollectionResponse>(UPDATE_COLLECTION);
  const [deleteCollection] = useMutation<{ deleteCollection: boolean }>(DELETE_COLLECTION);
  const [setServiceGroup] = useMutation<SetServiceGroupResponse>(SET_SERVICE_GROUP);

  // Fetch service groups for all homes that have service group items in the collection
  useEffect(() => {
    const homeIdsWithGroups = [...new Set(
      payload.items
        .filter(item => item.service_group_id)
        .map(item => item.home_id)
    )];

    if (homeIdsWithGroups.length === 0) {
      setAllServiceGroups([]);
      return;
    }

    // Fetch service groups for each home and combine via relay
    Promise.all(
      homeIdsWithGroups.map(homeId =>
        serverConnection.request<{ serviceGroups: HomeKitServiceGroup[] }>('serviceGroups.list', { homeId })
          .then(result => ({ homeId, serviceGroups: result.serviceGroups || [] }))
          .catch(() => ({ homeId, serviceGroups: [] as HomeKitServiceGroup[] }))
      )
    ).then(results => {
      const groups: HomeKitServiceGroup[] = [];
      for (const { homeId, serviceGroups } of results) {
        // Also set in global cache so updates can find them
        setServiceGroupsInCache(homeId, serviceGroups);
        groups.push(...serviceGroups);
      }
      setAllServiceGroups(groups);
    });
  }, [payload.items]);

  // Subscribe to real-time accessory/service group updates (updates the cache
  // so widgets reflect state changes from broadcasts)
  useAccessoryUpdates(null, null);

  // Subscribe to collection updates (browser mode only)
  const { isConnected: isWebSocketConnected } = useWebSocket();
  useEffect(() => {
    // Don't subscribe if we're the relay (Mac app) or not connected
    if (isRelayCapable() || !isWebSocketConnected) {
      return;
    }

    // Subscribe to this collection
    serverConnection.subscribeToScopes([{ type: 'collection', id: collection.id }]);

    return () => {
      // Unsubscribe when leaving the collection
      serverConnection.unsubscribeFromScopes([{ type: 'collection', id: collection.id }]);
    };
  }, [collection.id, isWebSocketConnected]);

  // DnD sensors — mirror DraggableGrid pattern (pointer for desktop, touch for iOS edit mode)
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
  const disabledSensors = useSensors();
  // Match DraggableGrid sensor pattern: always draggable on desktop, edit-mode-only on touch devices
  const dndEnabled = !isTouchDevice || editMode === true;
  const activeSensors = !dndEnabled ? disabledSensors : isTouchDevice ? touchSensors : pointerSensors;

  // Fetch homes for the picker via relay hooks
  const { data: homesData, loading: homesLoading } = useHomes();

  const homes = homesData ?? [];

  // Extract unique homeIds from collection items - fetch only accessories for homes in this collection
  const collectionHomeIds = useMemo(() => {
    const homeIds = new Set<string>();
    for (const item of payload.items) {
      if (item.home_id) {
        homeIds.add(item.home_id);
      }
    }
    return Array.from(homeIds);
  }, [payload.items]);

  // Detect which homes in this collection have offline or stale relays
  const { staleHomeIds, offlineHomeIds } = useMemo(() => {
    if (homesLoading) return { staleHomeIds: new Set<string>(), offlineHomeIds: new Set<string>() };
    const stale = new Set<string>();
    const offline = new Set<string>();
    const homeMap = new Map(homes.map(h => [h.id, h]));
    for (const homeId of collectionHomeIds) {
      const home = homeMap.get(homeId);
      if (!home) {
        // Home ID not in current homes list — UUID has changed (e.g. HomeKit architecture migration)
        stale.add(homeId);
      } else if (home.relayConnected === false) {
        // Shared home with relay explicitly offline
        offline.add(homeId);
      }
    }
    return { staleHomeIds: stale, offlineHomeIds: offline };
  }, [homes, homesLoading, collectionHomeIds]);

  // Fetch accessories for only the homes in this collection (uses cache for real-time updates)
  const { data: accessoriesData, loading: accessoriesLoading, error: accessoriesError } = useAccessoriesForHomes(collectionHomeIds);
  const accessories = accessoriesData ?? [];

  // Fetch service groups for all homes (for picker when "All Homes" is selected)
  const [allPickerServiceGroups, setAllPickerServiceGroups] = useState<Array<{ group: HomeKitServiceGroup; homeId: string }>>([]);
  // Fetch all accessories for all homes (for picker)
  const [allPickerAccessories, setAllPickerAccessories] = useState<HomeKitAccessory[]>([]);
  const [allPickerAccessoriesLoading, setAllPickerAccessoriesLoading] = useState(false);
  // Use stable key for homes to avoid re-running effect on reference changes
  const homesKey = homes.map(h => h.id).join(',');

  // Fetch all accessories when picker is open
  useEffect(() => {
    if (!addItemsOpen) {
      return;
    }
    if (homes.length === 0) {
      setAllPickerAccessories([]);
      return;
    }
    setAllPickerAccessoriesLoading(true);
    // Fetch accessories for each home via relay
    Promise.all(
      homes.map(home =>
        serverConnection.request<{ accessories: HomeKitAccessory[] }>('accessories.list', { homeId: home.id, includeValues: true })
          .then(result => result.accessories || [])
          .catch(() => [])
      )
    ).then(results => {
      const combined: HomeKitAccessory[] = [];
      for (const accs of results) {
        combined.push(...accs);
      }
      setAllPickerAccessories(combined);
      setAllPickerAccessoriesLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addItemsOpen, homesKey]);

  useEffect(() => {
    if (!addItemsOpen) return;
    if (homes.length === 0) {
      setAllPickerServiceGroups([]);
      return;
    }
    // Fetch service groups for each home via relay
    Promise.all(
      homes.map(home =>
        serverConnection.request<{ serviceGroups: HomeKitServiceGroup[] }>('serviceGroups.list', { homeId: home.id })
          .then(result => ({ homeId: home.id, groups: result.serviceGroups || [] }))
          .catch(() => ({ homeId: home.id, groups: [] }))
      )
    ).then(results => {
      const combined: Array<{ group: HomeKitServiceGroup; homeId: string }> = [];
      for (const { homeId, groups } of results) {
        // Also set in global cache so updates can find them
        setServiceGroupsInCache(homeId, groups);
        for (const group of groups) {
          combined.push({ group, homeId });
        }
      }
      setAllPickerServiceGroups(combined);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addItemsOpen, homesKey]);

  // Free plan filtering — only show allowed accessories/groups in the picker and collection view
  // null = no limit (standard plan), [] = free plan with no selection (show nothing), [...ids] = free plan with selection
  const isFreeFiltered = includedAccessoryIds !== null && includedAccessoryIds !== undefined;
  const includedSet = useMemo(() =>
    isFreeFiltered && includedAccessoryIds!.length > 0 ? new Set(includedAccessoryIds) : null,
    [isFreeFiltered, includedAccessoryIds]
  );

  const filteredPickerAccessories = useMemo(() => {
    if (!isFreeFiltered) return allPickerAccessories;
    if (!includedSet) return []; // Free plan with no selection — show nothing
    return allPickerAccessories.filter(a => includedSet.has(a.id));
  }, [allPickerAccessories, includedSet, isFreeFiltered]);

  // Service groups for picker (filter to groups whose accessories are all allowed)
  const pickerServiceGroups = useMemo(() => {
    const groups = allPickerServiceGroups.map(({ group }) => group);
    if (!isFreeFiltered) return groups;
    if (!includedSet) return []; // Free plan with no selection — show nothing
    return groups.filter(g => g.accessoryIds.some(id => includedSet.has(id)));
  }, [allPickerServiceGroups, includedSet, isFreeFiltered]);

  // Map to get home ID for a service group in the picker
  const serviceGroupHomeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const { group, homeId } of allPickerServiceGroups) {
      map.set(group.id, homeId);
    }
    return map;
  }, [allPickerServiceGroups]);
  const isLoading = homesLoading || accessoriesLoading;

  // Home name lookup (with fallback from stored home_name for stale IDs)
  const homeNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const home of homes) {
      map.set(home.id, home.name);
    }
    // Fallback: use stored home_name from collection items for stale home IDs
    for (const item of payload.items) {
      if (item.home_name && !map.has(item.home_id)) {
        map.set(item.home_id, item.home_name);
      }
    }
    return map;
  }, [homes, payload.items]);
  const getHomeName = useCallback((homeId?: string) => homeId ? homeNameMap.get(homeId) : undefined, [homeNameMap]);

  // Offline/stale relay stats for banner
  const unavailableHomeIds = useMemo(() => {
    const set = new Set<string>();
    offlineHomeIds.forEach(id => set.add(id));
    staleHomeIds.forEach(id => set.add(id));
    return set;
  }, [offlineHomeIds, staleHomeIds]);
  const offlineItemCount = useMemo(() =>
    payload.items.filter(i => unavailableHomeIds.has(i.home_id)).length,
    [payload.items, unavailableHomeIds]
  );
  const allItemsOffline = offlineItemCount > 0 && offlineItemCount === payload.items.length;
  const hasStaleHomes = staleHomeIds.size > 0;
  const offlineHomeNames = useMemo(() =>
    [...unavailableHomeIds].map(id => homeNameMap.get(id)).filter(Boolean) as string[],
    [unavailableHomeIds, homeNameMap]
  );

  // Get currently selected accessory IDs and service group IDs
  const selectedAccessoryIds = useMemo(() =>
    new Set(payload.items.filter(i => i.accessory_id).map(i => i.accessory_id!)),
    [payload.items]
  );

  const selectedServiceGroupIds = useMemo(() =>
    new Set(payload.items.filter(i => i.service_group_id).map(i => i.service_group_id!)),
    [payload.items]
  );

  // Get accessories grouped by group_id
  const accessoriesByGroup = useMemo(() => {
    const result: Record<string, Array<{ item: CollectionItem; accessory: HomeKitAccessory }>> = {
      ungrouped: [],
    };

    // Initialize groups
    for (const group of payload.groups) {
      result[group.id] = [];
    }

    // Sort items into groups
    for (const item of payload.items) {
      const accessory = accessories.find(a => a.id === item.accessory_id);
      if (!accessory) continue;

      const groupId = item.group_id || 'ungrouped';
      if (!result[groupId]) {
        result[groupId] = [];
      }
      result[groupId].push({ item, accessory });
    }

    // Apply saved order within each group
    const savedOrder = collectionItemOrder[collection.id];
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((id, idx) => [id, idx]));
      for (const groupId in result) {
        result[groupId].sort((a, b) => {
          const aIdx = orderMap.get(a.item.accessory_id) ?? Infinity;
          const bIdx = orderMap.get(b.item.accessory_id) ?? Infinity;
          return aIdx - bIdx;
        });
      }
    }

    return result;
  }, [payload.items, payload.groups, accessories, collectionItemOrder, collection.id]);

  // Get service groups grouped by group_id (collection groups)
  const serviceGroupsByGroup = useMemo(() => {
    const result: Record<string, Array<{ item: CollectionItem; serviceGroup: HomeKitServiceGroup }>> = {
      ungrouped: [],
    };

    // Initialize groups
    for (const group of payload.groups) {
      result[group.id] = [];
    }

    // Sort service group items into collection groups
    for (const item of payload.items) {
      if (!item.service_group_id) continue;
      const serviceGroup = allServiceGroups.find(g => g.id === item.service_group_id);
      if (!serviceGroup) continue;

      const groupId = item.group_id || 'ungrouped';
      if (!result[groupId]) {
        result[groupId] = [];
      }
      result[groupId].push({ item, serviceGroup });
    }

    return result;
  }, [payload.items, payload.groups, allServiceGroups]);

  // Combined items (accessories + service groups) sorted together for intermingling
  type CombinedItem =
    | { type: 'accessory'; item: CollectionItem; accessory: HomeKitAccessory }
    | { type: 'serviceGroup'; item: CollectionItem; serviceGroup: HomeKitServiceGroup };

  const combinedItemsByGroup = useMemo(() => {
    const result: Record<string, CombinedItem[]> = {
      ungrouped: [],
    };

    // Initialize groups
    for (const group of payload.groups) {
      result[group.id] = [];
    }

    // Add accessories
    for (const entry of accessoriesByGroup.ungrouped || []) {
      result.ungrouped.push({ type: 'accessory', ...entry });
    }
    for (const group of payload.groups) {
      for (const entry of accessoriesByGroup[group.id] || []) {
        result[group.id].push({ type: 'accessory', ...entry });
      }
    }

    // Add service groups
    for (const entry of serviceGroupsByGroup.ungrouped || []) {
      result.ungrouped.push({ type: 'serviceGroup', ...entry });
    }
    for (const group of payload.groups) {
      for (const entry of serviceGroupsByGroup[group.id] || []) {
        result[group.id].push({ type: 'serviceGroup', ...entry });
      }
    }

    // Apply saved order within each group (intermingled)
    const savedOrder = collectionItemOrder[collection.id];
    if (savedOrder && savedOrder.length > 0) {
      const orderMap = new Map(savedOrder.map((id, idx) => [id, idx]));
      for (const groupId in result) {
        result[groupId].sort((a, b) => {
          const aId = a.type === 'accessory' ? a.item.accessory_id : `sg-${a.serviceGroup.id}`;
          const bId = b.type === 'accessory' ? b.item.accessory_id : `sg-${b.serviceGroup.id}`;
          const aIdx = orderMap.get(aId!) ?? Infinity;
          const bIdx = orderMap.get(bId!) ?? Infinity;
          return aIdx - bIdx;
        });
      }
    }

    return result;
  }, [accessoriesByGroup, serviceGroupsByGroup, payload.groups, collectionItemOrder, collection.id]);

  // Save payload to backend
  const savePayload = async (newPayload: CollectionPayload) => {
    try {
      const result = await updateCollection({
        variables: {
          collectionId: collection.id,
          payload: JSON.stringify(newPayload),
        },
      });
      if (result.data?.updateCollection) {
        onUpdate(result.data.updateCollection);
      } else {
        toast.error('Failed to update');
      }
    } catch {
      toast.error('Failed to update collection');
    }
  };

  // Save name change
  const saveName = async (newName: string) => {
    if (newName === collection.name) return;
    try {
      const result = await updateCollection({
        variables: {
          collectionId: collection.id,
          name: newName,
        },
      });
      if (result.data?.updateCollection) {
        onUpdate(result.data.updateCollection);
      } else {
        toast.error('Failed to update');
      }
    } catch {
      toast.error('Failed to update collection');
    }
  };

  const toggleAccessory = (accessoryId: string) => {
    let newItems: CollectionItem[];
    if (selectedAccessoryIds.has(accessoryId)) {
      newItems = payload.items.filter(i => i.accessory_id !== accessoryId);
    } else {
      // Look up homeId from picker accessories
      const acc = allPickerAccessories.find(a => a.id === accessoryId);
      const homeId = acc?.homeId || '';
      const homeName = homeId ? homeNameMap.get(homeId) : undefined;
      // If viewing a specific group or adding to a specific group, add the accessory to that group
      const newItem: CollectionItem = { home_id: homeId, accessory_id: accessoryId, ...(homeName && { home_name: homeName }) };
      const targetGroupId = addingToGroupId ?? selectedGroupId;
      if (targetGroupId) {
        newItem.group_id = targetGroupId;
      }
      newItems = [...payload.items, newItem];
    }
    const newPayload = { ...payload, items: newItems };
    setPayload(newPayload);
    // Don't save immediately - save when dialog closes to allow multi-select
  };

  const toggleServiceGroup = (groupId: string) => {
    let newItems: CollectionItem[];
    if (selectedServiceGroupIds.has(groupId)) {
      newItems = payload.items.filter(i => i.service_group_id !== groupId);
    } else {
      // Look up homeId from service group map
      const homeId = serviceGroupHomeMap.get(groupId) || '';
      const homeName = homeId ? homeNameMap.get(homeId) : undefined;
      // If viewing a specific collection group or adding to a specific group, add the service group to that group
      const newItem: CollectionItem = { home_id: homeId, service_group_id: groupId, ...(homeName && { home_name: homeName }) };
      const targetGroupId = addingToGroupId ?? selectedGroupId;
      if (targetGroupId) {
        newItem.group_id = targetGroupId;
      }
      newItems = [...payload.items, newItem];
    }
    const newPayload = { ...payload, items: newItems };
    setPayload(newPayload);
    // Don't save immediately - save when dialog closes to allow multi-select
  };

  const removeAccessory = (accessoryId: string) => {
    const newItems = payload.items.filter(i => i.accessory_id !== accessoryId);
    const newPayload = { ...payload, items: newItems };
    setPayload(newPayload);
    savePayload(newPayload);
  };

  const removeServiceGroup = (serviceGroupId: string) => {
    const newItems = payload.items.filter(i => i.service_group_id !== serviceGroupId);
    const newPayload = { ...payload, items: newItems };
    setPayload(newPayload);
    savePayload(newPayload);
  };

  const moveAccessoryToGroup = (accessoryId: string, groupId: string | undefined) => {
    const newItems = payload.items.map(item =>
      item.accessory_id === accessoryId
        ? { ...item, group_id: groupId }
        : item
    );
    const newPayload = { ...payload, items: newItems };
    setPayload(newPayload);
    savePayload(newPayload);
  };

  const moveServiceGroupToGroup = (serviceGroupId: string, groupId: string | undefined) => {
    const newItems = payload.items.map(item =>
      item.service_group_id === serviceGroupId
        ? { ...item, group_id: groupId }
        : item
    );
    const newPayload = { ...payload, items: newItems };
    setPayload(newPayload);
    savePayload(newPayload);
  };

  const createGroup = () => {
    if (!newGroupName.trim()) return;
    const newGroup: CollectionGroup = {
      id: crypto.randomUUID(),
      name: newGroupName.trim(),
    };
    const newPayload = { ...payload, groups: [...payload.groups, newGroup] };
    setPayload(newPayload);
    savePayload(newPayload);
    setNewGroupName('');
    setAddGroupDialogOpen(false);
    onAddingGroupChange(false);
  };

  const deleteGroup = (groupId: string) => {
    // Move all accessories in this group to ungrouped
    const newItems = payload.items.map(item =>
      item.group_id === groupId ? { ...item, group_id: undefined } : item
    );
    const newGroups = payload.groups.filter(g => g.id !== groupId);
    const newPayload = { groups: newGroups, items: newItems };
    setPayload(newPayload);
    savePayload(newPayload);
    setDeleteGroupDialogOpen(false);
    setDeletingGroupId(null);
  };

  const renameGroup = (groupId: string, newName: string) => {
    if (!newName.trim()) return;
    const newGroups = payload.groups.map(g =>
      g.id === groupId ? { ...g, name: newName.trim() } : g
    );
    const newPayload = { ...payload, groups: newGroups };
    setPayload(newPayload);
    savePayload(newPayload);
    setRenameGroupDialogOpen(false);
    setEditingGroupId(null);
    setEditingGroupName('');
  };

  // Service group control utilities
  const getAccessoriesInServiceGroup = useCallback((group: HomeKitServiceGroup) => {
    return accessories.filter(a => group.accessoryIds.includes(a.id));
  }, [accessories]);

  const isServiceGroupOn = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInServiceGroup(group);
    return groupAccessories.some(accessory => {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
            const value = char.value;
            if (value === true || value === 1 || value === '1' || value === 'true') return true;
          }
        }
      }
      return false;
    });
  }, [getAccessoriesInServiceGroup]);

  const isServiceGroupLightGroup = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInServiceGroup(group);
    return groupAccessories.some(acc =>
      acc.services?.some(s => s.serviceType === 'lightbulb') &&
      acc.services?.some(s => s.characteristics?.some(c => c.characteristicType === 'brightness'))
    );
  }, [getAccessoriesInServiceGroup]);

  const getServiceGroupAverageBrightness = useCallback((group: HomeKitServiceGroup) => {
    const groupAccessories = getAccessoriesInServiceGroup(group);
    let total = 0;
    let count = 0;
    for (const accessory of groupAccessories) {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'brightness') {
            const value = char.value !== null && char.value !== undefined ? Number(char.value) : null;
            if (value !== null && !isNaN(value)) {
              total += value;
              count++;
            }
          }
        }
      }
    }
    return count > 0 ? Math.round(total / count) : null;
  }, [getAccessoriesInServiceGroup]);

  const handleServiceGroupToggle = useCallback(async (group: HomeKitServiceGroup, homeId: string) => {
    const isOn = isServiceGroupOn(group);
    const newValue = !isOn;

    // Optimistic update - update all accessories in the group
    for (const accessoryId of group.accessoryIds) {
      updateAccessoryCharacteristicInCache(homeId, accessoryId, 'on', newValue);
    }

    try {
      // Use relay WebSocket for proper broadcast handling
      await serverConnection.request('serviceGroup.set', {
        homeId,
        groupId: group.id,
        characteristicType: 'on',
        value: newValue,
      });
    } catch (err) {
      toast.error('Failed to control group');
      // Revert optimistic update on error
      for (const accessoryId of group.accessoryIds) {
        updateAccessoryCharacteristicInCache(homeId, accessoryId, 'on', isOn);
      }
    }
  }, [isServiceGroupOn]);

  const handleServiceGroupSlider = useCallback(async (group: HomeKitServiceGroup, homeId: string, characteristicType: string, value: number) => {
    // Optimistic update - update all accessories in the group
    for (const accessoryId of group.accessoryIds) {
      updateAccessoryCharacteristicInCache(homeId, accessoryId, characteristicType, value);
    }

    try {
      // Use relay WebSocket for proper broadcast handling
      await serverConnection.request('serviceGroup.set', {
        homeId,
        groupId: group.id,
        characteristicType,
        value,
      });
    } catch (err) {
      toast.error('Failed to control group');
    }
  }, []);

  const handleCopyLink = async () => {
    const shareUrl = `${window.location.origin}/c/${collection.id}`;
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    toast.success('Link copied');
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = async () => {
    try {
      const result = await deleteCollection({
        variables: { collectionId: collection.id },
      });
      if (result.data?.deleteCollection) {
        toast.success('Collection deleted');
        onBack();
        onUpdate();
      } else {
        toast.error('Failed to delete');
      }
    } catch {
      toast.error('Failed to delete');
    }
    setDeleteDialogOpen(false);
  };

  // Handle drag start
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
    onDragActiveChange?.(true);
    // Capture the dragged element's dimensions for the placeholder
    // Use dnd-kit's rect API which is more reliable
    const initialRect = event.active.rect.current.initial;
    if (initialRect && initialRect.width > 0 && initialRect.height > 0) {
      setActiveDragRect({ width: initialRect.width, height: initialRect.height });
    } else {
      // Fallback: try to get from the DOM via the ID
      const activeElement = document.getElementById(String(event.active.id));
      if (activeElement) {
        const rect = activeElement.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setActiveDragRect({ width: rect.width, height: rect.height });
        }
      }
    }
  }, [onDragActiveChange]);

  // Handle drag over (detect which group we're over)
  const handleDragOver = useCallback((event: DragOverEvent) => {
    const { over } = event;
    if (!over) {
      setOverGroupId(null);
      return;
    }

    // Check if over a droppable group container
    const overId = over.id as string;
    if (overId.startsWith('droppable-')) {
      setOverGroupId(overId.replace('droppable-', ''));
    } else if (overId.startsWith('sg-')) {
      // Over a service group - find which collection group it belongs to
      const serviceGroupId = overId.replace('sg-', '');
      const item = payload.items.find(i => i.service_group_id === serviceGroupId);
      setOverGroupId(item?.group_id || 'ungrouped');
    } else {
      // Over an accessory - find which group it belongs to
      const item = payload.items.find(i => i.accessory_id === overId);
      setOverGroupId(item?.group_id || 'ungrouped');
    }
  }, [payload.items]);

  // Handle drag end for reordering and cross-group moves
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    setOverGroupId(null);
    setActiveDragRect(null);
    onDragActiveChange?.(false);

    if (!over) return;

    const activeItemId = active.id as string;
    const overId = over.id as string;

    // Check if dragging a service group or an accessory
    const isServiceGroup = activeItemId.startsWith('sg-');
    const serviceGroupId = isServiceGroup ? activeItemId.replace('sg-', '') : null;

    // Find the active item
    const activeItem = isServiceGroup
      ? payload.items.find(i => i.service_group_id === serviceGroupId)
      : payload.items.find(i => i.accessory_id === activeItemId);
    if (!activeItem) return;

    // Determine target group
    let targetGroupId: string | undefined;
    if (overId.startsWith('droppable-')) {
      // Dropped on a group container
      targetGroupId = overId.replace('droppable-', '');
      if (targetGroupId === 'ungrouped') targetGroupId = undefined;
    } else if (overId !== activeItemId) {
      // Dropped on another item - find that item's group
      let overItem: CollectionItem | undefined;
      if (overId.startsWith('sg-')) {
        const overServiceGroupId = overId.replace('sg-', '');
        overItem = payload.items.find(i => i.service_group_id === overServiceGroupId);
      } else {
        overItem = payload.items.find(i => i.accessory_id === overId);
      }
      targetGroupId = overItem?.group_id;
    } else {
      // Dropped on itself, no change
      return;
    }

    // Check if moving to a different group
    const currentGroupId = activeItem.group_id;
    if (targetGroupId !== currentGroupId) {
      // Move to new group - don't reorder, just move
      if (isServiceGroup && serviceGroupId) {
        moveServiceGroupToGroup(serviceGroupId, targetGroupId);
      } else {
        moveAccessoryToGroup(activeItemId, targetGroupId);
      }
      return;
    }

    // Only reorder if staying within the same group
    // Get all IDs in current order (intermingled accessories + service groups)
    const allIds: string[] = [];
    // Ungrouped items (intermingled)
    for (const entry of combinedItemsByGroup.ungrouped || []) {
      if (entry.type === 'serviceGroup') {
        allIds.push(`sg-${entry.serviceGroup.id}`);
      } else if (entry.item.accessory_id) {
        allIds.push(entry.item.accessory_id);
      }
    }
    // Then each collection group (intermingled)
    for (const group of payload.groups) {
      for (const entry of combinedItemsByGroup[group.id] || []) {
        if (entry.type === 'serviceGroup') {
          allIds.push(`sg-${entry.serviceGroup.id}`);
        } else if (entry.item.accessory_id) {
          allIds.push(entry.item.accessory_id);
        }
      }
    }

    const oldIndex = allIds.indexOf(active.id as string);
    const newIndex = allIds.indexOf(over.id as string);

    if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
      const reordered = arrayMove(allIds, oldIndex, newIndex);
      onSaveItemOrder(collection.id, reordered);
    }
  }, [combinedItemsByGroup, payload.groups, payload.items, collection.id, onSaveItemOrder, moveAccessoryToGroup, moveServiceGroupToGroup, onDragActiveChange]);

  // Get the accessory being dragged for DragOverlay
  const activeAccessory = useMemo(() => {
    if (!activeId || activeId.startsWith('sg-')) return null;
    const item = payload.items.find(i => i.accessory_id === activeId);
    if (!item) return null;
    return accessories.find(a => a.id === item.accessory_id);
  }, [activeId, payload.items, accessories]);

  // Get the service group being dragged for DragOverlay
  const activeServiceGroup = useMemo(() => {
    if (!activeId || !activeId.startsWith('sg-')) return null;
    const serviceGroupId = activeId.replace('sg-', '');
    return allServiceGroups.find(g => g.id === serviceGroupId);
  }, [activeId, allServiceGroups]);

  // Get the collection item for the active service group (for home_id)
  const activeServiceGroupItem = useMemo(() => {
    if (!activeId || !activeId.startsWith('sg-')) return null;
    const serviceGroupId = activeId.replace('sg-', '');
    return payload.items.find(i => i.service_group_id === serviceGroupId);
  }, [activeId, payload.items]);

  // Get roomName and homeName for active service group (for DragOverlay)
  const activeServiceGroupRoomName = useMemo(() => {
    if (!activeServiceGroup) return undefined;
    const groupAccessories = accessories.filter(a => activeServiceGroup.accessoryIds.includes(a.id));
    return groupAccessories[0]?.roomName;
  }, [activeServiceGroup, accessories]);

  const activeServiceGroupHomeName = useMemo(() => {
    if (!activeServiceGroupItem) return undefined;
    return homes.find(h => h.id === activeServiceGroupItem.home_id)?.name;
  }, [activeServiceGroupItem, homes]);

  // Get the group ID of the active (dragged) item
  const activeItemGroupId = useMemo(() => {
    if (!activeId) return null;
    if (activeId.startsWith('sg-')) {
      const serviceGroupId = activeId.replace('sg-', '');
      const item = payload.items.find(i => i.service_group_id === serviceGroupId);
      return item?.group_id || 'ungrouped';
    }
    const item = payload.items.find(i => i.accessory_id === activeId);
    return item?.group_id || 'ungrouped';
  }, [activeId, payload.items]);

  // Grid classes matching Dashboard
  const gridClassName = compactMode
    ? 'gap-2 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6'
    : 'gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';

  // Render a group section with combined items (accessories + service groups intermingled)
  const renderGroupSection = (
    groupId: string,
    groupName: string,
    combinedItems: Array<
      | { type: 'accessory'; item: CollectionItem; accessory: HomeKitAccessory }
      | { type: 'serviceGroup'; item: CollectionItem; serviceGroup: HomeKitServiceGroup }
    >,
    isUngrouped = false
  ) => {
    const totalItems = combinedItems.length;

    // For ungrouped section: skip entirely if empty
    if (isUngrouped && totalItems === 0) return null;

    // Only highlight group when dragging FROM a different group (not when reordering within same group)
    const isDraggingFromDifferentGroup = activeId && activeItemGroupId !== null && activeItemGroupId !== groupId;
    const isGroupOver = isDraggingFromDifferentGroup && overGroupId === groupId;

    // Show placeholder when dragging an item into this group from a different group
    const showDropPlaceholder = isDraggingFromDifferentGroup && overGroupId === groupId;

    // Whether to show the header (hide "Ungrouped" header)
    const showHeader = !isUngrouped;

    const content = (
      <div className={compactMode ? 'space-y-2' : 'space-y-3'}>
        {/* Group header - hidden for ungrouped */}
        {showHeader && (
          <p className={`text-sm font-semibold ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground/70'}`}>
            {groupName}
            {!hideAccessoryCounts && totalItems > 0 && ` (${totalItems})`}
          </p>
        )}

        {/* Group items */}
        {totalItems === 0 && !showDropPlaceholder ? (
          <div className={`rounded-lg border-2 border-dashed p-6 min-h-[100px] flex flex-col items-center justify-center text-center text-sm ${isDarkBackground ? 'bg-black/30 backdrop-blur-xl border-white/20 text-white/70' : 'text-muted-foreground'} ${isGroupOver ? 'border-primary bg-primary/5' : ''}`}>
            <Button
              variant="ghost"
              size="sm"
              className={`h-6 sm:h-7 px-1.5 sm:px-2 gap-1 sm:gap-1.5 ${isDarkBackground ? 'text-white/70 bg-white/10 hover:bg-white/20' : 'text-muted-foreground bg-muted/40 hover:bg-muted/60'}`}
              onClick={() => {
                // Set which group we're adding to (for non-ungrouped groups)
                if (!isUngrouped) {
                  setAddingToGroupId(groupId);
                }
                onAddItemsOpenChange(true);
              }}
            >
              <Plus className="h-3 w-3" />
              <span>Select Accessories</span>
            </Button>
          </div>
        ) : (
          <MasonryGrid
            enabled={layoutMode === 'masonry' && !compactMode && !isMobile}
            compact={compactMode}
            minColumnWidth={290}
            className={
              layoutMode === 'masonry' && !compactMode && !isMobile
                ? ''
                : `grid items-start ${gridClassName}`
            }
          >
            {/* Combined items - intermingled accessories and service groups */}
            {combinedItems.map((entry) => {
              // Calculate disableTransform for both accessories and service groups
              // Disable transforms when dragging between groups to prevent swap animations
              const itemGroupId = entry.item.group_id || 'ungrouped';
              const isInDifferentGroupFromActive = activeItemGroupId !== null && activeItemGroupId !== itemGroupId;
              // Disable for source group items when dragging to a different group
              const isDraggingToOtherGroup = overGroupId !== null && overGroupId !== activeItemGroupId;
              const isSourceGroupItem = activeItemGroupId === itemGroupId;
              const disableTransform = isInDifferentGroupFromActive || (isSourceGroupItem && isDraggingToOtherGroup);

              if (entry.type === 'serviceGroup') {
                const { item, serviceGroup } = entry;
                const groupAccessories = getAccessoriesInServiceGroup(serviceGroup);
                const homeId = item.home_id;

                // Get room name from first accessory in group
                const groupRoomName = groupAccessories[0]?.roomName;

                return (
                  <SortableItem key={`sg-${serviceGroup.id}`} id={`sg-${serviceGroup.id}`} disableTransform={disableTransform}>
                    <div className={editMode ? 'wiggle' : ''} style={editMode ? { '--wiggle-offset': `${(serviceGroup.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined}>
                    <ServiceGroupWidget
                      group={serviceGroup}
                      accessories={groupAccessories}
                      compact={compactMode}
                      homeName={getHomeName(homeId)}
                      roomName={groupRoomName}
                      locationSubtitle={[getHomeName(homeId), groupRoomName].filter(Boolean).join(' · ')}
                      onToggle={() => handleServiceGroupToggle(serviceGroup, homeId)}
                      onSlider={(charType, value) => handleServiceGroupSlider(serviceGroup, homeId, charType, value)}
                      onAccessoryToggle={onToggle}
                      onAccessorySlider={onSlider}
                      getEffectiveValue={getEffectiveValue}
                      disableTooltip={!!activeId}
                      onRemove={() => removeServiceGroup(serviceGroup.id)}
                      removeLabel={item.group_id ? 'Remove from Group' : 'Remove from Collection'}
                      onShare={() => setShareServiceGroup({ group: serviceGroup, homeId })}
                      iconStyle={iconStyle}
                    />
                    </div>
                  </SortableItem>
                );
              }

              // Accessory
              const { item, accessory } = entry;
              const isExpanded = expandedWidgetId === item.accessory_id;

              return (
                <SortableItem key={item.accessory_id} id={item.accessory_id} disableTransform={disableTransform}>
                  <div
                    className={`relative ${compactMode ? 'cursor-pointer' : ''} ${editMode ? 'wiggle' : ''}`}
                    style={editMode ? { '--wiggle-offset': `${(item.accessory_id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined}
                    onClick={compactMode ? () => handleWidgetClick(item.accessory_id) : undefined}
                    onMouseLeave={compactMode ? handleWidgetMouseLeave : undefined}
                  >
                    <AccessoryWidget
                      homeName={getHomeName(accessory.homeId)}
                      accessory={accessory}
                      compact={compactMode}
                      onToggle={onToggle}
                      onSlider={onSlider}
                      getEffectiveValue={getEffectiveValue}
                      disableTooltip={activeId !== null}
                      onRemove={() => removeAccessory(item.accessory_id!)}
                      removeLabel={item.group_id ? 'Remove from Group' : 'Remove from Collection'}
                      onShare={accessory.homeId ? () => setShareAccessory({ accessory, homeId: accessory.homeId! }) : undefined}
                      locationSubtitle={[getHomeName(accessory.homeId), accessory.roomName].filter(Boolean).join(' · ')}
                      iconStyle={iconStyle}
                    />
                    {/* Expanded overlay for compact mode */}
                    {compactMode && (() => {
                      // Get service type - use category for cameras (primary service is often microphone)
                      let serviceType = getPrimaryServiceType(accessory);
                      if (accessory.category?.toLowerCase() === 'camera' || accessory.category?.toLowerCase() === 'ip camera') {
                        serviceType = 'camera';
                      }
                      const iconColor = serviceType ? getIconColor(serviceType) : null;
                      return (
                        <ExpandedOverlay
                          isExpanded={isExpanded}
                          onClose={collapseExpandedWidget}
                          onMouseEnter={cancelCollapseTimeout}
                         
                        >
                          <AccessoryWidget
                            homeName={getHomeName(accessory.homeId)}
                            accessory={accessory}
                            compact={false}
                            onToggle={onToggle}
                            onSlider={onSlider}
                            getEffectiveValue={getEffectiveValue}
                            disableTooltip={activeId !== null}
                            onRemove={() => removeAccessory(item.accessory_id!)}
                            removeLabel={item.group_id ? 'Remove from Group' : 'Remove from Collection'}
                            onShare={accessory.homeId ? () => setShareAccessory({ accessory, homeId: accessory.homeId! }) : undefined}
                            locationSubtitle={[getHomeName(accessory.homeId), accessory.roomName].filter(Boolean).join(' · ')}
                            iconStyle={iconStyle}
                          />
                        </ExpandedOverlay>
                      );
                    })()}
                  </div>
                </SortableItem>
              );
            })}
            {/* Placeholder for incoming item when dragging between groups */}
            {showDropPlaceholder && (
              <div
                className="rounded-[20px] border-2 border-dashed border-primary/50 bg-primary/5 transition-all duration-200"
                style={activeDragRect && activeDragRect.width > 0 ? {
                  width: activeDragRect.width,
                  height: activeDragRect.height,
                } : {
                  // Fallback dimensions if we couldn't capture the original
                  height: compactMode ? 76 : 120,
                }}
              />
            )}
          </MasonryGrid>
        )}
      </div>
    );

    // Always wrap in DroppableGroup for cross-group dragging
    return (
      <DroppableGroup key={groupId} id={groupId} isOver={isGroupOver}>
        {content}
      </DroppableGroup>
    );
  };

  // Collect all sortable IDs for DnD context (intermingled accessories + service groups)
  const allSortableIds = useMemo(() => {
    const ids: string[] = [];
    // Ungrouped items (intermingled)
    for (const entry of combinedItemsByGroup.ungrouped || []) {
      if (entry.type === 'serviceGroup') {
        ids.push(`sg-${entry.serviceGroup.id}`);
      } else if (entry.item.accessory_id) {
        ids.push(entry.item.accessory_id);
      }
    }
    // Then each collection group (intermingled)
    for (const group of payload.groups) {
      for (const entry of combinedItemsByGroup[group.id] || []) {
        if (entry.type === 'serviceGroup') {
          ids.push(`sg-${entry.serviceGroup.id}`);
        } else if (entry.item.accessory_id) {
          ids.push(entry.item.accessory_id);
        }
      }
    }
    return ids;
  }, [combinedItemsByGroup, payload.groups]);

  // Compute accessories for summary - either all collection accessories or just the selected group
  const summaryAccessories = useMemo(() => {
    const result: HomeKitAccessory[] = [];
    const groups = selectedGroupId !== null
      ? [selectedGroupId]
      : ['ungrouped', ...payload.groups.map(g => g.id)];

    for (const groupId of groups) {
      for (const entry of combinedItemsByGroup[groupId] || []) {
        if (entry.type === 'accessory' && entry.accessory) {
          result.push(entry.accessory);
        } else if (entry.type === 'serviceGroup') {
          // Include service group accessories
          const groupAccessories = getAccessoriesInServiceGroup(entry.serviceGroup);
          result.push(...groupAccessories);
        }
      }
    }
    return result;
  }, [combinedItemsByGroup, payload.groups, selectedGroupId, getAccessoriesInServiceGroup]);

  // Show loading state while fetching accessories
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Show error state if accessories fetch failed
  if (accessoriesError) {
    const isNoDevice = accessoriesError.message?.toLowerCase().includes('no relay') ||
                       accessoriesError.message?.toLowerCase().includes('no_device');

    if (isNoDevice) {
      return <NoDeviceConnected variant="inline" />;
    }

    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-destructive font-medium mb-2">Failed to load accessories</p>
        <p className="text-sm text-muted-foreground max-w-md">
          {accessoriesError.message}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 min-h-[28px] sm:min-h-[32px]">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <h2 className={`text-base font-bold truncate ${isDarkBackground ? 'text-white' : 'text-muted-foreground'}`}>
              {selectedGroupId !== null ? (
                <>
                  <span className="opacity-60">{collection.name}</span>
                  <span className="mx-2 opacity-40">/</span>
                  <span>{payload.groups.find(g => g.id === selectedGroupId)?.name || 'Group'}</span>
                </>
              ) : (
                collection.name
              )}
            </h2>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Add Accessories dialog - triggered from toolbar */}
            <Dialog open={addItemsOpen} onOpenChange={(open) => {
              if (!open) {
                // Save any pending changes when dialog closes
                savePayload(payload);
                setAddingToGroupId(null);
              }
              onAddItemsOpenChange(open);
            }}>
              <DialogContent className="max-w-[95%] sm:max-w-[500px] max-h-[85vh] flex flex-col p-0 gap-0" onOpenAutoFocus={(e) => e.preventDefault()}>
                <DialogTitle className="sr-only">Add Items</DialogTitle>
                <AccessoryPicker
                  accessories={filteredPickerAccessories}
                  homes={homes}
                  selectedIds={selectedAccessoryIds}
                  onToggle={toggleAccessory}
                  loading={allPickerAccessoriesLoading}
                  serviceGroups={pickerServiceGroups}
                  selectedServiceGroupIds={selectedServiceGroupIds}
                  onToggleServiceGroup={toggleServiceGroup}
                  serviceGroupHomeMap={serviceGroupHomeMap}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Area Summary - aggregated sensor readings */}
        <AreaSummary
          accessories={summaryAccessories}
          isDarkBackground={isDarkBackground}
        />

        {/* Relay offline/stale banner — full or partial */}
        {allItemsOffline && payload.items.length > 0 ? (
          <ErrorWithTrace
            title={hasStaleHomes ? "Home IDs changed" : "Relay offline"}
            message={hasStaleHomes
              ? "Some items reference homes whose IDs have changed. Reconnecting the relay will auto-repair them."
              : "The relay is not connected. Accessories will be available when the Mac comes back online."}
            className={isDarkBackground ? "bg-black/30 border-white/20" : ""}
            isDarkBackground={isDarkBackground}
          />
        ) : unavailableHomeIds.size > 0 && (
          <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm ${isDarkBackground ? 'bg-white/10 border border-white/10' : 'bg-amber-500/10 border border-amber-500/20'}`}>
            <WifiOff className={`h-4 w-4 shrink-0 ${isDarkBackground ? 'text-amber-400' : 'text-amber-500'}`} />
            <span className={isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}>
              {offlineItemCount} {offlineItemCount === 1 ? 'accessory' : 'accessories'} unavailable
              {hasStaleHomes
                ? ' — home IDs changed, reconnect relay to repair'
                : offlineHomeNames.length > 0
                  ? ` — ${offlineHomeNames.join(' and ')} ${offlineHomeNames.length === 1 ? 'relay' : 'relays'} offline`
                  : ' — relay offline'}
            </span>
          </div>
        )}

        {/* Content */}
        {payload.items.length === 0 && payload.groups.length === 0 ? (
          <div className={`rounded-[20px] border border-dashed p-8 text-center ${isDarkBackground ? 'bg-black/30 backdrop-blur-xl border-white/20' : 'bg-background/80 backdrop-blur-sm'}`}>
            <Lightbulb className={`mx-auto h-12 w-12 ${isDarkBackground ? 'text-white/50' : 'text-muted-foreground/50'}`} />
            <h3 className={`mt-4 text-lg font-medium ${isDarkBackground ? 'text-white' : ''}`}>No accessories in collection</h3>
            <p className={`mt-2 text-sm mb-4 ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground'}`}>
              Select accessories to add to this collection.
            </p>
            <Button
              variant="ghost"
              size="sm"
              className={`h-7 px-3 gap-1.5 ${isDarkBackground ? 'text-white/70 bg-white/10 hover:bg-white/20' : 'text-muted-foreground bg-muted/40 hover:bg-muted/60'}`}
              onClick={() => onAddItemsOpenChange(true)}
            >
              <Plus className="h-3 w-3" />
              Select Accessories
            </Button>
          </div>
        ) : selectedGroupId !== null ? (
          // Filtered view - show only selected group's items with drag-and-drop
          ((combinedItemsByGroup[selectedGroupId] || []).length === 0) ? (
            // Empty group state
            <div className={`rounded-lg border-2 border-dashed p-6 min-h-[100px] flex flex-col items-center justify-center text-center text-sm ${isDarkBackground ? 'bg-black/30 backdrop-blur-xl border-white/20 text-white/70' : 'text-muted-foreground'}`}>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 sm:h-7 px-1.5 sm:px-2 gap-1 sm:gap-1.5 text-muted-foreground bg-muted/40 hover:bg-muted/60"
                onClick={() => onAddItemsOpenChange(true)}
              >
                <Plus className="h-3 w-3" />
                <span>Select Accessories</span>
              </Button>
            </div>
          ) : (
          <div>
            <DndContext
              sensors={activeSensors}
              collisionDetection={customCollisionDetection}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              measuring={measuringConfig}
            >
              <SortableContext
                items={(combinedItemsByGroup[selectedGroupId] || []).map(entry =>
                  entry.type === 'serviceGroup' ? `sg-${entry.serviceGroup.id}` : entry.item.accessory_id!
                )}
                strategy={rectSortingStrategy}
              >
                <MasonryGrid
                enabled={layoutMode === 'masonry' && !compactMode && !isMobile}
                compact={compactMode}
                minColumnWidth={290}
                className={
                  layoutMode === 'masonry' && !compactMode && !isMobile
                    ? ''
                    : `grid items-start ${gridClassName}`
                }
              >
                {/* Combined items - intermingled */}
                {(combinedItemsByGroup[selectedGroupId] || []).map((entry) => {
                  if (entry.type === 'serviceGroup') {
                    const { item, serviceGroup } = entry;
                    const groupAccessories = getAccessoriesInServiceGroup(serviceGroup);
                    const homeId = item.home_id;
                    const groupRoomName = groupAccessories[0]?.roomName;
                    return (
                      <SortableItem key={`sg-${serviceGroup.id}`} id={`sg-${serviceGroup.id}`}>
                        <div className={editMode ? 'wiggle' : ''} style={editMode ? { '--wiggle-offset': `${(serviceGroup.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined}>
                        <ServiceGroupWidget
                          group={serviceGroup}
                          accessories={groupAccessories}
                          compact={compactMode}
                          homeName={getHomeName(homeId)}
                          roomName={groupRoomName}
                          locationSubtitle={[getHomeName(homeId), groupRoomName].filter(Boolean).join(' · ')}
                          onToggle={() => handleServiceGroupToggle(serviceGroup, homeId)}
                          onSlider={(charType, value) => handleServiceGroupSlider(serviceGroup, homeId, charType, value)}
                          onAccessoryToggle={onToggle}
                          onAccessorySlider={onSlider}
                          getEffectiveValue={getEffectiveValue}
                          disableTooltip={!!activeId}
                          onRemove={() => removeServiceGroup(serviceGroup.id)}
                          removeLabel="Remove from Group"
                          onShare={() => setShareServiceGroup({ group: serviceGroup, homeId })}
                          iconStyle={iconStyle}
                        />
                        </div>
                      </SortableItem>
                    );
                  }

                  const { item, accessory } = entry;
                  const isExpanded = expandedWidgetId === item.accessory_id;
                  return (
                    <SortableItem key={item.accessory_id} id={item.accessory_id!}>
                      <div
                        className={`relative ${compactMode ? 'cursor-pointer' : ''} ${editMode ? 'wiggle' : ''}`}
                        style={editMode ? { '--wiggle-offset': `${(item.accessory_id!.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined}
                        onClick={compactMode ? () => handleWidgetClick(item.accessory_id!) : undefined}
                        onMouseLeave={compactMode ? handleWidgetMouseLeave : undefined}
                      >
                        <AccessoryWidget
                          homeName={getHomeName(accessory.homeId)}
                          accessory={accessory}
                          compact={compactMode}
                          onToggle={onToggle}
                          onSlider={onSlider}
                          getEffectiveValue={getEffectiveValue}
                          disableTooltip={activeId !== null}
                          onRemove={() => removeAccessory(item.accessory_id!)}
                          removeLabel="Remove from Group"
                          onShare={accessory.homeId ? () => setShareAccessory({ accessory, homeId: accessory.homeId! }) : undefined}
                          locationSubtitle={[getHomeName(accessory.homeId), accessory.roomName].filter(Boolean).join(' · ')}
                          iconStyle={iconStyle}
                        />
                        {compactMode && (() => {
                          // Get service type - use category for cameras (primary service is often microphone)
                          let serviceType = getPrimaryServiceType(accessory);
                          if (accessory.category?.toLowerCase() === 'camera' || accessory.category?.toLowerCase() === 'ip camera') {
                            serviceType = 'camera';
                          }
                          const iconColor = serviceType ? getIconColor(serviceType) : null;
                          return (
                            <ExpandedOverlay
                              isExpanded={isExpanded}
                              onClose={collapseExpandedWidget}
                              onMouseEnter={cancelCollapseTimeout}
                             
                            >
                              <AccessoryWidget
                                homeName={getHomeName(accessory.homeId)}
                                accessory={accessory}
                                compact={false}
                                onToggle={onToggle}
                                onSlider={onSlider}
                                getEffectiveValue={getEffectiveValue}
                                disableTooltip={activeId !== null}
                                onRemove={() => removeAccessory(item.accessory_id!)}
                                removeLabel="Remove from Group"
                                onShare={accessory.homeId ? () => setShareAccessory({ accessory, homeId: accessory.homeId! }) : undefined}
                                locationSubtitle={[getHomeName(accessory.homeId), accessory.roomName].filter(Boolean).join(' · ')}
                                iconStyle={iconStyle}
                              />
                            </ExpandedOverlay>
                          );
                        })()}
                      </div>
                    </SortableItem>
                  );
                })}
              </MasonryGrid>
            </SortableContext>
            {/* Drag overlay portaled to document.body — prevents scroll offset issues */}
            {createPortal(
              <DragOverlay>
                {activeAccessory && (
                  <div className="relative cursor-grabbing">
                    <AccessoryWidget
                      homeName={getHomeName(activeAccessory.homeId)}
                      accessory={activeAccessory}
                      compact={compactMode}
                      onToggle={onToggle}
                      onSlider={onSlider}
                      getEffectiveValue={getEffectiveValue}
                      disableTooltip={true}
                      locationSubtitle={[getHomeName(activeAccessory.homeId), activeAccessory.roomName].filter(Boolean).join(' · ')}
                      iconStyle={iconStyle}
                    />
                  </div>
                )}
                {activeServiceGroup && (
                  <div className="relative cursor-grabbing">
                    <ServiceGroupWidget
                      group={activeServiceGroup}
                      accessories={getAccessoriesInServiceGroup(activeServiceGroup)}
                      compact={compactMode}
                      roomName={activeServiceGroupRoomName}
                      homeName={activeServiceGroupHomeName}
                      locationSubtitle={[activeServiceGroupHomeName, activeServiceGroupRoomName].filter(Boolean).join(' · ')}
                      onToggle={() => {}}
                      onSlider={() => {}}
                      iconStyle={iconStyle}
                    />
                  </div>
                )}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
          </div>
          )
        ) : (
          // Content with drag-and-drop - drag widgets by their title
          <div>
          <DndContext
            sensors={activeSensors}
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={allSortableIds} strategy={rectSortingStrategy}>
              <div className={compactMode ? 'space-y-4' : 'space-y-6'}>
                {/* Ungrouped items first */}
                {renderGroupSection('ungrouped', 'Ungrouped', combinedItemsByGroup.ungrouped || [], true)}
                {/* Then each group */}
                {payload.groups.map(group =>
                  renderGroupSection(group.id, group.name, combinedItemsByGroup[group.id] || [])
                )}
              </div>
            </SortableContext>
            {/* Drag overlay portaled to document.body — prevents scroll offset issues */}
            {createPortal(
              <DragOverlay>
                {activeAccessory && (
                  <div className="relative cursor-grabbing">
                    <AccessoryWidget
                      homeName={getHomeName(activeAccessory.homeId)}
                      accessory={activeAccessory}
                      compact={compactMode}
                      onToggle={onToggle}
                      onSlider={onSlider}
                      getEffectiveValue={getEffectiveValue}
                      disableTooltip={true}
                      locationSubtitle={[getHomeName(activeAccessory.homeId), activeAccessory.roomName].filter(Boolean).join(' · ')}
                      iconStyle={iconStyle}
                    />
                  </div>
                )}
                {activeServiceGroup && (
                  <div className="relative cursor-grabbing">
                    <ServiceGroupWidget
                      group={activeServiceGroup}
                      accessories={getAccessoriesInServiceGroup(activeServiceGroup)}
                      compact={compactMode}
                      roomName={activeServiceGroupRoomName}
                      homeName={activeServiceGroupHomeName}
                      locationSubtitle={[activeServiceGroupHomeName, activeServiceGroupRoomName].filter(Boolean).join(' · ')}
                      onToggle={() => {}}
                      onSlider={() => {}}
                      iconStyle={iconStyle}
                    />
                  </div>
                )}
              </DragOverlay>,
              document.body
            )}
          </DndContext>
          </div>
        )}
      </div>

      {/* Share Dialog for Collection/Group */}
      <ShareDialog
        entityType={selectedGroupId !== null ? "collection_group" : "collection"}
        entityId={selectedGroupId !== null ? selectedGroupId : collection.id}
        entityName={selectedGroupId !== null ? (payload.groups.find(g => g.id === selectedGroupId)?.name || 'Group') : collection.name}
        homeId={selectedGroupId !== null ? collection.id : undefined}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        onUpdated={onUpdate}
        allAccessories={
          accessories.filter(a => {
            const items = selectedGroupId !== null
              ? payload.items.filter(i => i.group_id === selectedGroupId)
              : payload.items;
            return items.some(i => i.accessory_id === a.id);
          })
        }
      />

      {/* Share Dialog for Accessory */}
      {shareAccessory && (
        <ShareDialog
          entityType="accessory"
          entityId={shareAccessory.accessory.id}
          entityName={shareAccessory.accessory.name}
          homeId={shareAccessory.homeId}
          open={!!shareAccessory}
          onOpenChange={(open) => !open && setShareAccessory(null)}
          availableCharacteristics={shareAccessory.accessory.services?.flatMap(s => s.characteristics?.map(c => c.characteristicType) || []) || []}
        />
      )}

      {/* Share Dialog for Service Group (Accessory Group) */}
      {shareServiceGroup && (
        <ShareDialog
          entityType="accessory_group"
          entityId={shareServiceGroup.group.id}
          entityName={shareServiceGroup.group.name}
          homeId={shareServiceGroup.homeId}
          open={!!shareServiceGroup}
          onOpenChange={(open) => !open && setShareServiceGroup(null)}
          availableCharacteristics={
            accessories
              .filter(a => shareServiceGroup.group.accessoryIds.includes(a.id))
              .flatMap(a => a.services?.flatMap(s => s.characteristics?.map(c => c.characteristicType) || []) || [])
          }
        />
      )}

      {/* Delete Collection Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this collection and remove access for anyone you've shared it with.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Collection Dialog */}
      <Dialog open={renameDialogOpen} onOpenChange={(open) => {
        setRenameDialogOpen(open);
        if (!open) setRenameValue('');
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Collection</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Collection name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && renameValue.trim()) {
                  saveName(renameValue.trim());
                  setRenameDialogOpen(false);
                  setRenameValue('');
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setRenameDialogOpen(false);
                setRenameValue('');
              }}>
                Cancel
              </Button>
              <Button onClick={() => {
                if (renameValue.trim()) {
                  saveName(renameValue.trim());
                  setRenameDialogOpen(false);
                  setRenameValue('');
                }
              }}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add Group Dialog */}
      <Dialog open={addGroupDialogOpen || addingGroup} onOpenChange={(open) => {
        setAddGroupDialogOpen(open);
        onAddingGroupChange(open);
        if (!open) setNewGroupName('');
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Group name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newGroupName.trim()) {
                  createGroup();
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setAddGroupDialogOpen(false);
                onAddingGroupChange(false);
                setNewGroupName('');
              }}>
                Cancel
              </Button>
              <Button onClick={createGroup} disabled={!newGroupName.trim()}>
                Add Group
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Group Dialog */}
      <Dialog open={renameGroupDialogOpen} onOpenChange={(open) => {
        setRenameGroupDialogOpen(open);
        if (!open) {
          setEditingGroupId(null);
          setEditingGroupName('');
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename Group</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Input
              value={editingGroupName}
              onChange={(e) => setEditingGroupName(e.target.value)}
              placeholder="Group name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && editingGroupName.trim() && editingGroupId) {
                  renameGroup(editingGroupId, editingGroupName);
                }
              }}
            />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => {
                setRenameGroupDialogOpen(false);
                setEditingGroupId(null);
                setEditingGroupName('');
              }}>
                Cancel
              </Button>
              <Button onClick={() => {
                if (editingGroupName.trim() && editingGroupId) {
                  renameGroup(editingGroupId, editingGroupName);
                }
              }} disabled={!editingGroupName.trim()}>
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete Group Confirmation */}
      <AlertDialog open={deleteGroupDialogOpen} onOpenChange={(open) => {
        setDeleteGroupDialogOpen(open);
        if (!open) setDeletingGroupId(null);
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the group. Accessories in this group will be moved to ungrouped.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletingGroupId && deleteGroup(deletingGroupId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
