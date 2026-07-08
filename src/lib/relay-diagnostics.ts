/**
 * Relay-offline diagnostics.
 *
 * The "relay offline" banner is driven by a single `relayConnected` boolean
 * from homes.list, which can be transiently false while a relay blips
 * (the server deletes the relay session row on any WS drop). When the banner
 * appears we capture a full snapshot of how the client got there — the homes
 * data, cache age, WS state, and the recent relay_status_update broadcasts —
 * and ship it to Cloud Logging so field occurrences are diagnosable without
 * asking the user to reproduce.
 */

import { browserLogger } from '@/lib/browser-logger';
import { serverConnection } from '@/server/connection';
import { config } from '@/lib/config';
import { getCacheTimestamp } from '@/hooks/useHomeKitData';
import type { HomeKitHome } from '@/native/homekit-bridge';

// ---------------------------------------------------------------------------
// relay_status_update history — the broadcasts are the only push channel for
// relay state, so knowing what we received (and when) is essential to tell
// "server said offline" apart from "we fetched during a blip / missed the
// reconnect broadcast".
// ---------------------------------------------------------------------------

interface RecordedStatusUpdate {
  receivedAt: string;
  payload: unknown;
}

const MAX_STATUS_UPDATES = 10;
const recentStatusUpdates: RecordedStatusUpdate[] = [];

/** Record a relay_status_update broadcast verbatim (shape varies between the
 *  local path `{homeId, connected}` and the cross-pod path `{home_ids, connected}`). */
export function recordRelayStatusUpdate(payload: unknown): void {
  recentStatusUpdates.push({ receivedAt: new Date().toISOString(), payload });
  if (recentStatusUpdates.length > MAX_STATUS_UPDATES) {
    recentStatusUpdates.splice(0, recentStatusUpdates.length - MAX_STATUS_UPDATES);
  }
}

export function getRecentRelayStatusUpdates(): RecordedStatusUpdate[] {
  return [...recentStatusUpdates];
}

// ---------------------------------------------------------------------------
// Diagnostics bundle — shared by the /diagnostics page and the offline banner's
// "Copy diagnostics" button.
// ---------------------------------------------------------------------------

export function buildDiagnosticsBundle(extra?: Record<string, unknown>) {
  const conn = serverConnection.getState();
  return {
    generatedAt: new Date().toISOString(),
    app: {
      version: config.version,
      apiUrl: config.apiUrl,
      isCommunity: config.isCommunity,
      isStaging: config.isStaging,
    },
    connection: {
      state: conn.connectionState,
      isActive: conn.isActive,
      relayStatus: conn.relayStatus,
      error: conn.error ? String(conn.error) : null,
    },
    userAgent: navigator.userAgent,
    ...(extra || {}),
    entries: browserLogger.getEntries().slice(-500),
  };
}

// ---------------------------------------------------------------------------
// Relay-offline snapshot
// ---------------------------------------------------------------------------

export type RelayOfflineTrigger =
  | 'grace-elapsed'        // offline persisted past the 120s dashboard grace
  | 'no-accessories-data'  // fresh load / never-loaded home — banner shown immediately
  | 'setup-state-render';  // RelayOfflineState mounted (non-dashboard path)

export interface RelayOfflineSnapshot {
  trigger: RelayOfflineTrigger;
  homeId: string | null;
  relayConnected: boolean | undefined;
  relayState: string | undefined;
  relayLastSeenAt: string | null | undefined;
  relayLastSeenAgeSeconds: number | null;
  isCloudManaged: boolean | undefined;
  role: string | undefined;
  offlineHomeIds: string[];
  homesCacheAgeSeconds: number | null;
  wsConnectionState: string;
  recentRelayStatusUpdates: RecordedStatusUpdate[];
  secondsSincePageLoad: number;
  appVersion: string;
}

export function buildRelayOfflineSnapshot(args: {
  trigger: RelayOfflineTrigger;
  homes: HomeKitHome[];
  homeId?: string | null;
}): RelayOfflineSnapshot {
  const { trigger, homes, homeId } = args;
  const home = homeId ? homes.find(h => h.id === homeId) : undefined;
  const lastSeen = home?.relayLastSeenAt;
  let lastSeenAge: number | null = null;
  if (lastSeen) {
    const parsed = Date.parse(lastSeen);
    if (!Number.isNaN(parsed)) lastSeenAge = Math.round((Date.now() - parsed) / 1000);
  }
  const homesCacheTs = getCacheTimestamp('homes');
  return {
    trigger,
    homeId: homeId ?? null,
    relayConnected: home?.relayConnected,
    relayState: home?.relayState,
    relayLastSeenAt: lastSeen,
    relayLastSeenAgeSeconds: lastSeenAge,
    isCloudManaged: home?.isCloudManaged,
    role: home?.role,
    offlineHomeIds: homes.filter(h => h.relayConnected === false).map(h => h.id),
    homesCacheAgeSeconds: homesCacheTs ? Math.round((Date.now() - homesCacheTs) / 1000) : null,
    wsConnectionState: serverConnection.getState().connectionState,
    recentRelayStatusUpdates: getRecentRelayStatusUpdates(),
    secondsSincePageLoad: Math.round(performance.now() / 1000),
    appVersion: config.version,
  };
}

/** Ship the snapshot to Cloud Logging as a WARNING and flush immediately so
 *  rare field occurrences aren't lost to the 30s flush interval.
 *
 *  Deduped per home: the Dashboard rising-edge effect and the banner
 *  component's mount effect both call this (each covers renders the other
 *  can't see), so back-to-back calls within the window collapse to one entry. */
const LOG_DEDUPE_WINDOW_MS = 10_000;
const lastLoggedAt = new Map<string, number>();

export function logRelayOfflineBanner(snapshot: RelayOfflineSnapshot): void {
  const key = snapshot.homeId ?? snapshot.offlineHomeIds.join(',');
  const last = lastLoggedAt.get(key);
  if (last && Date.now() - last < LOG_DEDUPE_WINDOW_MS) return;
  lastLoggedAt.set(key, Date.now());
  browserLogger.logWarn('relay_offline_banner_shown', { ...snapshot });
  void browserLogger.flushNow();
}
