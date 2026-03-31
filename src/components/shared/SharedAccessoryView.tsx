import { useMemo, useState, useCallback, useEffect } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { GET_PUBLIC_ENTITY_ACCESSORIES } from '@/lib/graphql/queries';
import { PUBLIC_ENTITY_SET_CHARACTERISTIC } from '@/lib/graphql/mutations';
import type {
  SharedEntityData,
  HomeKitAccessory,
  GetPublicEntityAccessoriesResponse,
  PublicEntitySetCharacteristicResponse,
} from '@/lib/graphql/types';
import { ErrorWithTrace } from './ErrorWithTrace';
import type { RequestTrace } from '@/lib/types/trace';
import { AccessoryWidget, WidgetInteractionContext } from '@/components/widgets';
import {
  useSharedWebSocket,
  applyCharacteristicUpdate,
  applyReachabilityUpdate,
} from '@/hooks/useSharedWebSocket';
import {
  Lightbulb,
  Eye,
  Zap,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';

interface SharedAccessoryViewProps {
  entityData: SharedEntityData;
  shareHash: string;
  passcode?: string | null;
  onWsStatusChange?: (subscribed: boolean) => void;
  onAccessoriesLoaded?: (meta: { count: number; entityName: string | null; background: any }) => void;
  onRequestPasscodeUpgrade?: () => void;
}

export function SharedAccessoryView({
  entityData,
  shareHash,
  passcode,
  onWsStatusChange,
  onAccessoriesLoaded,
  onRequestPasscodeUpgrade,
}: SharedAccessoryViewProps) {
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

  // Parse accessories from JSON response (initial data)
  // For single accessory, the backend returns {accessories: [...], serviceGroups: [], layout: null}
  const initialAccessory = useMemo((): HomeKitAccessory | null => {
    if (!accessoriesData?.publicEntityAccessories) return null;
    try {
      const parsed = JSON.parse(accessoriesData.publicEntityAccessories);
      const accessories = parsed.accessories || [];
      return accessories[0] || null;
    } catch {
      return null;
    }
  }, [accessoriesData]);

  // Report metadata to parent once data loads
  useEffect(() => {
    if (initialAccessory !== undefined && onAccessoriesLoaded) {
      onAccessoriesLoaded({
        count: initialAccessory ? 1 : 0,
        entityName: initialAccessory?.name ?? null,
        background: undefined,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAccessory]);

  // State for realtime accessory (updated via WebSocket)
  const [realtimeAccessory, setRealtimeAccessory] = useState<HomeKitAccessory | null>(null);

  // Initialize realtime state when initial data loads
  useEffect(() => {
    if (initialAccessory) {
      setRealtimeAccessory(initialAccessory);
    }
  }, [initialAccessory]);

  // Use realtime accessory if available, otherwise initial
  const accessory = realtimeAccessory || initialAccessory;

  // WebSocket for realtime updates
  const {
    isConnected: wsConnected,
    isSubscribed: wsSubscribed,
    setOnCharacteristicUpdate,
    setOnReachabilityUpdate,
  } = useSharedWebSocket(shareHash, passcode);

  // Track optimistic state for toggles/sliders
  const [optimisticValues, setOptimisticValues] = useState<Record<string, any>>({});

  // Set up WebSocket callbacks
  useEffect(() => {
    setOnCharacteristicUpdate((accessoryId, characteristicType, value) => {
      setRealtimeAccessory((prev) => {
        if (!prev || prev.id !== accessoryId) return prev;
        const updated = applyCharacteristicUpdate([prev], accessoryId, characteristicType, value);
        return updated[0] || prev;
      });
      // Clear optimistic value since we got the real update
      const key = `${accessoryId}-${characteristicType}`;
      setOptimisticValues((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    });

    setOnReachabilityUpdate((accessoryId, isReachable) => {
      setRealtimeAccessory((prev) => {
        if (!prev || prev.id !== accessoryId) return prev;
        const updated = applyReachabilityUpdate([prev], accessoryId, isReachable);
        return updated[0] || prev;
      });
    });

    return () => {
      setOnCharacteristicUpdate(null);
      setOnReachabilityUpdate(null);
    };
  }, [setOnCharacteristicUpdate, setOnReachabilityUpdate]);

  // Report WebSocket status to parent for Live indicator
  useEffect(() => {
    onWsStatusChange?.(wsSubscribed);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsSubscribed]);

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
        console.error('[SharedAccessoryView] Mutation error:', err);
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
        console.error('[SharedAccessoryView] Slider mutation error:', err);
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

  const interactionContextValue = useMemo(() => ({
    disabled: !canControl,
    onDisabledClick: !canControl ? handleDisabledClick : undefined,
  }), [canControl, handleDisabledClick]);

  // Loading state while fetching accessory
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
          <p className="mt-4 text-sm text-muted-foreground">Loading accessory...</p>
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
  if (accessoriesError || !accessory) {
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
          title="Unable to Load Accessory"
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
        {/* Single accessory - centered and larger */}
        <div className="flex justify-center">
          <div className="w-full max-w-md">
            <AccessoryWidget
              accessory={accessory}
              homeName={accessory.homeName}
              onToggle={canControl ? handleToggle : () => {}}
              onSlider={canControl ? handleSlider : () => {}}
              getEffectiveValue={getEffectiveValue}
              compact={false}
              iconStyle="standard"
              disabled={!canControl}
            />
          </div>
        </div>
      </div>
    </WidgetInteractionContext.Provider>
  );
}
