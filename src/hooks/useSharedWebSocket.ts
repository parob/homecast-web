import { useEffect, useRef, useCallback, useState } from 'react';
import type { HomeKitAccessory, HomeKitServiceGroup } from '@/lib/graphql/types';
import { config as appConfig } from '@/lib/config';

type CharacteristicUpdate = {
  type: 'characteristic_update';
  accessoryId: string;
  characteristicType: string;
  value: any;
};

type ReachabilityUpdate = {
  type: 'reachability_update';
  accessoryId: string;
  isReachable: boolean;
};

type ServiceGroupUpdate = {
  type: 'service_group_update';
  groupId: string;
  homeId: string | null;
  characteristicType: string;
  value: any;
  affectedCount: number;
};

type SubscribedMessage = {
  type: 'subscribed';
  shareHash: string;
};

type SubscribeErrorMessage = {
  type: 'subscribe_error';
  shareHash?: string;
  error: string;
};

type WebSocketMessage =
  | CharacteristicUpdate
  | ReachabilityUpdate
  | ServiceGroupUpdate
  | SubscribedMessage
  | SubscribeErrorMessage
  | { type: 'pong' }
  | { type: 'ping' };

// Buffer configuration - batch rapid updates to avoid overwhelming React
const UPDATE_BUFFER_INTERVAL_MS = 100;

type BufferedCharacteristicUpdate = {
  accessoryId: string;
  characteristicType: string;
  value: any;
};

type BufferedReachabilityUpdate = {
  accessoryId: string;
  isReachable: boolean;
};

/**
 * Hook to subscribe to real-time updates for a shared entity via WebSocket.
 * No authentication required - access verified by share hash and optional passcode.
 */
export function useSharedWebSocket(
  shareHash: string | undefined,
  passcode?: string | null
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [subscribeError, setSubscribeError] = useState<string | null>(null);

  // Update buffering - batch rapid updates to reduce React re-renders
  const characteristicBufferRef = useRef<Map<string, BufferedCharacteristicUpdate>>(new Map());
  const reachabilityBufferRef = useRef<Map<string, BufferedReachabilityUpdate>>(new Map());
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Callback refs to avoid stale closures
  const onCharacteristicUpdateRef = useRef<((
    accessoryId: string,
    characteristicType: string,
    value: any
  ) => void) | null>(null);

  const onReachabilityUpdateRef = useRef<((
    accessoryId: string,
    isReachable: boolean
  ) => void) | null>(null);

  const onServiceGroupUpdateRef = useRef<((
    groupId: string,
    homeId: string | null,
    characteristicType: string,
    value: any,
    affectedCount: number
  ) => void) | null>(null);

  // Flush buffered updates - called periodically to batch rapid updates
  const flushBufferedUpdates = useCallback(() => {
    const charBuffer = characteristicBufferRef.current;
    const reachBuffer = reachabilityBufferRef.current;

    if (charBuffer.size === 0 && reachBuffer.size === 0) return;

    const charCount = charBuffer.size;
    const reachCount = reachBuffer.size;

    // Apply all buffered characteristic updates
    for (const update of charBuffer.values()) {
      onCharacteristicUpdateRef.current?.(
        update.accessoryId,
        update.characteristicType,
        update.value
      );
    }

    // Apply all buffered reachability updates
    for (const update of reachBuffer.values()) {
      onReachabilityUpdateRef.current?.(
        update.accessoryId,
        update.isReachable
      );
    }

    // Clear buffers
    charBuffer.clear();
    reachBuffer.clear();

    if (charCount > 1 || reachCount > 0) {
      console.log(`[SharedWS] Flushed ${charCount} char + ${reachCount} reach updates`);
    }
  }, []);

  // Schedule a flush if not already scheduled
  const scheduleFlush = useCallback(() => {
    if (flushTimeoutRef.current) return; // Already scheduled
    flushTimeoutRef.current = setTimeout(() => {
      flushTimeoutRef.current = null;
      flushBufferedUpdates();
    }, UPDATE_BUFFER_INTERVAL_MS);
  }, [flushBufferedUpdates]);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!shareHash) return;

    // Derive shared WebSocket URL from config
    // In Community mode, use the main WS port (no separate /ws/shared endpoint)
    const wsUrl = appConfig.isCommunity
      ? appConfig.wsUrl
      : appConfig.wsUrl.replace(/\/ws$/, '/ws/shared');

    console.log('[SharedWS] Connecting...');

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[SharedWS] Connected - subscribing...');
      setIsConnected(true);
      setSubscribeError(null);

      // Subscribe to share hash
      ws.send(JSON.stringify({
        type: 'subscribe',
        shareHash,
        passcode: passcode || undefined
      }));

      // Start ping interval to keep connection alive
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const message: WebSocketMessage = JSON.parse(event.data);

        if (message.type === 'subscribed') {
          console.log(`[SharedWS] Subscribed: ${message.shareHash}`);
          setIsSubscribed(true);
          setSubscribeError(null);
        } else if (message.type === 'subscribe_error') {
          console.error(`[SharedWS] Subscribe error: ${message.error}`);
          setSubscribeError(message.error);
          setIsSubscribed(false);
        } else if (message.type === 'characteristic_update') {
          const key = `${message.accessoryId}:${message.characteristicType}`;
          console.log(`[SharedWS] Update: ${message.accessoryId.slice(0, 8)} → ${message.characteristicType} = ${JSON.stringify(message.value)}`);

          // Buffer update (keyed by accessory+characteristic to coalesce duplicates)
          characteristicBufferRef.current.set(key, {
            accessoryId: message.accessoryId,
            characteristicType: message.characteristicType,
            value: message.value
          });
          scheduleFlush();
        } else if (message.type === 'reachability_update') {
          console.log(`[SharedWS] Reachability: ${message.accessoryId.slice(0, 8)} → ${message.isReachable ? 'online' : 'offline'}`);

          // Buffer reachability update (keyed by accessory to coalesce duplicates)
          reachabilityBufferRef.current.set(message.accessoryId, {
            accessoryId: message.accessoryId,
            isReachable: message.isReachable
          });
          scheduleFlush();
        } else if (message.type === 'service_group_update') {
          console.log(`[SharedWS] ServiceGroup: ${message.groupId.slice(0, 8)} → ${message.characteristicType} = ${JSON.stringify(message.value)} (${message.affectedCount} affected)`);
          // Service group updates are not buffered - notify immediately
          onServiceGroupUpdateRef.current?.(message.groupId, message.homeId, message.characteristicType, message.value, message.affectedCount);
        } else if (message.type === 'auth_required') {
          // Relay enabled authentication — redirect to login
          window.location.href = '/login';
        } else if (message.type === 'ping') {
          // Server ping - respond with pong
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (error) {
        console.error('[SharedWS] Parse error:', error);
      }
    };

    ws.onclose = (event) => {
      console.log(`[SharedWS] Disconnected: ${event.code} ${event.reason}`);
      wsRef.current = null;
      setIsConnected(false);
      setIsSubscribed(false);

      // Clear ping interval
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      // Reconnect after delay (unless access denied)
      if (event.code !== 4001 && event.code !== 4003) {
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[SharedWS] Reconnecting...');
          connect();
        }, 3000);
      }
    };

    ws.onerror = (error) => {
      console.error('[SharedWS] Error:', error);
    };
  }, [shareHash, passcode, scheduleFlush]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    // Flush any pending updates before disconnecting
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    flushBufferedUpdates();
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsSubscribed(false);
  }, [flushBufferedUpdates]);

  // Connect on mount, disconnect on unmount
  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  // Disconnect when tab hidden, reconnect when visible
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        console.log('[SharedWS] Tab hidden - disconnecting');
        disconnect();
      } else {
        console.log('[SharedWS] Tab visible - reconnecting');
        connect();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [connect, disconnect]);

  // Set update callbacks
  const setOnCharacteristicUpdate = useCallback((
    callback: ((accessoryId: string, characteristicType: string, value: any) => void) | null
  ) => {
    onCharacteristicUpdateRef.current = callback;
  }, []);

  const setOnReachabilityUpdate = useCallback((
    callback: ((accessoryId: string, isReachable: boolean) => void) | null
  ) => {
    onReachabilityUpdateRef.current = callback;
  }, []);

  const setOnServiceGroupUpdate = useCallback((
    callback: ((groupId: string, homeId: string | null, characteristicType: string, value: any, affectedCount: number) => void) | null
  ) => {
    onServiceGroupUpdateRef.current = callback;
  }, []);

  return {
    isConnected,
    isSubscribed,
    subscribeError,
    disconnect,
    setOnCharacteristicUpdate,
    setOnReachabilityUpdate,
    setOnServiceGroupUpdate
  };
}

/**
 * Helper to apply a characteristic update to an accessories array
 */
export function applyCharacteristicUpdate(
  accessories: HomeKitAccessory[],
  accessoryId: string,
  characteristicType: string,
  value: any
): HomeKitAccessory[] {
  // JSON-stringify the value to match GraphQL format
  const jsonEncodedValue = JSON.stringify(value);

  return accessories.map(acc => {
    if (acc.id !== accessoryId) return acc;
    return {
      ...acc,
      services: acc.services.map(service => ({
        ...service,
        characteristics: service.characteristics.map(char => {
          if (char.characteristicType !== characteristicType) return char;
          return { ...char, value: jsonEncodedValue };
        })
      }))
    };
  });
}

/**
 * Helper to apply a reachability update to an accessories array
 */
export function applyReachabilityUpdate(
  accessories: HomeKitAccessory[],
  accessoryId: string,
  isReachable: boolean
): HomeKitAccessory[] {
  return accessories.map(acc => {
    if (acc.id !== accessoryId) return acc;
    if (acc.isReachable === isReachable) return acc;
    return { ...acc, isReachable };
  });
}

/**
 * Helper to apply a service group update to an accessories array.
 * Updates the characteristic on all accessories that belong to the group.
 */
export function applyServiceGroupUpdate(
  accessories: HomeKitAccessory[],
  serviceGroups: HomeKitServiceGroup[],
  groupId: string,
  characteristicType: string,
  value: any
): HomeKitAccessory[] {
  const group = serviceGroups.find(g => g.id === groupId);
  if (!group) return accessories;

  const memberIds = new Set(group.accessoryIds.map(id => id.replace(/-/g, '').toLowerCase()));
  const jsonEncodedValue = JSON.stringify(value);

  // For power-related characteristics, update both 'on' and 'power_state'
  const charTypes = (characteristicType === 'on' || characteristicType === 'power_state')
    ? ['on', 'power_state']
    : [characteristicType];

  return accessories.map(acc => {
    const normalizedId = acc.id.replace(/-/g, '').toLowerCase();
    if (!memberIds.has(normalizedId)) return acc;
    return {
      ...acc,
      services: acc.services.map(service => ({
        ...service,
        characteristics: service.characteristics.map(char => {
          if (!charTypes.includes(char.characteristicType)) return char;
          return { ...char, value: jsonEncodedValue };
        })
      }))
    };
  });
}
