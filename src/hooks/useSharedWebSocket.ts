import { useEffect, useRef, useCallback, useState } from 'react';
import type { HomeKitAccessory, HomeKitServiceGroup } from '@/lib/graphql/types';
import { config as appConfig } from '@/lib/config';
import { getBrowserSessionId } from '@/server/connection';
import {
  INITIAL_RECONNECT_DELAY, nextReconnectDelay, jitter, isSocketStale,
} from '@/server/reconnect-policy';
import {
  type ConnectionQuality, type HysteresisState, type SocketState,
  classifyQuality, applyHysteresis, initialHysteresis, pushRtt,
} from '@/server/connection-quality';

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

  // ── Connection quality ────────────────────────────────────────────────────
  // A share link had the least of any surface here: no staleness detection at
  // all, so a half-open socket never recovered; a flat 3s reconnect with no
  // backoff or jitter; and `isConnected` computed and then never rendered by
  // any of the six views that destructure it. The viewer has no account, no
  // history and — with no pull-to-refresh on these pages — no way to re-ask.
  const [quality, setQuality] = useState<ConnectionQuality>('unknown');
  const qualityStateRef = useRef<HysteresisState>(initialHysteresis('unknown'));
  const lastInboundAtRef = useRef(0);
  const lastPingSentAtRef = useRef<number | null>(null);
  const rttSamplesRef = useRef<number[]>([]);
  const lastRttAtRef = useRef(0);
  /** Grows per failed attempt, reset on a successful open. */
  const reconnectDelayRef = useRef(INITIAL_RECONNECT_DELAY);

  const socketStateRef = useRef<{ state: SocketState; since: number }>({
    state: 'connecting',
    since: Date.now(),
  });

  const evaluateQuality = useCallback((socketConnected: boolean) => {
    const now = Date.now();
    const state: SocketState = socketConnected ? 'connected' : 'disconnected';
    if (socketStateRef.current.state !== state) {
      socketStateRef.current = { state, since: now };
    }
    const raw = classifyQuality({
      socketState: state,
      socketStateSince: socketStateRef.current.since,
      rttSamples: rttSamplesRef.current,
      lastRttAt: lastRttAtRef.current,
      // This socket is push-only — there are no requests to be outstanding —
      // so the in-flight signal simply does not apply here.
      oldestInFlightSentAt: null,
      consecutiveFailures: 0,
    }, now);
    const next = applyHysteresis(qualityStateRef.current, raw, now);
    if (next.shown !== qualityStateRef.current.shown) setQuality(next.shown);
    qualityStateRef.current = next;
  }, []);

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

  // Tear down the current socket without letting its onclose schedule a reconnect
  const teardownSocket = useCallback(() => {
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    const ws = wsRef.current;
    if (ws) {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
      wsRef.current = null;
    }
  }, []);

  // Connect to WebSocket
  const connect = useCallback(() => {
    if (!shareHash) return;

    // Already connected (or connecting) — nothing to do
    const existing = wsRef.current;
    if (existing && (existing.readyState === WebSocket.OPEN || existing.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    // Never hold two sockets — replace any lingering one
    teardownSocket();

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
      // A socket that just opened has legitimately heard nothing yet; stamping
      // it here is what stops `isSocketStale` firing on a brand-new connection.
      lastInboundAtRef.current = Date.now();
      lastPingSentAtRef.current = null;
      // Samples from the previous socket describe a connection that no longer
      // exists. Start from "unknown" and let the first pong answer it.
      rttSamplesRef.current = [];
      lastRttAtRef.current = 0;
      reconnectDelayRef.current = INITIAL_RECONNECT_DELAY;
      evaluateQuality(true);

      // Subscribe to share hash. browserSessionId lets the server replace this
      // tab's previous session instead of accumulating a new one per socket.
      ws.send(JSON.stringify({
        type: 'subscribe',
        shareHash,
        passcode: passcode || undefined,
        browserSessionId: getBrowserSessionId()
      }));

      // Measure the round trip at once rather than after the first interval.
      // The pong is the only source of samples, so without this a share page
      // spends its first 30 seconds unable to say anything about a connection
      // that is working fine.
      lastPingSentAtRef.current = Date.now();
      ws.send(JSON.stringify({ type: 'ping' }));

      // Start ping interval to keep connection alive
      pingIntervalRef.current = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return;

        // A half-open socket reports OPEN forever: TCP is up, the peer is gone,
        // and no `onclose` will ever fire. The main client has guarded against
        // this since `isSocketStale` was written; this one never did, so a
        // shared page could sit on dead-but-confident data indefinitely with
        // no reconnect and — these pages having no pull-to-refresh — nothing
        // the viewer could do about it.
        if (isSocketStale(lastInboundAtRef.current, Date.now())) {
          console.warn('[SharedWS] No traffic — treating socket as dead and reconnecting');
          try { ws.close(); } catch { /* already gone */ }
          return;
        }

        // An unanswered ping is itself the measurement: the round trip has
        // already exceeded a whole interval. Recorded as a lower bound rather
        // than discarded.
        if (lastPingSentAtRef.current !== null) {
          rttSamplesRef.current = pushRtt(rttSamplesRef.current, Date.now() - lastPingSentAtRef.current);
          lastRttAtRef.current = Date.now();
        }
        lastPingSentAtRef.current = Date.now();
        ws.send(JSON.stringify({ type: 'ping' }));
        evaluateQuality(true);
      }, 30000);
    };

    ws.onmessage = (event) => {
      // Anything arriving is proof the peer is still there — the only evidence
      // there is, since readyState cannot tell a live socket from a half-open one.
      lastInboundAtRef.current = Date.now();
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
        } else if (message.type === 'pong') {
          // The round trip. The shared endpoint has always replied to a client
          // ping with a bare pong (web_clients.py, shared_view_endpoint), so
          // this needed no protocol change — the answer was simply never read.
          if (lastPingSentAtRef.current !== null) {
            rttSamplesRef.current = pushRtt(rttSamplesRef.current, Date.now() - lastPingSentAtRef.current);
            lastPingSentAtRef.current = null;
            lastRttAtRef.current = Date.now();
            evaluateQuality(true);
          }
        }
      } catch (error) {
        console.error('[SharedWS] Parse error:', error);
      }
    };

    ws.onclose = (event) => {
      // A stale socket's close must never clobber the live socket's state
      if (wsRef.current !== ws) return;

      console.log(`[SharedWS] Disconnected: ${event.code} ${event.reason}`);
      wsRef.current = null;
      setIsConnected(false);
      setIsSubscribed(false);

      // Clear ping interval
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }

      evaluateQuality(false);

      // Reconnect after delay (unless access denied or replaced by a newer connection)
      if (![4001, 4002, 4003].includes(event.code)) {
        // Was a flat 3s with no backoff and no jitter. Against a server that is
        // down or restarting, that is every viewer of every share retrying in
        // lockstep, twenty times a minute, for as long as it lasts. Same policy
        // as the main client now (`reconnect-policy.ts`), including the ±20%
        // jitter that keeps a crowd from arriving together.
        const delay = jitter(reconnectDelayRef.current);
        reconnectDelayRef.current = nextReconnectDelay(reconnectDelayRef.current, false);
        reconnectTimeoutRef.current = setTimeout(() => {
          console.log('[SharedWS] Reconnecting...');
          connect();
        }, delay);
      }
    };

    ws.onerror = (error) => {
      console.error('[SharedWS] Error:', error);
    };
  }, [shareHash, passcode, scheduleFlush, teardownSocket, evaluateQuality]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    // Flush any pending updates before disconnecting
    if (flushTimeoutRef.current) {
      clearTimeout(flushTimeoutRef.current);
      flushTimeoutRef.current = null;
    }
    flushBufferedUpdates();
    // Detaches onclose before closing, so an intentional disconnect
    // (unmount, tab hidden) can never schedule a reconnect
    teardownSocket();
    setIsConnected(false);
    setIsSubscribed(false);
  }, [flushBufferedUpdates, teardownSocket]);

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
    /** How well this connection is working — see server/connection-quality.ts. */
    quality,
    isSubscribed,
    subscribeError,
    disconnect,
    setOnCharacteristicUpdate,
    setOnReachabilityUpdate,
    setOnServiceGroupUpdate
  };
}

/**
 * Parse a broadcast value to a raw JS value matching the format HomeKit
 * returns (boolean, number, string). Broadcast values may arrive as raw
 * values or as JSON-encoded strings (e.g. "true" instead of true) depending
 * on the code path (relay vs GraphQL mutation).
 */
function parseValue(value: any): any {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
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
  const parsed = parseValue(value);

  return accessories.map(acc => {
    if (acc.id !== accessoryId) return acc;
    return {
      ...acc,
      services: (acc.services || []).map(service => ({
        ...service,
        characteristics: (service.characteristics || []).map(char => {
          if (char.characteristicType !== characteristicType) return char;
          return { ...char, value: parsed };
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
  const parsed = parseValue(value);

  // For power-related characteristics, update both 'on' and 'power_state'
  const charTypes = (characteristicType === 'on' || characteristicType === 'power_state')
    ? ['on', 'power_state']
    : [characteristicType];

  return accessories.map(acc => {
    const normalizedId = acc.id.replace(/-/g, '').toLowerCase();
    if (!memberIds.has(normalizedId)) return acc;
    return {
      ...acc,
      services: (acc.services || []).map(service => ({
        ...service,
        characteristics: (service.characteristics || []).map(char => {
          if (!charTypes.includes(char.characteristicType)) return char;
          return { ...char, value: parsed };
        })
      }))
    };
  });
}
