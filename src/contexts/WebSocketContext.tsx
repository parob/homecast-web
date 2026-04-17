import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { HomeKit, isRelayCapable } from '../native/homekit-bridge';
import { serverConnection } from '../server/connection';
import type { BroadcastMessage } from '../server/websocket';
import { invalidateHomeKitCache } from '../hooks/useHomeKitData';
import { markValueSeen } from '../lib/accessoryFreshness';
import { toast } from 'sonner';

// Logger - dev only to avoid Chrome energy warnings from high-frequency logging
const noop = () => {};
const wsLog = import.meta.env.DEV ? {
  event: (accessoryId: string, type: string, value: unknown) => {
    console.log(`[WS] Event: ${accessoryId.slice(0, 8)} → ${type} = ${JSON.stringify(value)}`);
  },
  reachability: (accessoryId: string, isReachable: boolean) => {
    console.log(`[WS] Reachability: ${accessoryId.slice(0, 8)} → ${isReachable ? 'online' : 'offline'}`);
  },
  serviceGroup: (groupId: string, type: string, value: unknown, count: number) => {
    console.log(`[WS] ServiceGroup: ${groupId.slice(0, 8)} → ${type} = ${JSON.stringify(value)} (${count} affected)`);
  },
  flush: (charCount: number, reachCount: number) => {
    if (charCount > 1 || reachCount > 0) {
      console.log(`[WS] Flushed ${charCount} char + ${reachCount} reach updates`);
    }
  },
  info: (message: string) => {
    console.log(`[WS] ${message}`);
  }
} : { event: noop, reachability: noop, serviceGroup: noop, flush: noop, info: noop };

// Callback types for subscribers
export interface UpdateCallbacks {
  onCharacteristicUpdate?: (accessoryId: string, homeId: string | null, characteristicType: string, value: any) => void;
  onReachabilityUpdate?: (accessoryId: string, isReachable: boolean) => void;
  onServiceGroupUpdate?: (groupId: string, homeId: string | null, characteristicType: string, value: any, affectedCount: number) => void;
}

export type ServerConnectionInfo = {
  serverInstanceId: string;
  pubsubEnabled: boolean;
  pubsubSlot: string | null;
};

interface WebSocketContextValue {
  isConnected: boolean;
  serverInfo: ServerConnectionInfo | null;
  // Subscribe to updates - returns unsubscribe function
  subscribeToUpdates: (callbacks: UpdateCallbacks) => () => void;
}

const WebSocketContext = createContext<WebSocketContextValue | undefined>(undefined);

// Buffer configuration - batch rapid updates to avoid overwhelming React
const UPDATE_BUFFER_INTERVAL_MS = 100;

type BufferedCharacteristicUpdate = {
  accessoryId: string;
  homeId: string | null;
  characteristicType: string;
  value: any;
};

type BufferedReachabilityUpdate = {
  accessoryId: string;
  isReachable: boolean;
};

export const WebSocketProvider = ({ children }: { children: ReactNode }) => {
  const [isConnected, setIsConnected] = useState(false);
  const [serverInfo, setServerInfo] = useState<ServerConnectionInfo | null>(null);

  // Update buffering - batch rapid updates to reduce React re-renders
  const characteristicBufferRef = useRef<Map<string, BufferedCharacteristicUpdate>>(new Map());
  const reachabilityBufferRef = useRef<Map<string, BufferedReachabilityUpdate>>(new Map());
  const flushTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Subscribers - set of callback objects
  const subscribersRef = useRef<Set<UpdateCallbacks>>(new Set());

  // Notify all subscribers of a characteristic update
  const notifyCharacteristicUpdate = useCallback((accessoryId: string, homeId: string | null, characteristicType: string, value: any) => {
    for (const callbacks of subscribersRef.current) {
      callbacks.onCharacteristicUpdate?.(accessoryId, homeId, characteristicType, value);
    }
  }, []);

  // Notify all subscribers of a reachability update
  const notifyReachabilityUpdate = useCallback((accessoryId: string, isReachable: boolean) => {
    for (const callbacks of subscribersRef.current) {
      callbacks.onReachabilityUpdate?.(accessoryId, isReachable);
    }
  }, []);

  // Notify all subscribers of a service group update
  const notifyServiceGroupUpdate = useCallback((groupId: string, homeId: string | null, characteristicType: string, value: any, affectedCount: number) => {
    for (const callbacks of subscribersRef.current) {
      callbacks.onServiceGroupUpdate?.(groupId, homeId, characteristicType, value, affectedCount);
    }
  }, []);

  // Flush buffered updates - called periodically to batch rapid updates
  const flushBufferedUpdates = useCallback(() => {
    const charBuffer = characteristicBufferRef.current;
    const reachBuffer = reachabilityBufferRef.current;

    if (charBuffer.size === 0 && reachBuffer.size === 0) return;

    const charCount = charBuffer.size;
    const reachCount = reachBuffer.size;

    // Notify all subscribers of buffered characteristic updates
    for (const update of charBuffer.values()) {
      notifyCharacteristicUpdate(update.accessoryId, update.homeId, update.characteristicType, update.value);
    }

    // Notify all subscribers of buffered reachability updates
    for (const update of reachBuffer.values()) {
      notifyReachabilityUpdate(update.accessoryId, update.isReachable);
    }

    // Clear buffers
    charBuffer.clear();
    reachBuffer.clear();

    wsLog.flush(charCount, reachCount);
  }, [notifyCharacteristicUpdate, notifyReachabilityUpdate]);

  // Schedule a flush if not already scheduled
  const scheduleFlush = useCallback(() => {
    if (flushTimeoutRef.current) return; // Already scheduled
    flushTimeoutRef.current = setTimeout(() => {
      flushTimeoutRef.current = null;
      flushBufferedUpdates();
    }, UPDATE_BUFFER_INTERVAL_MS);
  }, [flushBufferedUpdates]);

  // Handle broadcast message from relay (used in browser mode)
  const handleBroadcast = useCallback((message: BroadcastMessage) => {
    if (message.type === 'characteristic_update') {
      const key = `${message.accessoryId}:${message.characteristicType}`;
      wsLog.event(message.accessoryId, message.characteristicType, message.value);

      // A value arrived — proves the accessory is responsive right now, even
      // if HomeKit's isReachable flag still reads false.
      markValueSeen(message.accessoryId);

      characteristicBufferRef.current.set(key, {
        accessoryId: message.accessoryId,
        homeId: message.homeId ?? null,
        characteristicType: message.characteristicType,
        value: message.value
      });
      scheduleFlush();
    } else if (message.type === 'reachability_update') {
      wsLog.reachability(message.accessoryId, message.isReachable);

      // Positive reachability also counts as a "we just heard from it" signal.
      if (message.isReachable) markValueSeen(message.accessoryId);

      reachabilityBufferRef.current.set(message.accessoryId, {
        accessoryId: message.accessoryId,
        isReachable: message.isReachable
      });
      scheduleFlush();
    } else if (message.type === 'service_group_update') {
      wsLog.serviceGroup(message.groupId, message.characteristicType, message.value, message.affectedCount);
      // Service group updates are not buffered - notify immediately
      notifyServiceGroupUpdate(message.groupId, message.homeId, message.characteristicType, message.value, message.affectedCount);
    } else if (message.type === 'auth_required') {
      // Relay enabled authentication — kick guest sessions to login
      localStorage.removeItem('homecast-token');
      window.location.href = '/login';
    } else if (message.type === 'relay_status_update') {
      // Relay came online/offline for a shared home — re-fetch homes list
      invalidateHomeKitCache();
    } else if (message.type === 'enrollment_cancelled') {
      toast.info(`"${message.homeName}" was removed from cloud relay`, {
        description: 'The relay user was removed from your Apple Home.',
      });
      invalidateHomeKitCache();
    }
  }, [scheduleFlush, notifyServiceGroupUpdate]);

  // Subscribe to relay manager connection state (always needed for both modes)
  useEffect(() => {
    wsLog.info('Subscribing to server connection state');

    const unsubscribeState = serverConnection.subscribe((state) => {
      const connected = state.connectionState === 'connected';
      wsLog.info(`Relay state: ${state.connectionState}`);
      setIsConnected(connected);
    });

    return unsubscribeState;
  }, []);

  // Event subscriptions based on mode:
  // - Mac app mode: HomeKit events (external changes) + server broadcasts (programmatic changes)
  // - Browser mode: Server broadcasts only
  useEffect(() => {
    if (isRelayCapable()) {
      // Mac app mode: subscribe to local HomeKit events for external changes (Apple Home, etc.)
      wsLog.info('Mac mode: subscribing to HomeKit events');

      const unsubscribeHomeKit = HomeKit.onEvent((event) => {
        if (event.type === 'characteristic.updated' && event.characteristicType) {
          const key = `${event.accessoryId}:${event.characteristicType}`;
          wsLog.event(event.accessoryId, event.characteristicType, event.value);

          characteristicBufferRef.current.set(key, {
            accessoryId: event.accessoryId,
            homeId: event.homeId ?? null,
            characteristicType: event.characteristicType,
            value: event.value
          });
          scheduleFlush();
        } else if (event.type === 'accessory.reachability' && event.isReachable !== undefined) {
          wsLog.reachability(event.accessoryId, event.isReachable);

          reachabilityBufferRef.current.set(event.accessoryId, {
            accessoryId: event.accessoryId,
            isReachable: event.isReachable
          });
          scheduleFlush();
        }
      });

      // Also subscribe to broadcasts for programmatic changes
      // (HomeKit doesn't fire events back to the app that made the change)
      wsLog.info('Mac mode: also subscribing to broadcasts for programmatic updates');
      const unsubscribeBroadcasts = serverConnection.subscribeToBroadcasts(handleBroadcast);

      return () => {
        unsubscribeHomeKit();
        unsubscribeBroadcasts();
      };
    } else {
      // Browser mode: subscribe to server broadcasts
      wsLog.info('Browser mode: subscribing to server');

      const unsubscribeBroadcasts = serverConnection.subscribeToBroadcasts(handleBroadcast);

      return unsubscribeBroadcasts;
    }
  }, [handleBroadcast, scheduleFlush]);

  // Forward notification action events from service worker to server
  useEffect(() => {
    const handleNotificationAction = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (detail?.action) {
        serverConnection.request('automation.notification_response', {
          action: detail.action,
          data: detail.data ?? {},
        }).catch((err) => {
          console.warn('[WS] Failed to forward notification action:', err);
        });
      }
    };
    window.addEventListener('homecast-notification-action', handleNotificationAction);
    return () => window.removeEventListener('homecast-notification-action', handleNotificationAction);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (flushTimeoutRef.current) {
        clearTimeout(flushTimeoutRef.current);
        flushTimeoutRef.current = null;
      }
      flushBufferedUpdates();
    };
  }, [flushBufferedUpdates]);

  // Subscribe function for hooks to register for updates
  const subscribeToUpdates = useCallback((callbacks: UpdateCallbacks): (() => void) => {
    subscribersRef.current.add(callbacks);
    return () => {
      subscribersRef.current.delete(callbacks);
    };
  }, []);

  return (
    <WebSocketContext.Provider value={{ isConnected, serverInfo, subscribeToUpdates }}>
      {children}
    </WebSocketContext.Provider>
  );
};

export const useWebSocket = () => {
  const context = useContext(WebSocketContext);
  if (context === undefined) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
};
