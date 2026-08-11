import React, { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_HISTORY_STORAGE_STATS } from '@/lib/graphql/queries';
import { getRecordableCharacteristics } from '@/components/automations/characteristics';
import { isMockHistoryEnabled } from '@/history/mock';
import type { HomeKitAccessory, HomeKitServiceGroup, HistoryStorageStatsData } from '@/lib/graphql/types';
import type { HistoryTarget } from '@/components/widgets/HistoryDialog';

/**
 * Reaches WidgetCard's context menu through context, not props — 28 widget
 * components forward WidgetProps, and threading a callback through all of
 * them is how a previous menu item ended up wired in exactly one place
 * (see the comment above useDeals in WidgetCard).
 */
interface HistoryContextValue {
  /** Gates the menu entry: home opted in + accessory has recordable series. */
  historyAvailable: (accessory: HomeKitAccessory) => boolean;
  /** Open the History screen. No-op outside the dashboard. */
  openHistory: (accessory: HomeKitAccessory) => void;
  /** Open the Explorer dialog (multi-sensor comparison). */
  openExplorer: () => void;
  /** Open the Explorer pre-loaded with a service group's members. */
  openGroupHistory: (group: HomeKitServiceGroup, members: HomeKitAccessory[]) => void;
}

const HistoryContext = createContext<HistoryContextValue>({
  historyAvailable: () => false,
  openHistory: () => {},
  openExplorer: () => {},
  openGroupHistory: () => {},
});

interface HistoryProviderProps {
  homeId: string | null;
  onOpenHistory?: (target: HistoryTarget) => void;
  onOpenExplorer?: () => void;
  onOpenGroupHistory?: (group: HomeKitServiceGroup, members: HomeKitAccessory[]) => void;
  children: React.ReactNode;
}

export function HistoryProvider({ homeId, onOpenHistory, onOpenExplorer, onOpenGroupHistory, children }: HistoryProviderProps) {
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

  const openExplorer = useCallback(() => {
    onOpenExplorer?.();
  }, [onOpenExplorer]);

  const openGroupHistory = useCallback((group: HomeKitServiceGroup, members: HomeKitAccessory[]) => {
    if (!enabled) return;
    onOpenGroupHistory?.(group, members);
  }, [enabled, onOpenGroupHistory]);

  const value = useMemo(
    () => ({ historyAvailable, openHistory, openExplorer, openGroupHistory }),
    [historyAvailable, openHistory, openExplorer, openGroupHistory],
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
