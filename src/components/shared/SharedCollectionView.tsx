import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_PUBLIC_ENTITY_ACCESSORIES } from '@/lib/graphql/queries';
import { PUBLIC_ENTITY_SET_CHARACTERISTIC } from '@/lib/graphql/mutations';
import type {
  SharedEntityData,
  CollectionPayload,
  CollectionItem,
  HomeKitAccessory,
  HomeKitServiceGroup,
  GetPublicEntityAccessoriesResponse,
  PublicEntitySetCharacteristicResponse,
  PublicEntityAccessoriesData,
  CollectionLayoutData,
} from '@/lib/graphql/types';
import { parseCollectionPayload } from '@/lib/graphql/types';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorWithTrace } from './ErrorWithTrace';
import type { RequestTrace } from '@/lib/types/trace';
import { AreaSummary } from '@/components/summary';
import { AccessoryWidget, ServiceGroupWidget, WidgetInteractionContext } from '@/components/widgets';
import {
  useSharedWebSocket,
  applyCharacteristicUpdate,
  applyReachabilityUpdate,
  applyServiceGroupUpdate,
} from '@/hooks/useSharedWebSocket';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import {
  FolderOpen,
  Lightbulb,
  Users,
  Eye,
  Zap,
  Loader2,
  Layers,
  Folder,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SharedCollectionViewProps {
  entityData: SharedEntityData;
  shareHash: string;
  passcode?: string | null;
  // External sidebar control
  renderSidebar?: (sidebar: React.ReactNode) => void;
  externalSelectedGroup?: string | null;
  onExternalGroupSelect?: (group: string | null) => void;
  onWsStatusChange?: (subscribed: boolean) => void;
  onAccessoriesLoaded?: (meta: { count: number; entityName: string | null; background: any }) => void;
  onRequestPasscodeUpgrade?: () => void;
}

interface ParsedCollectionData {
  payload: string;
  settings_json?: string;
}

export function SharedCollectionView({
  entityData,
  shareHash,
  passcode,
  renderSidebar,
  externalSelectedGroup,
  onExternalGroupSelect,
  onWsStatusChange,
  onAccessoriesLoaded,
  onRequestPasscodeUpgrade,
}: SharedCollectionViewProps) {
  const useExternalSidebar = !!renderSidebar;
  const canControl = entityData.role === 'control';

  const handleDisabledClick = useCallback(() => {
    if (onRequestPasscodeUpgrade) {
      onRequestPasscodeUpgrade();
    } else {
      toast('View only');
    }
  }, [onRequestPasscodeUpgrade]);

  // Parse collection data from entity (for structure: groups, item order)
  const collectionData: ParsedCollectionData | null = useMemo(() => {
    if (!entityData.data) return null;
    try {
      return JSON.parse(entityData.data);
    } catch {
      return null;
    }
  }, [entityData.data]);

  const payload = useMemo(() => {
    if (!collectionData?.payload) return { groups: [], items: [] };
    return parseCollectionPayload(collectionData.payload);
  }, [collectionData]);

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

  const collectionLayout = useMemo((): CollectionLayoutData | null => {
    return parsedData?.layout as CollectionLayoutData || null;
  }, [parsedData]);

  // Read dark mode from MainLayout's BackgroundContext (which has correct imageLuminance)
  const { hasBackground, isDarkBackground } = useBackgroundContext();
  const isLightBackground = hasBackground && !isDarkBackground;

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

  // Get collection name (try parsedData.entityName first, then entityData.entityName, then extract from data)
  const collectionName = useMemo(() => {
    if (parsedData?.entityName) return parsedData.entityName;
    if (entityData.entityName) return entityData.entityName;
    // Try to extract name from parsed data
    if (collectionData && 'name' in collectionData) {
      return (collectionData as any).name;
    }
    return 'Collection';
  }, [parsedData?.entityName, entityData.entityName, collectionData]);

  // State for realtime accessories (updated via WebSocket)
  const [realtimeAccessories, setRealtimeAccessories] = useState<HomeKitAccessory[]>([]);

  // State for selected group (null = show all)
  const [internalSelectedGroup, setInternalSelectedGroup] = useState<string | null>(null);
  const selectedGroup = useExternalSidebar ? externalSelectedGroup ?? null : internalSelectedGroup;
  const setSelectedGroup = useExternalSidebar ? (onExternalGroupSelect ?? (() => {})) : setInternalSelectedGroup;

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
    isSubscribed: wsSubscribed,
    setOnCharacteristicUpdate,
    setOnReachabilityUpdate,
    setOnServiceGroupUpdate,
  } = useSharedWebSocket(shareHash, passcode);

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

  // Create a map of accessory ID to accessory for quick lookup
  const accessoryMap = useMemo(() => {
    const map = new Map<string, HomeKitAccessory>();
    for (const accessory of accessories) {
      map.set(accessory.id, accessory);
    }
    return map;
  }, [accessories]);

  // Track optimistic state for toggles/sliders
  const [optimisticValues, setOptimisticValues] = useState<Record<string, any>>({});

  const [setCharacteristic] = useMutation<PublicEntitySetCharacteristicResponse>(
    PUBLIC_ENTITY_SET_CHARACTERISTIC
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
          // Don't revert slider - just show error
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
      .map(id => accessoryMap.get(id) || accessoryMap.get(id.replace(/-/g, '').toLowerCase()))
      .filter((acc): acc is HomeKitAccessory => acc !== undefined);
  }, [accessoryMap]);

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

  // Build set of accessory IDs that are in service groups (for collection_group view)
  const accessoriesInGroups = useMemo(() => {
    const set = new Set<string>();
    for (const group of serviceGroups) {
      for (const accId of group.accessoryIds) {
        set.add(accId.replace(/-/g, '').toLowerCase());
      }
    }
    return set;
  }, [serviceGroups]);

  // Group items by collection group - computed before early returns for sidebar
  const itemsByGroup = useMemo(() => {
    const byGroup: Record<string, CollectionItem[]> = {
      ungrouped: [],
    };
    // Initialize groups
    for (const group of payload.groups) {
      byGroup[group.id] = [];
    }
    // Sort items into groups
    for (const item of payload.items) {
      const groupId = item.group_id || 'ungrouped';
      if (!byGroup[groupId]) {
        byGroup[groupId] = [];
      }
      byGroup[groupId].push(item);
    }
    return byGroup;
  }, [payload.groups, payload.items]);

  // Check if we have groups to show in sidebar
  const hasGroups = payload.groups.length > 0;

  // Sidebar content - computed before early returns to ensure hooks are called consistently
  const sidebarContent = hasGroups ? (
    <nav className="space-y-1">
      {/* Collection name header */}
      <button
        onClick={() => setSelectedGroup(null)}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
          isDarkBackground
            ? `text-white ${selectedGroup === null ? 'bg-white/20' : 'hover:bg-white/10'}`
            : selectedGroup === null
              ? "bg-primary text-primary-foreground"
              : "hover:bg-muted"
        )}
        style={{ fontWeight: 400 }}
      >
        <Folder className="h-4 w-4" />
        <span className="flex-1 truncate text-left" style={{ fontWeight: 400 }}>{collectionName}</span>
      </button>
      {/* Groups - indented under collection */}
      <div className="ml-4 space-y-1 pt-1">
        {payload.groups.map((group) => (
          <button
            key={group.id}
            onClick={() => setSelectedGroup(group.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm transition-colors",
              isDarkBackground
                ? `text-white ${selectedGroup === group.id ? 'bg-white/20' : 'hover:bg-white/10'}`
                : selectedGroup === group.id
                  ? "bg-secondary text-secondary-foreground"
                  : "hover:bg-muted"
            )}
            style={{ fontWeight: 400 }}
          >
            <Layers className="h-4 w-4" />
            <span className="flex-1 truncate text-left">{group.name}</span>
          </button>
        ))}
      </div>
    </nav>
  ) : null;

  // Pass sidebar to parent if using external sidebar - must be called before any early returns
  useEffect(() => {
    if (renderSidebar) {
      renderSidebar(sidebarContent);
    }
  }, [renderSidebar, sidebarContent, selectedGroup, hasGroups]);

  // Create a map of service group ID to service group for quick lookup (must be before early returns)
  const serviceGroupMap = useMemo(() => {
    const map = new Map<string, HomeKitServiceGroup>();
    for (const group of serviceGroups) {
      map.set(group.id, group);
      // Also map normalized ID
      map.set(group.id.toLowerCase().replace(/-/g, ''), group);
    }
    return map;
  }, [serviceGroups]);

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
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {payload.items.length} item{payload.items.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Loading indicator */}
        <div className="flex flex-col items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="mt-4 text-sm text-muted-foreground">Loading accessories...</p>
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
  if (accessoriesError || (accessories.length === 0 && payload.items.length > 0)) {
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
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground">
            {payload.items.length} item{payload.items.length !== 1 ? 's' : ''}
          </span>
        </div>

        <ErrorWithTrace
          title="Unable to Load Accessories"
          message="The relay may be offline or unavailable."
          errorMessage={gqlError?.message}
          trace={trace}
        />
      </div>
    );
  }

  // Empty collection (but not for collection_group which uses accessories directly)
  if (payload.items.length === 0 && entityData.entityType !== 'collection_group') {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground mx-auto" />
          <h3 className="mt-4 text-lg font-medium">Empty Collection</h3>
          <p className="mt-2 text-muted-foreground">
            This collection has no accessories.
          </p>
        </CardContent>
      </Card>
    );
  }

  // For collection_group, render accessories directly (no groups/items structure)
  if (entityData.entityType === 'collection_group') {
    // Filter out accessories that are part of service groups
    const standaloneAccessories = accessories.filter(
      acc => !accessoriesInGroups.has(acc.id.replace(/-/g, '').toLowerCase())
    );

    if (accessories.length === 0 && serviceGroups.length === 0) {
      return (
        <Card>
          <CardContent className="py-12 text-center">
            <Layers className="h-12 w-12 text-muted-foreground mx-auto" />
            <h3 className="mt-4 text-lg font-medium">Empty Group</h3>
            <p className="mt-2 text-muted-foreground">
              This group has no accessories.
            </p>
          </CardContent>
        </Card>
      );
    }

    return (
      <div className="space-y-6">
        {/* Area Summary - aggregated sensor readings */}
        <AreaSummary accessories={accessories} isDarkBackground={isDarkBackground} />

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Service groups first */}
          {serviceGroups.map((group) => {
            const groupAccessories = getGroupAccessories(group);
            const groupRoomName = groupAccessories[0]?.roomName;
            const groupHomeName = groupAccessories[0]?.homeName;
            return (
            <ServiceGroupWidget
              key={group.id}
              group={group}
              accessories={groupAccessories}
              onToggle={(checked) => handleGroupToggle(group, checked)}
              onSlider={(charType, value) => handleGroupSlider(group, charType, value)}
              onAccessoryToggle={canControl ? handleToggle : undefined}
              onAccessorySlider={canControl ? handleSlider : undefined}
              getEffectiveValue={getEffectiveValue}
              compact={collectionLayout?.compactMode || false}
              iconStyle={(collectionLayout?.iconStyle as 'standard' | 'colourful') || "colourful"}
              disabled={!canControl}
              disableTooltip
              locationSubtitle={[groupHomeName, groupRoomName].filter(Boolean).join(' · ')}
            />
            );
          })}
          {/* Individual accessories (not in groups) */}
          {standaloneAccessories.map((accessory) => (
            <AccessoryWidget
              key={accessory.id}
              accessory={accessory}
              homeName={accessory.homeName}
              onToggle={canControl ? handleToggle : () => {}}
              onSlider={canControl ? handleSlider : () => {}}
              getEffectiveValue={getEffectiveValue}
              compact={collectionLayout?.compactMode || false}
              iconStyle={(collectionLayout?.iconStyle as 'standard' | 'colourful') || "colourful"}
              disabled={!canControl}
              locationSubtitle={[accessory.homeName, accessory.roomName].filter(Boolean).join(' · ')}
            />
          ))}
        </div>
      </div>
    );
  }

  const renderItem = (item: CollectionItem, index: number) => {
    const itemId = item.accessory_id || item.service_group_id || `item-${index}`;
    const isServiceGroup = !!item.service_group_id;

    // Get the actual accessory data
    const accessory = item.accessory_id ? accessoryMap.get(item.accessory_id) : null;

    // If we have real accessory data, render the proper widget
    if (accessory) {
      return (
        <AccessoryWidget
          key={`${itemId}-${index}`}
          accessory={accessory}
          homeName={accessory.homeName}
          onToggle={canControl ? handleToggle : () => {}}
          onSlider={canControl ? handleSlider : () => {}}
          getEffectiveValue={getEffectiveValue}
          compact={collectionLayout?.compactMode || false}
          iconStyle={(collectionLayout?.iconStyle as 'standard' | 'colourful') || "colourful"}
          disabled={!canControl}
          locationSubtitle={[accessory.homeName, accessory.roomName].filter(Boolean).join(' · ')}
        />
      );
    }

    // Try to render service group with real data
    if (isServiceGroup && item.service_group_id) {
      const serviceGroup = serviceGroupMap.get(item.service_group_id) ||
                           serviceGroupMap.get(item.service_group_id.toLowerCase().replace(/-/g, ''));
      if (serviceGroup) {
        const groupAccessories = getGroupAccessories(serviceGroup);
        const groupRoomName = groupAccessories[0]?.roomName;
        const groupHomeName = groupAccessories[0]?.homeName || item.home_name;
        return (
          <ServiceGroupWidget
            key={`${itemId}-${index}`}
            group={serviceGroup}
            accessories={groupAccessories}
            onToggle={(checked) => handleGroupToggle(serviceGroup, checked)}
            onSlider={(charType, value) => handleGroupSlider(serviceGroup, charType, value)}
            onAccessoryToggle={canControl ? handleToggle : undefined}
            onAccessorySlider={canControl ? handleSlider : undefined}
            getEffectiveValue={getEffectiveValue}
            compact={collectionLayout?.compactMode || false}
            iconStyle={(collectionLayout?.iconStyle as 'standard' | 'colourful') || "colourful"}
            disabled={!canControl}
            disableTooltip
            locationSubtitle={[groupHomeName, groupRoomName].filter(Boolean).join(' · ')}
          />
        );
      }
    }

    // Fallback for missing accessories or service groups
    const Icon = isServiceGroup ? Users : Lightbulb;

    return (
      <Card key={`${itemId}-${index}`}>
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                <Icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">
                  {isServiceGroup ? 'Service Group' : 'Accessory'}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {itemId.slice(0, 8)}...
                </p>
              </div>
            </div>

            {!canControl && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Eye className="h-3 w-3" />
                View
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <WidgetInteractionContext.Provider value={interactionContextValue}>
    <div className={cn("flex gap-6", useExternalSidebar && "block")}>
      {/* Sidebar for group selection - only render inline if not using external sidebar */}
      {!useExternalSidebar && hasGroups && (
        <aside className="w-48 shrink-0 hidden md:block">
          <div className="sticky top-4">
            {sidebarContent}
          </div>
        </aside>
      )}

      {/* Main content */}
      <div className="flex-1 space-y-6 min-w-0">
        {/* Mobile-only horizontal group picker — see SharedHomeView. */}
        {hasGroups && (
          <div className="md:hidden -mx-3 px-3 overflow-x-auto scrollbar-hidden">
            <div className="flex gap-2 w-max">
              <button
                onClick={() => setSelectedGroup(null)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
                  isDarkBackground
                    ? `text-white ${selectedGroup === null ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`
                    : selectedGroup === null
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                )}
              >
                <Folder className="h-3.5 w-3.5" />
                <span className="truncate max-w-[120px]">{collectionName}</span>
              </button>
              {payload.groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroup(group.id)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs whitespace-nowrap transition-colors",
                    isDarkBackground
                      ? `text-white ${selectedGroup === group.id ? 'bg-white/20' : 'bg-white/5 hover:bg-white/10'}`
                      : selectedGroup === group.id
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted hover:bg-muted/80"
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span className="truncate max-w-[120px]">{group.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Area Summary - aggregated sensor readings */}
        <AreaSummary accessories={accessories} isDarkBackground={isDarkBackground} />

        {/* Render ungrouped items (shown with collection name header) */}
        {selectedGroup === null && itemsByGroup.ungrouped.length > 0 && (
          <div className="space-y-3">
            {hasGroups && (
              <h3 className={`text-sm font-semibold ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground/70'}`}>
                {collectionName}
              </h3>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {itemsByGroup.ungrouped.map((item, index) => renderItem(item, index))}
            </div>
          </div>
        )}

        {/* Render each collection group */}
        {payload.groups.map((group) => {
          // Skip if a specific group is selected and this isn't it
          if (selectedGroup !== null && selectedGroup !== group.id) return null;

          const groupItems = itemsByGroup[group.id] || [];
          if (groupItems.length === 0) return null;

          return (
            <div key={group.id} className="space-y-3">
              {selectedGroup === null && (
                <h3 className={`text-sm font-semibold ${isDarkBackground ? 'text-white/70' : 'text-muted-foreground/70'}`}>
                  {group.name}
                </h3>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {groupItems.map((item, index) => renderItem(item, index))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
    </WidgetInteractionContext.Provider>
  );
}
