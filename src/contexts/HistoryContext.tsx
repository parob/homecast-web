import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useApolloClient } from '@apollo/client/react';
import { GET_HISTORY_STORAGE_STATS } from '@/lib/graphql/queries';
import { getRecordableCharacteristics } from '@/components/automations/characteristics';
import { isMockHistoryEnabled } from '@/history/mock';
import type { CategoryId } from '@/history/categories';
import type { HomeKitAccessory, HomeKitServiceGroup, HistoryStorageStatsData } from '@/lib/graphql/types';
import type { HistoryTarget, StatusHistoryScope } from '@/components/widgets/HistoryDialog';

/**
 * Reaches WidgetCard's context menu through context, not props — 28 widget
 * components forward WidgetProps, and threading a callback through all of
 * them is how a previous menu item ended up wired in exactly one place
 * (see the comment above useDeals in WidgetCard).
 */

/**
 * Where Home Analytics opens. Every context menu passes the scope it knows:
 * an accessory menu passes the accessory, a group menu its group, a room
 * menu its room — the surface opens already looking at the right thing.
 */
export type AnalyticsScope = (
  | { level: 'home' }
  | { level: 'category'; category: CategoryId; room?: string | null }
  | { level: 'group'; groupId: string }
  | { level: 'accessory'; accessory: HomeKitAccessory }
) & {
  /** The home this scope belongs to; defaults to the selected home. */
  homeId?: string;
};

interface HistoryContextValue {
  /**
   * The selected home. Accessories off the wire do not always carry a
   * homeId — openHistory has always fallen back to this — so anything
   * deriving a home from an accessory needs the same fallback.
   */
  defaultHomeId: string | null;
  /** Gates the menu entries: home opted in + accessory has recordable series. */
  historyAvailable: (accessory: HomeKitAccessory) => boolean;
  /** True when the SELECTED home records history. */
  analyticsAvailable: boolean;
  /** Per-home gate — sidebar items belong to homes other than the selected
   *  one, and a home with history off must not offer Analytics at all. */
  analyticsAvailableFor: (homeId: string | undefined | null) => boolean;
  /** Open the compact history popup for one accessory. */
  openHistory: (accessory: HomeKitAccessory) => void;
  /** Open the compact history popup for a group (aggregated members). */
  openGroupHistory: (group: HomeKitServiceGroup) => void;
  /** Open the compact history popup for the Status bubbles of an area. */
  openStatusHistory: (homeId: string, status: StatusHistoryScope) => void;
  /** Open Home Analytics, scoped. Defaults to the overview. */
  openAnalytics: (scope?: AnalyticsScope) => void;
}

const HistoryContext = createContext<HistoryContextValue>({
  defaultHomeId: null,
  historyAvailable: () => false,
  analyticsAvailable: false,
  analyticsAvailableFor: () => false,
  openHistory: () => {},
  openGroupHistory: () => {},
  openStatusHistory: () => {},
  openAnalytics: () => {},
});

interface HistoryProviderProps {
  homeId: string | null;
  /** Every home the dashboard shows — the per-home opt-in map covers all. */
  homeIds?: string[];
  onOpenHistory?: (target: HistoryTarget) => void;
  onOpenAnalytics?: (scope: AnalyticsScope) => void;
  /**
   * The homes that record, as the poll learns them. The Analytics tree lists
   * them so you can switch home without leaving the screen, and the host owns
   * that dialog — it cannot consume the provider it renders.
   */
  onRecordingHomesChange?: (homeIds: string[]) => void;
  children: React.ReactNode;
}

export function HistoryProvider({
  homeId, homeIds, onOpenHistory, onOpenAnalytics, onRecordingHomesChange, children,
}: HistoryProviderProps) {
  const mock = isMockHistoryEnabled();
  const client = useApolloClient();

  // Per-home opt-in map. The flag changes only from Settings; a slow poll
  // keeps other devices in sync without chatter.
  const [enabledByHome, setEnabledByHome] = useState<Map<string, boolean>>(new Map());
  const homeIdsKey = (homeIds ?? (homeId ? [homeId] : [])).join(',');
  useEffect(() => {
    if (mock) return;
    const ids = homeIdsKey ? homeIdsKey.split(',') : [];
    if (ids.length === 0) return;
    let cancelled = false;
    const load = async () => {
      const next = new Map<string, boolean>();
      for (const id of ids) {
        try {
          const result = await client.query<{ historyStorageStats: HistoryStorageStatsData }>({
            query: GET_HISTORY_STORAGE_STATS,
            variables: { homeId: id },
            fetchPolicy: 'network-only',
          });
          next.set(id.toUpperCase(), result.data?.historyStorageStats?.enabled ?? false);
        } catch { /* home unreachable — treat as off */ }
      }
      if (!cancelled) setEnabledByHome(next);
    };
    void load();
    const timer = setInterval(() => void load(), 300_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [client, homeIdsKey, mock]);

  const notifyRef = useRef(onRecordingHomesChange);
  notifyRef.current = onRecordingHomesChange;
  useEffect(() => {
    if (mock) {
      notifyRef.current?.(homeIdsKey ? homeIdsKey.split(',') : []);
      return;
    }
    notifyRef.current?.([...enabledByHome.entries()].filter(([, on]) => on).map(([id]) => id));
  }, [enabledByHome, mock, homeIdsKey]);

  const analyticsAvailableFor = useCallback((forHomeId: string | undefined | null) => {
    if (mock) return true;
    if (!forHomeId) return false;
    return enabledByHome.get(forHomeId.toUpperCase()) ?? false;
  }, [mock, enabledByHome]);

  const enabled = analyticsAvailableFor(homeId);

  const historyAvailable = useCallback((accessory: HomeKitAccessory) => {
    if (!analyticsAvailableFor(accessory.homeId ?? homeId)) return false;
    return getRecordableCharacteristics(accessory).length > 0;
  }, [analyticsAvailableFor, homeId]);

  const openHistory = useCallback((accessory: HomeKitAccessory) => {
    if (!homeId || !onOpenHistory) return;
    onOpenHistory({ homeId: accessory.homeId ?? homeId, accessory });
  }, [homeId, onOpenHistory]);

  const openGroupHistory = useCallback((group: HomeKitServiceGroup) => {
    const groupHomeId = group.homeId ?? homeId;
    if (!groupHomeId || !onOpenHistory) return;
    onOpenHistory({
      homeId: groupHomeId,
      group: { id: group.id, name: group.name, memberIds: group.accessoryIds },
    });
  }, [homeId, onOpenHistory]);

  const openStatusHistory = useCallback((statusHomeId: string, status: StatusHistoryScope) => {
    if (!onOpenHistory || status.categories.length === 0) return;
    onOpenHistory({ homeId: statusHomeId, status });
  }, [onOpenHistory]);

  const openAnalytics = useCallback((scope?: AnalyticsScope) => {
    onOpenAnalytics?.(scope ?? { level: 'home' });
  }, [onOpenAnalytics]);

  const value = useMemo(
    () => ({
      defaultHomeId: homeId,
      historyAvailable, analyticsAvailable: enabled, analyticsAvailableFor,
      openHistory, openGroupHistory, openStatusHistory, openAnalytics,
    }),
    [homeId, historyAvailable, enabled, analyticsAvailableFor, openHistory, openGroupHistory, openStatusHistory, openAnalytics],
  );

  return (
    <HistoryContext.Provider value={value}>
      {children}
    </HistoryContext.Provider>
  );
}

export function useHistory(): HistoryContextValue {
  return useContext(HistoryContext);
}
