import React, { createContext, useContext, useEffect, useRef, useState, useCallback, ReactNode } from 'react';
import { HomeKit, isRelayCapable } from '../native/homekit-bridge';
import { serverConnection } from '../server/connection';
import type { BroadcastMessage } from '../server/websocket';
import { invalidateHomeKitCache, invalidateHomeCaches, revalidateHomeKitCache } from '../hooks/useHomeKitData';
import { recordRelayStatusUpdate } from '../lib/relay-diagnostics';
import { useLocalMode } from '../hooks/useLocalMode';
import { localIdentity } from '../server/local-identity';
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

/** Floor between "we may have missed something" refreshes, so a flapping relay
 *  cannot turn a reconnect storm into a request storm. */
const REVALIDATE_MIN_INTERVAL_MS = 10_000;
/** Hidden for less than this is a glance away, not an absence worth re-asking over. */
const HIDDEN_GAP_MS = 10_000;
/** Floor for recovering from an actual drop — short, because everything that
 *  was in flight died with the socket and nothing else will re-ask. */
const RECONNECT_REVALIDATE_MIN_MS = 2_000;

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
  const { active: localModeActive } = useLocalMode();

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

      characteristicBufferRef.current.set(key, {
        accessoryId: message.accessoryId,
        homeId: message.homeId ?? null,
        characteristicType: message.characteristicType,
        value: message.value
      });
      scheduleFlush();
    } else if (message.type === 'reachability_update') {
      wsLog.reachability(message.accessoryId, message.isReachable);

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
      // Relay came online/offline for ONE home — refresh that home's data and
      // the homes list (which carries the relay-status field). Scoped: the old
      // no-arg nuke made a single flapping relay refetch every home for every
      // client. Record the broadcast first so relay-offline diagnostics can
      // show what status pushes the client actually received.
      recordRelayStatusUpdate(message);
      if (message.homeId) {
        invalidateHomeCaches(message.homeId);
      } else {
        invalidateHomeKitCache('all');
      }
    } else if (message.type === 'enrollment_cancelled') {
      toast.info(`"${message.homeName}" was removed from cloud relay`, {
        description: 'The relay user was removed from your Apple Home.',
      });
      invalidateHomeKitCache('all');
    }
  }, [scheduleFlush, notifyServiceGroupUpdate]);

  // Subscribe to relay manager connection state (always needed for both modes)
  //
  // This also owns the "we may have missed something" refresh. Two moments
  // qualify, and neither used to trigger anything: the socket becoming usable
  // (the mount fetch fires before it exists and gives up after two retries),
  // and the app coming back from hidden (a suspended WebView receives no
  // broadcasts, and may resume on a socket that never looked disconnected).
  //
  // Revalidate, not invalidate — see revalidateHomeKitCache. Throttled so a
  // flapping relay cannot turn a reconnect storm into a request storm.
  useEffect(() => {
    wsLog.info('Subscribing to server connection state');

    let wasConnected = false;
    let wasDropped = false;
    let lastRevalidate = 0;
    let hiddenSince = 0;

    const revalidate = (why: string, minInterval = REVALIDATE_MIN_INTERVAL_MS) => {
      if (Date.now() - lastRevalidate < minInterval) return;
      lastRevalidate = Date.now();
      wsLog.info(`Revalidating HomeKit data (${why})`);
      revalidateHomeKitCache();
    };

    const unsubscribeState = serverConnection.subscribe((state) => {
      const connected = state.connectionState === 'connected';
      wsLog.info(`Relay state: ${state.connectionState}`);
      setIsConnected(connected);

      // Coming back from a drop is the one case the general throttle must not
      // swallow: the server's affinity redirect lands within a second of the
      // first connect, and everything in flight was just failed with it. The
      // shorter floor still bounds a genuinely flapping socket.
      if (connected && !wasConnected) {
        revalidate('connected', wasDropped ? RECONNECT_REVALIDATE_MIN_MS : REVALIDATE_MIN_INTERVAL_MS);
        wasDropped = false;
      } else if (!connected && wasConnected) {
        wasDropped = true;
      }
      wasConnected = connected;
    });

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') {
        hiddenSince = Date.now();
        return;
      }
      // A glance away is not an absence. Only a real gap can have cost us
      // events, and re-asking on every tab switch would be pure noise.
      if (hiddenSince && Date.now() - hiddenSince > HIDDEN_GAP_MS) revalidate('foregrounded');
      hiddenSince = 0;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      unsubscribeState();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // Event subscriptions based on mode:
  // - Mac app mode: HomeKit events (external changes) + server broadcasts (programmatic changes)
  // - Browser mode: Server broadcasts only
  useEffect(() => {
    // Local Mode needs this subscription too: it is the only source of
    // *external* changes (someone using Apple Home, a motion sensor firing)
    // when there is no relay pushing broadcasts.
    if (isRelayCapable() || localModeActive) {
      // Mac app mode: subscribe to local HomeKit events for external changes (Apple Home, etc.)
      wsLog.info('Mac mode: subscribing to HomeKit events');

      // HomeKit reports the ids of *this device's* context. In Local Mode the
      // cache is keyed in the cloud's stable space, so events have to cross the
      // same boundary the request path crosses. On the relay Mac the cache is
      // already in live space and `toStable` is an identity function, so this
      // is safe to apply unconditionally.
      const stable = (id: string) => (localModeActive ? localIdentity.toStable(id) : id);

      const unsubscribeHomeKit = HomeKit.onEvent((event) => {
        if (event.type === 'characteristic.updated' && event.characteristicType) {
          const accessoryId = stable(event.accessoryId);
          const key = `${accessoryId}:${event.characteristicType}`;
          wsLog.event(accessoryId, event.characteristicType, event.value);

          characteristicBufferRef.current.set(key, {
            accessoryId,
            homeId: event.homeId ? stable(event.homeId) : null,
            characteristicType: event.characteristicType,
            value: event.value
          });
          scheduleFlush();
        } else if (event.type === 'accessory.reachability' && event.isReachable !== undefined) {
          const accessoryId = stable(event.accessoryId);
          wsLog.reachability(accessoryId, event.isReachable);

          reachabilityBufferRef.current.set(accessoryId, {
            accessoryId,
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
  }, [handleBroadcast, scheduleFlush, localModeActive]);

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
