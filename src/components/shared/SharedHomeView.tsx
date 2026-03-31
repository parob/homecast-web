import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_PUBLIC_ENTITY_ACCESSORIES } from '@/lib/graphql/queries';
import { PUBLIC_ENTITY_SET_CHARACTERISTIC } from '@/lib/graphql/mutations';
import type {
  SharedEntityData,
  HomeKitAccessory,
  HomeKitServiceGroup,
  GetPublicEntityAccessoriesResponse,
  PublicEntitySetCharacteristicResponse,
  PublicEntityAccessoriesData,
  HomeLayoutData,
  RoomLayoutData,
  BackgroundSettings,
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
  Home,
  House,
  Eye,
  Zap,
  Loader2,
  DoorClosed,
  ChevronDown,
  ChevronRight,
  Layers,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

interface SharedHomeViewProps {
  entityData: SharedEntityData;
  shareHash: string;
  passcode?: string | null;
  // External sidebar control
  renderSidebar?: (sidebar: React.ReactNode) => void;
  externalSelectedRoom?: string | null;
  onExternalRoomSelect?: (room: string | null) => void;
  // Callback to report WebSocket subscription status to parent
  onWsStatusChange?: (subscribed: boolean) => void;
  // Callback to report loaded accessories metadata to parent
  onAccessoriesLoaded?: (meta: { count: number; entityName: string | null; background: BackgroundSettings | undefined }) => void;
  onRequestPasscodeUpgrade?: () => void;
}

export function SharedHomeView({
  entityData,
  shareHash,
  passcode,
  renderSidebar,
  externalSelectedRoom,
  onExternalRoomSelect,
  onWsStatusChange,
  onAccessoriesLoaded,
  onRequestPasscodeUpgrade,
}: SharedHomeViewProps) {
  const useExternalSidebar = !!renderSidebar;
  const canControl = entityData.role === 'control';

  const handleDisabledClick = useCallback(() => {
    if (onRequestPasscodeUpgrade) {
      onRequestPasscodeUpgrade();
    } else {
      toast('View only');
    }
  }, [onRequestPasscodeUpgrade]);

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

  const layout = useMemo((): (HomeLayoutData & { rooms?: Record<string, RoomLayoutData>; roomGroups?: Array<{ id: string; name: string; roomIds: string[]; layout?: Record<string, any> }> }) | null => {
    return parsedData?.layout || null;
  }, [parsedData]);

  // Read dark mode from MainLayout's BackgroundContext (which has correct imageLuminance)
  const { isDarkBackground } = useBackgroundContext();

  // Report metadata to parent once data loads
  useEffect(() => {
    if (parsedData && onAccessoriesLoaded) {
      onAccessoriesLoaded({
        count: parsedData.accessories?.length ?? 0,
        entityName: parsedData.entityName ?? null,
        background: parsedData.layout?.background as BackgroundSettings | undefined,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsedData]);

  // Room group expand/collapse state (all expanded by default)
  const [expandedRoomGroups, setExpandedRoomGroups] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (layout?.roomGroups) {
      setExpandedRoomGroups(new Set(layout.roomGroups.map(g => g.id)));
    }
  }, [layout?.roomGroups]);

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

  // Get home name (try parsed response entityName first, then entityData, then from accessories)
  const homeName = useMemo(() => {
    // First try entityName from parsed accessories response
    if (parsedData?.entityName) return parsedData.entityName;
    // Then try entityData.entityName from public_entity query
    if (entityData.entityName) return entityData.entityName;
    // Try to get from first accessory
    if (accessories.length > 0 && accessories[0].homeName) {
      return accessories[0].homeName;
    }
    // Try to extract from entity.data
    if (entityData.data) {
      try {
        const data = JSON.parse(entityData.data);
        if (data?.name) return data.name;
      } catch {
        // ignore
      }
    }
    return 'Home';
  }, [parsedData?.entityName, entityData.entityName, entityData.data, accessories]);

  // WebSocket for realtime updates
  const {
    isConnected: wsConnected,
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
    onWsStatusChange?.(wsSubscribed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSubscribed]);

  // Build accessory lookup by ID for service groups
  const accessoryById = useMemo(() => {
    const map = new Map<string, HomeKitAccessory>();
    for (const acc of accessories) {
      map.set(acc.id, acc);
      map.set(acc.id.replace(/-/g, '').toLowerCase(), acc);
    }
    return map;
  }, [accessories]);

  // Build set of accessory IDs that are in service groups
  const accessoriesInGroups = useMemo(() => {
    const set = new Set<string>();
    for (const group of serviceGroups) {
      for (const accId of group.accessoryIds) {
        set.add(accId.replace(/-/g, '').toLowerCase());
      }
    }
    return set;
  }, [serviceGroups]);

  // Get accessories for a service group
  const getGroupAccessories = useCallback((group: HomeKitServiceGroup): HomeKitAccessory[] => {
    return group.accessoryIds
      .map(id => accessoryById.get(id) || accessoryById.get(id.replace(/-/g, '').toLowerCase()))
      .filter((acc): acc is HomeKitAccessory => acc !== undefined);
  }, [accessoryById]);

  // Group accessories by room, with layout-based ordering
  const { accessoriesByRoom, serviceGroupsByRoom, roomNames, roomNameToId } = useMemo(() => {
    const byRoom: Record<string, HomeKitAccessory[]> = {};
    const groupsByRoom: Record<string, HomeKitServiceGroup[]> = {};
    const roomIdToName: Record<string, string> = {};

    // Group accessories by room (excluding those in service groups)
    for (const accessory of accessories) {
      const roomName = accessory.roomName || 'Unknown Room';
      const roomId = accessory.roomId || roomName;

      if (!roomIdToName[roomId]) {
        roomIdToName[roomId] = roomName;
      }

      // Skip accessories that are part of a service group
      const normalizedAccId = accessory.id.replace(/-/g, '').toLowerCase();
      if (accessoriesInGroups.has(normalizedAccId)) {
        // Still register the room even if accessory is in a group
        if (!byRoom[roomName]) {
          byRoom[roomName] = [];
        }
        continue;
      }

      if (!byRoom[roomName]) {
        byRoom[roomName] = [];
      }
      byRoom[roomName].push(accessory);
    }

    // Assign service groups to rooms based on their first accessory's room
    for (const group of serviceGroups) {
      let groupRoomName: string | null = null;
      for (const accId of group.accessoryIds) {
        const acc = accessoryById.get(accId) || accessoryById.get(accId.replace(/-/g, '').toLowerCase());
        if (acc && acc.roomName) {
          groupRoomName = acc.roomName;
          break;
        }
      }
      if (groupRoomName) {
        if (!groupsByRoom[groupRoomName]) {
          groupsByRoom[groupRoomName] = [];
        }
        groupsByRoom[groupRoomName].push(group);
        // Ensure room exists in byRoom even if it only has groups
        if (!byRoom[groupRoomName]) {
          byRoom[groupRoomName] = [];
        }
      }
    }

    // Apply room layout ordering and visibility filtering within each room
    if (layout?.rooms) {
      for (const [roomId, roomLayout] of Object.entries(layout.rooms)) {
        const roomName = roomIdToName[roomId];
        if (!roomName) continue;

        // Filter hidden accessories
        if (roomLayout.visibility?.hiddenAccessories && roomLayout.visibility.hiddenAccessories.length > 0 && byRoom[roomName]) {
          const hiddenSet = new Set(roomLayout.visibility.hiddenAccessories.map(id => id.toLowerCase().replace(/-/g, '')));
          byRoom[roomName] = byRoom[roomName].filter(a => !hiddenSet.has(a.id.toLowerCase().replace(/-/g, '')));
        }

        // Filter hidden service groups
        if (roomLayout.visibility?.hiddenGroups && roomLayout.visibility.hiddenGroups.length > 0 && groupsByRoom[roomName]) {
          const hiddenSet = new Set(roomLayout.visibility.hiddenGroups.map(id => id.toLowerCase().replace(/-/g, '')));
          groupsByRoom[roomName] = groupsByRoom[roomName].filter(g => !hiddenSet.has(g.id.toLowerCase().replace(/-/g, '')));
        }

        // Apply ordering
        if (roomLayout.itemOrder) {
          const orderMap = new Map(roomLayout.itemOrder.map((id, i) => [id.toLowerCase().replace(/-/g, ''), i]));
          if (byRoom[roomName]) {
            byRoom[roomName].sort((a, b) => {
              const aOrder = orderMap.get(a.id.toLowerCase().replace(/-/g, '')) ?? Infinity;
              const bOrder = orderMap.get(b.id.toLowerCase().replace(/-/g, '')) ?? Infinity;
              return aOrder - bOrder;
            });
          }
          // Sort service groups by first accessory position
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
    if (layout?.roomOrder && layout.roomOrder.length > 0) {
      // Create order map from layout
      const orderMap = new Map(layout.roomOrder.map((id, i) => [id.toLowerCase().replace(/-/g, ''), i]));
      // Create roomId to roomName mapping for ordering
      const roomNameToId: Record<string, string> = {};
      for (const [id, name] of Object.entries(roomIdToName)) {
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

    // Filter hidden rooms
    if (layout?.visibility?.hiddenRooms && layout.visibility.hiddenRooms.length > 0) {
      const hiddenSet = new Set(layout.visibility.hiddenRooms.map(id => id.toLowerCase().replace(/-/g, '')));
      const roomNameToId: Record<string, string> = {};
      for (const [id, name] of Object.entries(roomIdToName)) {
        roomNameToId[name] = id;
      }
      names = names.filter(name => {
        const roomId = roomNameToId[name]?.toLowerCase().replace(/-/g, '') || '';
        return !hiddenSet.has(roomId);
      });
    }

    // Build reverse mapping for room background lookups
    const nameToId: Record<string, string> = {};
    for (const [id, name] of Object.entries(roomIdToName)) {
      nameToId[name] = id;
    }

    return { accessoriesByRoom: byRoom, serviceGroupsByRoom: groupsByRoom, roomNames: names, roomNameToId: nameToId };
  }, [accessories, serviceGroups, accessoryById, accessoriesInGroups, layout]);

  // Mutation for setting characteristics (must be before callbacks that use it)
  const [setCharacteristic] = useMutation<PublicEntitySetCharacteristicResponse>(
    PUBLIC_ENTITY_SET_CHARACTERISTIC
  );

  // Handle service group toggle - toggle all accessories in the group
  const handleGroupToggle = useCallback(
    async (group: HomeKitServiceGroup, newValue: boolean) => {
      if (!canControl) {
        toast.error('View-only access');
        return;
      }

      const groupAccessories = getGroupAccessories(group);

      for (const accessory of groupAccessories) {
        for (const service of accessory.services || []) {
          for (const char of service.characteristics || []) {
            if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
              const key = `${accessory.id}-${char.characteristicType}`;
              setOptimisticValues((prev) => ({ ...prev, [key]: newValue }));

              try {
                await setCharacteristic({
                  variables: {
                    shareHash,
                    accessoryId: accessory.id,
                    characteristicType: char.characteristicType,
                    value: JSON.stringify(newValue),
                    passcode,
                  },
                });
              } catch (err) {
                setOptimisticValues((prev) => {
                  const next = { ...prev };
                  delete next[key];
                  return next;
                });
              }
              break;
            }
          }
        }
      }
    },
    [canControl, shareHash, passcode, setCharacteristic, getGroupAccessories]
  );

  // Handle service group slider - set all accessories in the group
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

              try {
                await setCharacteristic({
                  variables: {
                    shareHash,
                    accessoryId: accessory.id,
                    characteristicType,
                    value: JSON.stringify(value),
                    passcode,
                  },
                });
              } catch (err) {
                // Keep optimistic value, WebSocket will correct
              }
              break;
            }
          }
        }
      }
    },
    [canControl, shareHash, passcode, setCharacteristic, getGroupAccessories]
  );

  // State for selected room (null = show all)
  const [internalSelectedRoom, setInternalSelectedRoom] = useState<string | null>(null);
  const selectedRoom = useExternalSidebar ? externalSelectedRoom ?? null : internalSelectedRoom;
  const setSelectedRoom = useExternalSidebar ? (onExternalRoomSelect ?? (() => {})) : setInternalSelectedRoom;

  // Filter accessories by selected room
  const filteredRoomNames = selectedRoom ? [selectedRoom] : roomNames;

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
        const result = await setCharacteristic({
          variables: {
            shareHash,
            accessoryId,
            characteristicType,
            value: JSON.stringify(newValue),
            passcode,
          },
        });

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
    async (accessoryId: string, characteristicType: string, value: number) => {
      if (!canControl) {
        toast.error('View-only access');
        return;
      }

      const key = `${accessoryId}-${characteristicType}`;

      // Optimistic update
      setOptimisticValues((prev) => ({ ...prev, [key]: value }));

      try {
        const result = await setCharacteristic({
          variables: {
            shareHash,
            accessoryId,
            characteristicType,
            value: JSON.stringify(value),
            passcode,
          },
        });

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

  // Check if we have rooms to show in sidebar (computed before early returns for hooks consistency)
  const hasRooms = roomNames.length > 1;

  // Sidebar content - computed before early returns to ensure hooks are called consistently
  const sidebarContent = (!accessoriesLoading && !accessoriesError && accessories.length > 0 && hasRooms) ? (
    <nav className="space-y-1">
      {/* Home name header */}
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
        <House className="h-4 w-4" />
        <span className="flex-1 truncate text-left" style={{ fontWeight: 400 }}>{homeName}</span>
      </button>
      {/* Rooms - indented under home */}
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

  // Pass sidebar to parent if using external sidebar - must be called before any early returns
  useEffect(() => {
    if (renderSidebar) {
      renderSidebar(sidebarContent);
    }
  }, [renderSidebar, sidebarContent, selectedRoom, hasRooms]);

  const interactionContextValue = useMemo(() => ({
    disabled: !canControl,
    onDisabledClick: !canControl ? handleDisabledClick : undefined,
  }), [canControl, handleDisabledClick]);

  // Build room groups structure for rendering (must be before early returns)
  const roomGroupsData = useMemo(() => {
    if (!layout?.roomGroups || layout.roomGroups.length === 0) return null;

    // Build set of rooms that belong to a group
    const roomsInGroups = new Set<string>();
    for (const group of layout.roomGroups) {
      for (const roomId of group.roomIds) {
        roomsInGroups.add(roomId.toLowerCase().replace(/-/g, ''));
      }
    }

    // Map room IDs to room names
    const groups = layout.roomGroups.map(group => ({
      ...group,
      roomNames: group.roomIds
        .map(id => {
          const normalizedId = id.toLowerCase().replace(/-/g, '');
          for (const [name, roomId] of Object.entries(roomNameToId)) {
            if (roomId.toLowerCase().replace(/-/g, '') === normalizedId) return name;
          }
          return null;
        })
        .filter((n): n is string => n !== null && filteredRoomNames.includes(n)),
    }));

    // Rooms not in any group
    const ungroupedRooms = filteredRoomNames.filter(name => {
      const id = roomNameToId[name];
      return !id || !roomsInGroups.has(id.toLowerCase().replace(/-/g, ''));
    });

    return { groups: groups.filter(g => g.roomNames.length > 0), ungroupedRooms };
  }, [layout?.roomGroups, filteredRoomNames, roomNameToId]);

  const toggleRoomGroup = useCallback((groupId: string) => {
    setExpandedRoomGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

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
          <p className="mt-4 text-sm text-muted-foreground">Loading home accessories...</p>
          {loadingTooLong && (
            <div className="mt-3 text-center">
              <p className="text-xs text-muted-foreground">Taking longer than expected. The device may be slow to respond.</p>
              <button
                onClick={() => refetchAccessories()}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Retry
              </button>
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
          title="Unable to Load Home"
          message="The relay may be offline or unavailable."
          errorMessage={gqlError?.message}
          trace={trace}
        />
      </div>
    );
  }

  // Render a room's accessories
  const renderRoom = (roomName: string) => (
    <div key={roomName} className="space-y-3">
      {!selectedRoom && (
        <h3 className={`text-sm font-semibold ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground/70'}`}>
          {roomName}
        </h3>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
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
            iconStyle="standard"
            disabled={!canControl}
            disableTooltip
          />
        ))}
        {accessoriesByRoom[roomName]?.map((accessory) => (
          <AccessoryWidget
            key={accessory.id}
            accessory={accessory}
            homeName={accessory.homeName}
            onToggle={canControl ? handleToggle : () => {}}
            onSlider={canControl ? handleSlider : () => {}}
            getEffectiveValue={getEffectiveValue}
            compact={false}
            iconStyle="standard"
            disabled={!canControl}
          />
        ))}
      </div>
    </div>
  );

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

          {/* Render with room groups if available, otherwise flat rooms */}
          {roomGroupsData && !selectedRoom ? (
            <>
              {/* Ungrouped rooms first */}
              {roomGroupsData.ungroupedRooms.map(renderRoom)}

              {/* Room groups */}
              {roomGroupsData.groups.map((group) => {
                const isExpanded = expandedRoomGroups.has(group.id);
                return (
                  <div key={group.id} className="space-y-3">
                    <button
                      onClick={() => toggleRoomGroup(group.id)}
                      className={`flex items-center gap-2 text-sm font-semibold transition-colors ${isDarkBackground ? 'text-white/70 hover:text-white' : 'text-muted-foreground/70 hover:text-muted-foreground'}`}
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      <Layers className="h-4 w-4" />
                      {group.name}
                    </button>
                    {isExpanded && (
                      <div className="space-y-6">
                        {group.roomNames.map(renderRoom)}
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            filteredRoomNames.map(renderRoom)
          )}
        </div>
      </div>
    </WidgetInteractionContext.Provider>
  );
}
