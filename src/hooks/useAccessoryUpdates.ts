import { useEffect, useRef, useCallback } from 'react';
import { useWebSocket } from '@/contexts/WebSocketContext';
import type { ServerConnectionInfo } from '@/contexts/WebSocketContext';
import {
  updateAccessoryCharacteristicInCache as updateLocalCharacteristic,
  updateAccessoryReachabilityInCache as updateLocalReachability,
  updateServiceGroupCharacteristicInCache as updateLocalServiceGroup,
} from '@/hooks/useHomeKitData';

export type { ServerConnectionInfo };

/**
 * Hook to subscribe to real-time accessory updates via WebSocket.
 * Uses the WebSocketContext for connection management, ensuring a single
 * persistent connection is shared across all views.
 *
 * Updates the local relay cache (useHomeKitData) which is used by both
 * Mac app mode and browser mode.
 */
export function useAccessoryUpdates(token: string | null, homeId: string | null) {
  const { isConnected, serverInfo, subscribeToUpdates } = useWebSocket();
  const homeIdRef = useRef(homeId);

  // Keep ref in sync with prop
  homeIdRef.current = homeId;

  // Update characteristic in local cache (used by relay hooks)
  const updateCharacteristicInCache = useCallback((
    accessoryId: string,
    homeId: string | null,
    characteristicType: string,
    newValue: any
  ) => {
    // Use homeId from message if provided, fallback to current selectedHomeId
    const effectiveHomeId = homeId || homeIdRef.current;
    if (import.meta.env.DEV) console.log(`[AccessoryUpdates] Received update: homeId=${effectiveHomeId}, accessoryId=${accessoryId.slice(0, 8)}, ${characteristicType}=${JSON.stringify(newValue)}`);

    if (!effectiveHomeId) {
      if (import.meta.env.DEV) console.log(`[AccessoryUpdates] No homeId - skipping update`);
      return;
    }

    updateLocalCharacteristic(effectiveHomeId, accessoryId, characteristicType, newValue);
  }, []);

  // Update accessory reachability in local cache
  const updateReachabilityInCache = useCallback((
    accessoryId: string,
    isReachable: boolean
  ) => {
    const currentHomeId = homeIdRef.current;
    if (!currentHomeId) {
      if (import.meta.env.DEV) console.log(`[Cache] No homeId - skipping reachability for ${accessoryId.slice(0, 8)}`);
      return;
    }

    updateLocalReachability(currentHomeId, accessoryId, isReachable);
    if (import.meta.env.DEV) console.log(`[Cache] Reachability: ${accessoryId.slice(0, 8)} → ${isReachable ? 'online' : 'offline'}`);
  }, []);

  // Handle service group update
  const handleServiceGroupUpdate = useCallback((
    groupId: string,
    homeId: string | null,
    characteristicType: string,
    value: any,
    affectedCount: number
  ) => {
    // Use homeId from message, fallback to current selectedHomeId
    const effectiveHomeId = homeId || homeIdRef.current;
    if (import.meta.env.DEV) console.log(`[AccessoryUpdates] ServiceGroup update: homeId=${effectiveHomeId}, groupId=${groupId.slice(0, 8)}, ${characteristicType}=${JSON.stringify(value)} (${affectedCount} affected)`);

    if (!effectiveHomeId) {
      if (import.meta.env.DEV) console.log(`[AccessoryUpdates] No homeId - skipping service group update`);
      return;
    }

    updateLocalServiceGroup(effectiveHomeId, groupId, characteristicType, value);
  }, []);

  // Subscribe to WebSocket updates
  useEffect(() => {
    // Subscribe to updates from the WebSocket context
    const unsubscribe = subscribeToUpdates({
      onCharacteristicUpdate: (accessoryId, homeId, characteristicType, value) => {
        updateCharacteristicInCache(accessoryId, homeId, characteristicType, value);
      },
      onReachabilityUpdate: (accessoryId, isReachable) => {
        updateReachabilityInCache(accessoryId, isReachable);
      },
      onServiceGroupUpdate: (groupId, homeId, characteristicType, value, affectedCount) => {
        handleServiceGroupUpdate(groupId, homeId, characteristicType, value, affectedCount);
      },
    });

    return unsubscribe;
  }, [subscribeToUpdates, updateCharacteristicInCache, updateReachabilityInCache, handleServiceGroupUpdate]);

  return { isConnected, serverInfo };
}
