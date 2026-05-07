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
  PublicEntityAccessoriesData,
  RoomLayoutData,
} from '@/lib/graphql/types';
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
import {
  DoorClosed,
  Eye,
  Zap,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

interface SharedRoomViewProps {
  entityData: SharedEntityData;
  shareHash: string;
  passcode?: string | null;
  onWsStatusChange?: (subscribed: boolean) => void;
  onAccessoriesLoaded?: (meta: { count: number; entityName: string | null; background: any }) => void;
  onRequestPasscodeUpgrade?: () => void;
}

export function SharedRoomView({
  entityData,
  shareHash,
  passcode,
  onWsStatusChange,
  onAccessoriesLoaded,
  onRequestPasscodeUpgrade,
}: SharedRoomViewProps) {
  const { isDarkBackground } = useBackgroundContext();
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

  const layout = useMemo((): RoomLayoutData | null => {
    return parsedData?.layout as RoomLayoutData || null;
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

  const [setCharacteristic] = useMutation<PublicEntitySetCharacteristicResponse>(
    PUBLIC_ENTITY_SET_CHARACTERISTIC
  );
  const [setServiceGroup] = useMutation<PublicEntitySetCharacteristicResponse>(
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

  // Build accessory lookup by ID for service groups
  const accessoryById = useMemo(() => {
    const map = new Map<string, HomeKitAccessory>();
    for (const acc of accessories) {
      map.set(acc.id, acc);
      map.set(acc.id.replace(/-/g, '').toLowerCase(), acc);
    }
    return map;
  }, [accessories]);

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
        await setServiceGroup({
          variables: {
            shareHash,
            groupId: group.id,
            characteristicType: 'on',
            value: JSON.stringify(newValue),
            passcode,
          },
        });
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
        await setServiceGroup({
          variables: {
            shareHash,
            groupId: group.id,
            characteristicType,
            value: JSON.stringify(value),
            passcode,
          },
        });
      } catch (err) {
        // Keep optimistic values — WebSocket update will reconcile
      }
    },
    [canControl, shareHash, passcode, setServiceGroup, getGroupAccessories]
  );

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

  // Apply layout ordering and visibility filtering
  // NOTE: These must be called before early returns to maintain hook order
  const sortedAccessories = useMemo(() => {
    let filtered = [...accessories];

    // Filter hidden accessories
    if (layout?.visibility?.hiddenAccessories && layout.visibility.hiddenAccessories.length > 0) {
      const hiddenSet = new Set(layout.visibility.hiddenAccessories.map(id => id.toLowerCase().replace(/-/g, '')));
      filtered = filtered.filter(a => !hiddenSet.has(a.id.toLowerCase().replace(/-/g, '')));
    }

    // Filter out accessories that are part of service groups
    filtered = filtered.filter(a => !accessoriesInGroups.has(a.id.toLowerCase().replace(/-/g, '')));

    // Apply ordering from layout
    if (layout?.itemOrder && layout.itemOrder.length > 0) {
      const orderMap = new Map(layout.itemOrder.map((id, i) => [id.toLowerCase().replace(/-/g, ''), i]));
      filtered.sort((a, b) => {
        const aOrder = orderMap.get(a.id.toLowerCase().replace(/-/g, '')) ?? Infinity;
        const bOrder = orderMap.get(b.id.toLowerCase().replace(/-/g, '')) ?? Infinity;
        return aOrder - bOrder;
      });
    }

    return filtered;
  }, [accessories, layout, accessoriesInGroups]);

  // Filter service groups based on layout visibility
  const visibleServiceGroups = useMemo(() => {
    if (!layout?.visibility?.hiddenGroups || layout.visibility.hiddenGroups.length === 0) {
      return serviceGroups;
    }
    const hiddenSet = new Set(layout.visibility.hiddenGroups.map(id => id.toLowerCase().replace(/-/g, '')));
    return serviceGroups.filter(g => !hiddenSet.has(g.id.toLowerCase().replace(/-/g, '')));
  }, [serviceGroups, layout]);

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
          <p className="mt-4 text-sm text-muted-foreground">Loading room accessories...</p>
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
          title="Unable to Load Room"
          message="The relay may be offline or unavailable."
          errorMessage={gqlError?.message}
          trace={trace}
        />
      </div>
    );
  }

  return (
    <WidgetInteractionContext.Provider value={interactionContextValue}>
      <div className="space-y-6">
        {/* Area Summary - aggregated sensor readings */}
        <AreaSummary accessories={accessories} isDarkBackground={isDarkBackground} />

        {/* Service groups */}
        {visibleServiceGroups.length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {visibleServiceGroups.map((group) => (
              <ServiceGroupWidget
                key={group.id}
                group={group}
                accessories={getGroupAccessories(group)}
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
          </div>
        )}

        {/* Accessories grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedAccessories.map((accessory) => (
            <AccessoryWidget
              key={accessory.id}
              accessory={accessory}
              homeName={accessory.homeName}
              onToggle={canControl ? handleToggle : () => {}}
              onSlider={canControl ? handleSlider : () => {}}
              getEffectiveValue={getEffectiveValue}
              compact={false}
              iconStyle={(layout?.iconStyle as 'standard' | 'colourful') || 'colourful'}
              disabled={!canControl}
            />
          ))}
        </div>
      </div>
    </WidgetInteractionContext.Provider>
  );
}
