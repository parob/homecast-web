import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_PUBLIC_ENTITY_ACCESSORIES } from '@/lib/graphql/queries';
import { PUBLIC_ENTITY_SET_CHARACTERISTIC, PUBLIC_ENTITY_SET_SERVICE_GROUP } from '@/lib/graphql/mutations';
import type {
  SharedEntityData,
  HomeKitAccessory,
  HomeKitServiceGroup,
  GetPublicEntityAccessoriesResponse,
  PublicEntitySetCharacteristicResponse,
  PublicEntitySetServiceGroupResponse,
  PublicEntityAccessoriesData,
  HomeLayoutData,
  RoomLayoutData,
} from '@/lib/graphql/types';
import { ErrorWithTrace } from './ErrorWithTrace';
import type { RequestTrace } from '@/lib/types/trace';
import { AreaSummary } from '@/components/summary';
import { AccessoryWidget, ServiceGroupWidget, getRoomIcon, WidgetInteractionContext } from '@/components/widgets';
import {
  useSharedWebSocket,
  applyCharacteristicUpdate,
  applyReachabilityUpdate,
  applyServiceGroupUpdate,
} from '@/hooks/useSharedWebSocket';
import {
  Layers,
  Eye,
  Zap,
  Loader2,
  DoorClosed,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { trackWrite, accessoryKey, groupKey } from '@/lib/pending-writes';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import type { ConnectionQuality } from '@/server/connection-quality';
import { hiddenAccessoriesFor } from '@/lib/accessory-visibility';

interface SharedRoomGroupViewProps {
  entityData: SharedEntityData;
  shareHash: string;
  passcode?: string | null;
  // External sidebar control
  renderSidebar?: (sidebar: React.ReactNode) => void;
  externalSelectedRoom?: string | null;
  onExternalRoomSelect?: (room: string | null) => void;
  onWsStatusChange?: (subscribed: boolean, quality: ConnectionQuality) => void;
  onAccessoriesLoaded?: (meta: { count: number; entityName: string | null; background: any }) => void;
  onRequestPasscodeUpgrade?: () => void;
}

export function SharedRoomGroupView({
  entityData,
  shareHash,
  passcode,
  renderSidebar,
  externalSelectedRoom,
  onExternalRoomSelect,
  onWsStatusChange,
  onAccessoriesLoaded,
  onRequestPasscodeUpgrade,
}: SharedRoomGroupViewProps) {
  const { isDarkBackground } = useBackgroundContext();
  const useExternalSidebar = !!renderSidebar;
  const canControl = entityData.role === 'control';

  const handleDisabledClick = useCallback(() => {
    if (onRequestPasscodeUpgrade) {
      onRequestPasscodeUpgrade();
    } else {
      toast('View only');
    }
  }, [onRequestPasscodeUpgrade]);

  // Parse entity data to get roomIds and group name
  // Only the name is taken from the stored definition now. Its roomIds are
  // hc_ids, which nothing on this side can compare against a relay's live
  // UUIDs — see the grouping below.
  const groupName = useMemo(() => {
    if (!entityData.data) return entityData.entityName || 'Room Group';
    try {
      return JSON.parse(entityData.data).name || entityData.entityName || 'Room Group';
    } catch {
      return entityData.entityName || 'Room Group';
    }
  }, [entityData]);

  // Fetch real accessory data from relay
  const { data: accessoriesData, loading: accessoriesLoading, error: accessoriesError, refetch: refetchAccessories } = useQuery<GetPublicEntityAccessoriesResponse>(
    GET_PUBLIC_ENTITY_ACCESSORIES,
    {
      variables: { shareHash, passcode },
      skip: !shareHash,
      fetchPolicy: 'network-only',
    }
  );

  // Timeout feedback for slow loading
  const [loadingTooLong, setLoadingTooLong] = useState(false);
  useEffect(() => {
    if (!accessoriesLoading) { setLoadingTooLong(false); return; }
    const timer = setTimeout(() => setLoadingTooLong(true), 10000);
    return () => clearTimeout(timer);
  }, [accessoriesLoading]);

  // Parse response data (accessories, serviceGroups, layout)
  const parsedData = useMemo((): PublicEntityAccessoriesData | null => {
    if (!accessoriesData?.publicEntityAccessories) return null;
    try {
      return JSON.parse(accessoriesData.publicEntityAccessories);
    } catch {
      return null;
    }
  }, [accessoriesData]);

  // Extract initial data from parsed response
  const initialAccessories = useMemo((): HomeKitAccessory[] => {
    return parsedData?.accessories || [];
  }, [parsedData]);

  const serviceGroups = useMemo((): HomeKitServiceGroup[] => {
    return parsedData?.serviceGroups || [];
  }, [parsedData]);

  const layout = useMemo((): (HomeLayoutData & { rooms?: Record<string, RoomLayoutData> }) | null => {
    return parsedData?.layout || null;
  }, [parsedData]);

  // Report metadata to parent once data loads
  useEffect(() => {
    if (parsedData && onAccessoriesLoaded) {
      onAccessoriesLoaded({
        count: parsedData.accessories?.length ?? 0,
        entityName: parsedData.entityName ?? null,
        background: (parsedData.layout as any)?.background,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedData]);

  // State for realtime accessories (updated via WebSocket)
  const [realtimeAccessories, setRealtimeAccessories] = useState<HomeKitAccessory[]>([]);

  // Initialize realtime state when initial data loads
  useEffect(() => {
    if (initialAccessories.length > 0) {
      setRealtimeAccessories(initialAccessories);
    }
  }, [initialAccessories]);

  // Use realtime accessories if available, otherwise initial
  const accessories = realtimeAccessories.length > 0 ? realtimeAccessories : initialAccessories;

  // WebSocket for realtime updates
  const {
    isConnected: wsConnected,
    quality: wsQuality,
    isSubscribed: wsSubscribed,
    setOnCharacteristicUpdate,
    setOnReachabilityUpdate,
    setOnServiceGroupUpdate,
  } = useSharedWebSocket(shareHash, passcode);

  // Track optimistic state for toggles/sliders
  const [optimisticValues, setOptimisticValues] = useState<Record<string, any>>({});

  // Set up WebSocket callbacks
  useEffect(() => {
    setOnCharacteristicUpdate((accessoryId, characteristicType, value) => {
      setRealtimeAccessories((prev) =>
        applyCharacteristicUpdate(prev, accessoryId, characteristicType, value)
      );
      // Clear optimistic value since we got the real update
      const key = `${accessoryId}-${characteristicType}`;
      setOptimisticValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    });

    setOnReachabilityUpdate((accessoryId, isReachable) => {
      setRealtimeAccessories((prev) =>
        applyReachabilityUpdate(prev, accessoryId, isReachable)
      );
    });

    setOnServiceGroupUpdate((groupId, _homeId, characteristicType, value) => {
      setRealtimeAccessories((prev) =>
        applyServiceGroupUpdate(prev, serviceGroups, groupId, characteristicType, value)
      );
      // Clear optimistic values for all accessories in the group
      const group = serviceGroups.find(g => g.id === groupId);
      if (group) {
        setOptimisticValues((prev) => {
          const next = { ...prev };
          for (const accId of group.accessoryIds) {
            delete next[`${accId}-${characteristicType}`];
          }
          return next;
        });
      }
    });

    return () => {
      setOnCharacteristicUpdate(null);
      setOnReachabilityUpdate(null);
      setOnServiceGroupUpdate(null);
    };
  }, [setOnCharacteristicUpdate, setOnReachabilityUpdate, setOnServiceGroupUpdate, serviceGroups]);

  // Report WebSocket status to parent for Live indicator
  useEffect(() => {
    onWsStatusChange?.(wsSubscribed, wsQuality);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSubscribed, wsQuality]);

  // Build accessory lookup by ID for service groups
  const accessoryById = useMemo(() => {
    const map = new Map<string, HomeKitAccessory>();
    for (const acc of accessories) {
      map.set(acc.id, acc);
      // Also store normalized ID
      map.set(acc.id.replace(/-/g, '').toLowerCase(), acc);
    }
    return map;
  }, [accessories]);

  // Same reasoning as the accessory grouping below: the group's roomIds are
  // hc_ids and a relay accessory's roomId is a live UUID, so this cannot be
  // decided here. The server restricts service groups to those with a member
  // in the filtered accessory set, which is the same question asked where the
  // identity map actually is. Kept as a memo so the shape below is unchanged.
  const filteredServiceGroups = useMemo(() => {
    return serviceGroups.filter(group =>
      group.accessoryIds.some(accId =>
        accessoryById.has(accId) || accessoryById.has(accId.replace(/-/g, '').toLowerCase())
      )
    );
  }, [serviceGroups, accessoryById]);

  // Build set of accessory IDs that are in service groups (to exclude from individual display)
  const accessoriesInGroups = useMemo(() => {
    const set = new Set<string>();
    for (const group of filteredServiceGroups) {
      for (const accId of group.accessoryIds) {
        set.add(accId.replace(/-/g, '').toLowerCase());
      }
    }
    return set;
  }, [filteredServiceGroups]);

  // Group accessories by room, filtering to only allowed rooms
  const { accessoriesByRoom, serviceGroupsByRoom, roomNames, roomIdToName } = useMemo(() => {
    const byRoom: Record<string, HomeKitAccessory[]> = {};
    const groupsByRoom: Record<string, HomeKitServiceGroup[]> = {};
    const idToName: Record<string, string> = {};

    // Group accessories by room.
    for (const accessory of accessories) {
      const roomName = accessory.roomName || 'Unknown Room';
      const roomId = accessory.roomId || roomName;

      // Deliberately NOT re-filtered by the group's roomIds here. Those come
      // from the stored group definition and are hc_ids; `accessory.roomId`
      // comes straight off the relay and is a live HomeKit UUID. Only the
      // server holds the map between the two, and it has already scoped this
      // payload to exactly the group's rooms — so comparing them again here
      // matched nothing and rendered an empty page over a correct response.

      // Skip accessories that are part of a service group
      const normalizedAccId = accessory.id.replace(/-/g, '').toLowerCase();
      if (accessoriesInGroups.has(normalizedAccId)) {
        continue;
      }

      if (!byRoom[roomName]) {
        byRoom[roomName] = [];
        idToName[roomId] = roomName;
      }
      byRoom[roomName].push(accessory);
    }

    // Assign service groups to rooms based on their first accessory's room
    for (const group of filteredServiceGroups) {
      // Find the room for this group (use first accessory's room)
      let groupRoomName: string | null = null;
      let groupRoomId: string | null = null;
      for (const accId of group.accessoryIds) {
        const acc = accessoryById.get(accId) || accessoryById.get(accId.replace(/-/g, '').toLowerCase());
        if (acc && acc.roomName) {
          groupRoomName = acc.roomName;
          groupRoomId = acc.roomId || acc.roomName;
          break;
        }
      }
      if (groupRoomName) {
        if (!groupsByRoom[groupRoomName]) {
          groupsByRoom[groupRoomName] = [];
        }
        groupsByRoom[groupRoomName].push(group);
        // Ensure room is in the list even if it only has service groups
        if (!byRoom[groupRoomName]) {
          byRoom[groupRoomName] = [];
          if (groupRoomId) {
            idToName[groupRoomId] = groupRoomName;
          }
        }
      }
    }

    // Apply room layout ordering and visibility filtering within each room
    if (layout?.rooms) {
      for (const [roomId, roomLayout] of Object.entries(layout.rooms)) {
        const roomName = idToName[roomId];
        if (!roomName) continue;

        // Filter hidden accessories. A room-group view is a slice of the home
        // view, not a room's own, so it follows the home surface — the same
        // call this file already makes for hidden rooms.
        const hiddenHere = hiddenAccessoriesFor(roomLayout.visibility, 'home');
        if (hiddenHere && hiddenHere.length > 0 && byRoom[roomName]) {
          const hiddenSet = new Set(hiddenHere.map(id => id.toLowerCase().replace(/-/g, '')));
          byRoom[roomName] = byRoom[roomName].filter(a => !hiddenSet.has(a.id.toLowerCase().replace(/-/g, '')));
        }

        // Filter hidden service groups
        if (roomLayout.visibility?.hiddenGroups && roomLayout.visibility.hiddenGroups.length > 0 && groupsByRoom[roomName]) {
          const hiddenSet = new Set(roomLayout.visibility.hiddenGroups.map(id => id.toLowerCase().replace(/-/g, '')));
          groupsByRoom[roomName] = groupsByRoom[roomName].filter(g => !hiddenSet.has(g.id.toLowerCase().replace(/-/g, '')));
        }

        // Apply ordering
        if (byRoom[roomName] && roomLayout.itemOrder) {
          const orderMap = new Map(roomLayout.itemOrder.map((id, i) => [id.toLowerCase().replace(/-/g, ''), i]));
          byRoom[roomName].sort((a, b) => {
            const aOrder = orderMap.get(a.id.toLowerCase().replace(/-/g, '')) ?? Infinity;
            const bOrder = orderMap.get(b.id.toLowerCase().replace(/-/g, '')) ?? Infinity;
            return aOrder - bOrder;
          });
          // Also sort service groups by their first accessory's position
          if (groupsByRoom[roomName]) {
            groupsByRoom[roomName].sort((a, b) => {
              const aFirstAcc = a.accessoryIds[0]?.toLowerCase().replace(/-/g, '');
              const bFirstAcc = b.accessoryIds[0]?.toLowerCase().replace(/-/g, '');
              const aOrder = aFirstAcc ? (orderMap.get(aFirstAcc) ?? Infinity) : Infinity;
              const bOrder = bFirstAcc ? (orderMap.get(bFirstAcc) ?? Infinity) : Infinity;
              return aOrder - bOrder;
            });
          }
        }
      }
    }

    // Get room names, sorted by layout order or alphabetically
    let names = Object.keys(byRoom);
    // Use room group's own roomOrder, falling back to parent home's room order
    const roomOrderSource = (layout?.roomOrder && layout.roomOrder.length > 0) ? layout.roomOrder : (layout as any)?.homeRoomOrder;
    if (roomOrderSource && roomOrderSource.length > 0) {
      const orderMap = new Map(roomOrderSource.map((id: string, i: number) => [id.toLowerCase().replace(/-/g, ''), i]));
      const roomNameToId: Record<string, string> = {};
      for (const [id, name] of Object.entries(idToName)) {
        roomNameToId[name] = id;
      }
      names.sort((a, b) => {
        const aId = roomNameToId[a]?.toLowerCase().replace(/-/g, '') || '';
        const bId = roomNameToId[b]?.toLowerCase().replace(/-/g, '') || '';
        const aOrder = orderMap.get(aId) ?? Infinity;
        const bOrder = orderMap.get(bId) ?? Infinity;
        return aOrder - bOrder;
      });
    } else {
      names.sort();
    }

    return { accessoriesByRoom: byRoom, serviceGroupsByRoom: groupsByRoom, roomNames: names, roomIdToName: idToName };
  }, [accessories, filteredServiceGroups, layout, accessoriesInGroups, accessoryById]);

  // State for selected room (null = show all)
  const [internalSelectedRoom, setInternalSelectedRoom] = useState<string | null>(null);
  const selectedRoom = useExternalSidebar ? externalSelectedRoom ?? null : internalSelectedRoom;
  const setSelectedRoom = useExternalSidebar ? (onExternalRoomSelect ?? (() => {})) : setInternalSelectedRoom;

  // Filter accessories by selected room
  const filteredRoomNames = selectedRoom ? [selectedRoom] : roomNames;

  const [setCharacteristic] = useMutation<PublicEntitySetCharacteristicResponse>(
    PUBLIC_ENTITY_SET_CHARACTERISTIC
  );
  const [setServiceGroup] = useMutation<PublicEntitySetServiceGroupResponse>(
    PUBLIC_ENTITY_SET_SERVICE_GROUP
  );

  const handleToggle = useCallback(
    async (accessoryId: string, characteristicType: string, currentValue: boolean) => {
      if (!canControl) {
        toast.error('View-only access');
        return;
      }

      const newValue = !currentValue;
      const key = `${accessoryId}-${characteristicType}`;

      // Optimistic update
      setOptimisticValues((prev) => ({ ...prev, [key]: newValue }));

      try {
        const result = await trackWrite(accessoryKey(accessoryId), setCharacteristic({
          variables: {
            shareHash,
            accessoryId,
            characteristicType,
            value: JSON.stringify(newValue),
            passcode,
          },
        }));

        if (!result.data?.publicEntitySetCharacteristic.success) {
          // Revert on failure
          setOptimisticValues((prev) => {
            const next = { ...prev };
            delete next[key];
            return next;
          });
          toast.error('Failed to control accessory');
        }
      } catch (err) {
        // Revert on error
        setOptimisticValues((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
        toast.error('Failed to control accessory');
      }
    },
    [canControl, shareHash, passcode, setCharacteristic]
  );

  const handleSlider = useCallback(
    async (accessoryId: string, characteristicType: string, value: number | string | boolean) => {
      if (!canControl) {
        toast.error('View-only access');
        return;
      }

      const key = `${accessoryId}-${characteristicType}`;

      // Optimistic update
      setOptimisticValues((prev) => ({ ...prev, [key]: value }));

      try {
        const result = await trackWrite(accessoryKey(accessoryId), setCharacteristic({
          variables: {
            shareHash,
            accessoryId,
            characteristicType,
            value: JSON.stringify(value),
            passcode,
          },
        }));

        if (!result.data?.publicEntitySetCharacteristic.success) {
          toast.error('Failed to control accessory');
        }
      } catch (err) {
        toast.error('Failed to control accessory');
      }
    },
    [canControl, shareHash, passcode, setCharacteristic]
  );

  const getEffectiveValue = useCallback(
    (accessoryId: string, characteristicType: string, serverValue: any) => {
      const key = `${accessoryId}-${characteristicType}`;
      if (key in optimisticValues) {
        return optimisticValues[key];
      }
      return serverValue;
    },
    [optimisticValues]
  );

  // Get accessories for a service group
  const getGroupAccessories = useCallback((group: HomeKitServiceGroup): HomeKitAccessory[] => {
    return group.accessoryIds
      .map(id => accessoryById.get(id) || accessoryById.get(id.replace(/-/g, '').toLowerCase()))
      .filter((acc): acc is HomeKitAccessory => acc !== undefined);
  }, [accessoryById]);

  // Handle service group toggle - one atomic relay call via publicEntitySetServiceGroup
  const handleGroupToggle = useCallback(
    async (group: HomeKitServiceGroup, newValue: boolean) => {
      if (!canControl) {
        toast.error('View-only access');
        return;
      }

      const groupAccessories = getGroupAccessories(group);

      const touchedKeys: string[] = [];
      for (const accessory of groupAccessories) {
        for (const service of accessory.services || []) {
          for (const char of service.characteristics || []) {
            if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
              const key = `${accessory.id}-${char.characteristicType}`;
              touchedKeys.push(key);
              setOptimisticValues((prev) => ({ ...prev, [key]: newValue }));
              break;
            }
          }
        }
      }

      try {
        await trackWrite([groupKey(group.id), ...group.accessoryIds.map(accessoryKey)], setServiceGroup({
          variables: {
            shareHash,
            groupId: group.id,
            characteristicType: 'on',
            value: JSON.stringify(newValue),
            passcode,
          },
        }));
      } catch (err) {
        setOptimisticValues((prev) => {
          const next = { ...prev };
          for (const key of touchedKeys) {
            delete next[key];
          }
          return next;
        });
        toast.error('Failed to control group');
      }
    },
    [canControl, shareHash, passcode, setServiceGroup, getGroupAccessories]
  );

  // Handle service group slider - one atomic relay call for brightness/hue/etc.
  const handleGroupSlider = useCallback(
    async (group: HomeKitServiceGroup, characteristicType: string, value: number) => {
      if (!canControl) {
        toast.error('View-only access');
        return;
      }

      const groupAccessories = getGroupAccessories(group);

      for (const accessory of groupAccessories) {
        for (const service of accessory.services || []) {
          for (const char of service.characteristics || []) {
            if (char.characteristicType === characteristicType) {
              const key = `${accessory.id}-${char.characteristicType}`;
              setOptimisticValues((prev) => ({ ...prev, [key]: value }));
              break;
            }
          }
        }
      }

      try {
        await trackWrite([groupKey(group.id), ...group.accessoryIds.map(accessoryKey)], setServiceGroup({
          variables: {
            shareHash,
            groupId: group.id,
            characteristicType,
            value: JSON.stringify(value),
            passcode,
          },
        }));
      } catch (err) {
        // Keep optimistic values — WebSocket update will reconcile
      }
    },
    [canControl, shareHash, passcode, setServiceGroup, getGroupAccessories]
  );

  // Check if we have rooms to show in sidebar
  const hasRooms = roomNames.length > 1;

  // Sidebar content
  const sidebarContent = (!accessoriesLoading && !accessoriesError && accessories.length > 0 && hasRooms) ? (
    <nav className="space-y-1">
      {/* Group name header */}
      <button
        onClick={() => setSelectedRoom(null)}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
          isDarkBackground
            ? `text-white ${selectedRoom === null ? 'bg-white/20' : 'hover:bg-white/10'}`
            : selectedRoom === null
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
        )}
        style={{ fontWeight: 400 }}
      >
        <Layers className="h-4 w-4" />
        <span className="flex-1 truncate text-left">{groupName}</span>
      </button>
      {/* Rooms - indented under group */}
      <div className="ml-4 space-y-1 pt-1">
        {roomNames.map((roomName) => {
          const RoomIcon = getRoomIcon(roomName);
          return (
            <button
              key={roomName}
              onClick={() => setSelectedRoom(roomName)}
              className={cn(
                "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
                isDarkBackground
                  ? `text-white ${selectedRoom === roomName ? 'bg-white/20' : 'hover:bg-white/10'}`
                  : selectedRoom === roomName
                    ? "bg-secondary text-secondary-foreground"
                    : "hover:bg-muted"
              )}
              style={{ fontWeight: 400 }}
            >
              <RoomIcon className="h-4 w-4" />
              <span className="flex-1 truncate text-left">{roomName}</span>
            </button>
          );
        })}
      </div>
    </nav>
  ) : null;

  // Pass sidebar to parent if using external sidebar
  useEffect(() => {
    if (renderSidebar) {
      renderSidebar(sidebarContent);
    }
  }, [renderSidebar, sidebarContent, selectedRoom, hasRooms]);

  const interactionContextValue = useMemo(() => ({
    disabled: !canControl,
    onDisabledClick: !canControl ? handleDisabledClick : undefined,
  }), [canControl, handleDisabledClick]);

  // Loading state while fetching accessories
  if (accessoriesLoading) {
    return (
      <div className="space-y-6">
        {/* Access level indicator - inline header */}
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            {canControl ? (
              <>
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-medium">Control Access</span>
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">View Only</span>
              </>
            )}
          </div>
        </div>

        {/* Loading indicator */}
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading room group accessories...</p>
          {loadingTooLong && (
            <div className="mt-3 text-center">
              <p className="text-xs text-muted-foreground">Taking longer than expected. The device may be slow to respond.</p>
              <button onClick={() => refetchAccessories()} className="mt-2 text-xs text-primary hover:underline">Retry</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Error state (device offline, etc.)
  if (accessoriesError || accessories.length === 0) {
    // Apollo Client v4 uses CombinedGraphQLErrors with .errors (not .graphQLErrors)
    const gqlError = (accessoriesError as any)?.errors?.[0] ?? accessoriesError?.graphQLErrors?.[0];
    const trace = gqlError?.extensions?.trace as RequestTrace | undefined;
    return (
      <div className="space-y-6">
        {/* Access level indicator - inline header */}
        <div className="flex items-center gap-3 text-sm">
          <div className="flex items-center gap-2">
            {canControl ? (
              <>
                <Zap className="h-4 w-4 text-primary" />
                <span className="font-medium">Control Access</span>
              </>
            ) : (
              <>
                <Eye className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">View Only</span>
              </>
            )}
          </div>
        </div>

        <ErrorWithTrace
          title="Unable to Load Room Group"
          message="The relay may be offline or unavailable."
          errorMessage={gqlError?.message}
          trace={trace}
        />
      </div>
    );
  }

  return (
    <WidgetInteractionContext.Provider value={interactionContextValue}>
      <div className={cn("flex gap-6", useExternalSidebar && "block")}>
        {/* Sidebar for room selection - only render inline if not using external sidebar */}
        {!useExternalSidebar && hasRooms && (
          <aside className="w-48 shrink-0 hidden md:block">
            <div className="sticky top-4">
              {sidebarContent}
            </div>
          </aside>
        )}

        {/* Main content */}
        <div className="flex-1 space-y-6 min-w-0">
          {/* Area Summary - aggregated sensor readings */}
          <AreaSummary accessories={accessories} isDarkBackground={isDarkBackground} />

          {/* Accessories and service groups grouped by room */}
          {filteredRoomNames.map((roomName) => (
            <div key={roomName} className="space-y-3">
              {!selectedRoom && (
                <h3 className={`text-sm font-semibold ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground/70'}`}>
                  {roomName}
                </h3>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Service groups for this room */}
                {serviceGroupsByRoom[roomName]?.map((group) => (
                  <ServiceGroupWidget
                    key={group.id}
                    group={group}
                    accessories={getGroupAccessories(group)}
                    roomName={roomName}
                    onToggle={(checked) => handleGroupToggle(group, checked)}
                    onSlider={(charType, value) => handleGroupSlider(group, charType, value)}
                    onAccessoryToggle={canControl ? handleToggle : undefined}
                    onAccessorySlider={canControl ? handleSlider : undefined}
                    getEffectiveValue={getEffectiveValue}
                    compact={false}
                    iconStyle={(layout?.iconStyle as 'standard' | 'colourful') || 'colourful'}
                    disabled={!canControl}
                    disableTooltip
                  />
                ))}
                {/* Individual accessories (not in groups) */}
                {accessoriesByRoom[roomName]?.map((accessory) => (
                  <AccessoryWidget
                    key={accessory.id}
                    accessory={accessory}
                    homeName={accessory.homeName}
                    onToggle={canControl ? handleToggle : () => {}}
                    onSlider={canControl ? handleSlider : () => {}}
              // Virtual accessories write arbitrary values — a mode name, a
              // date, a counter — not just slider numbers. Without this the
              // widget's optional-chained onSetValue silently did nothing, so
              // every helper control on a share page looked live and was inert.
              onSetValue={canControl ? handleSlider : undefined}
                    getEffectiveValue={getEffectiveValue}
                    compact={false}
                    iconStyle={(layout?.iconStyle as 'standard' | 'colourful') || 'colourful'}
                    disabled={!canControl}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </WidgetInteractionContext.Provider>
  );
}
