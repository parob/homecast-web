import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_HISTORY_STORAGE_STATS } from '@/lib/graphql/queries';
import { getRecordableCharacteristics } from '@/components/automations/characteristics';
import { isMockHistoryEnabled } from '@/history/mock';
import type { CategoryId } from '@/history/categories';
import type { HomeKitAccessory, HistoryStorageStatsData } from '@/lib/graphql/types';
import type { HistoryTarget } from '@/components/widgets/HistoryDialog';

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
export type AnalyticsScope =
  | { level: 'home' }
  | { level: 'category'; category: CategoryId; room?: string | null }
  | { level: 'group'; groupId: string }
  | { level: 'accessory'; accessory: HomeKitAccessory };

interface HistoryContextValue {
  /** Gates the menu entries: home opted in + accessory has recordable series. */
  historyAvailable: (accessory: HomeKitAccessory) => boolean;
  /** True when the home records history — gates room/home Analytics entries. */
  analyticsAvailable: boolean;
  /** Open the History screen. No-op outside the dashboard. */
  openHistory: (accessory: HomeKitAccessory) => void;
  /** Open Home Analytics, scoped. Defaults to the overview. */
  openAnalytics: (scope?: AnalyticsScope) => void;
}

const HistoryContext = createContext<HistoryContextValue>({
  historyAvailable: () => false,
  analyticsAvailable: false,
  openHistory: () => {},
  openAnalytics: () => {},
});

interface HistoryProviderProps {
  homeId: string | null;
  onOpenHistory?: (target: HistoryTarget) => void;
  onOpenAnalytics?: (scope: AnalyticsScope) => void;
  children: React.ReactNode;
}

export function HistoryProvider({ homeId, onOpenHistory, onOpenAnalytics, children }: HistoryProviderProps) {
  const mock = isMockHistoryEnabled();

  const { data } = useQuery<{ historyStorageStats: HistoryStorageStatsData }>(
    GET_HISTORY_STORAGE_STATS,
    {
      variables: { homeId },
      skip: !homeId || mock,
      // The flag changes only from Settings; a slow poll keeps other devices
      // in sync without chatter.
      pollInterval: 300_000,
    },
  );
  const enabled = mock || (data?.historyStorageStats?.enabled ?? false);

  const historyAvailable = useCallback((accessory: HomeKitAccessory) => {
    if (!enabled) return false;
    return getRecordableCharacteristics(accessory).length > 0;
  }, [enabled]);

  const openHistory = useCallback((accessory: HomeKitAccessory) => {
    if (!homeId || !onOpenHistory) return;
    onOpenHistory({ homeId, accessory });
  }, [homeId, onOpenHistory]);

  const openAnalytics = useCallback((scope?: AnalyticsScope) => {
    onOpenAnalytics?.(scope ?? { level: 'home' });
  }, [onOpenAnalytics]);

  const value = useMemo(
    () => ({ historyAvailable, analyticsAvailable: enabled, openHistory, openAnalytics }),
    [historyAvailable, enabled, openHistory, openAnalytics],
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
