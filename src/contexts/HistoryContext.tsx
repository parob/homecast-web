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

/**
 * Where Analytics reads its history from.
 *
 * `null` means the authenticated documents, which is every signed-in surface.
 * A share link has no session — the hash is the whole credential — so it reads
 * through the `publicEntity*` documents instead. Putting this on the context
 * rather than threading a prop keeps the two analytics hooks as the only code
 * that knows there is more than one transport at all.
 */
export interface AnalyticsTransport {
  kind: 'share';
  shareHash: string;
  passcode?: string | null;
}

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
  /**
   * Open the compact history popup for a group (aggregated members).
   * `members` is only used to name the lines when an aggregate is split
   * apart — the recorded-series listing carries no names.
   */
  openGroupHistory: (group: HomeKitServiceGroup, members?: HomeKitAccessory[]) => void;
  /** Open the compact history popup for the Status bubbles of an area. */
  openStatusHistory: (homeId: string, status: StatusHistoryScope) => void;
  /** Open Home Analytics, scoped. Defaults to the overview. */
  openAnalytics: (scope?: AnalyticsScope) => void;
  /** Which documents the analytics hooks should use. null = authenticated. */
  transport: AnalyticsTransport | null;
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
  transport: null,
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

  const openGroupHistory = useCallback((group: HomeKitServiceGroup, members?: HomeKitAccessory[]) => {
    const groupHomeId = group.homeId ?? homeId;
    if (!groupHomeId || !onOpenHistory) return;
    const memberNames = members?.length
      ? Object.fromEntries(members.map(a => [a.id.toUpperCase(), a.name]))
      : undefined;
    onOpenHistory({
      homeId: groupHomeId,
      group: { id: group.id, name: group.name, memberIds: group.accessoryIds, memberNames },
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
      transport: null,
    }),
    [homeId, historyAvailable, enabled, analyticsAvailableFor, openHistory, openGroupHistory, openStatusHistory, openAnalytics],
  );

  return (
    <HistoryContext.Provider value={value}>
      {children}
    </HistoryContext.Provider>
  );
}

interface SharedHistoryProviderProps {
  /** The share this page was opened with — the whole credential. */
  shareHash: string;
  passcode?: string | null;
  /** The shared entity's home, for the popup's per-home queries. */
  homeId: string | null;
  /**
   * `publicEntity.analyticsEnabled` — the home records AND its owner chose to
   * publish that to link holders. One boolean, because a link holder has no
   * remedy for either half and telling them apart would leak whether a home
   * records at all.
   */
  enabled: boolean;
  onOpenHistory?: (target: HistoryTarget) => void;
  onOpenAnalytics?: (scope: AnalyticsScope) => void;
  children: React.ReactNode;
}

/**
 * The Analytics gate for a public share page.
 *
 * A second provider rather than a mode flag on HistoryProvider, for one
 * structural reason: HistoryProvider polls GET_HISTORY_STORAGE_STATS, an
 * authenticated query, every five minutes. On an anonymous page that must not
 * merely be skipped — it must be absent, so no future edit can reintroduce it
 * behind a condition. This provider simply has no query in it.
 *
 * It writes the SAME context, which is the point. Until now a shared page had
 * no provider at all, so `useHistory()` fell through to the module default and
 * every affordance vanished — correct behaviour that nobody had decided and no
 * test covered. Every consumer (WidgetCard's context menu and expanded-panel
 * button, ServiceGroupWidget's, AreaSummary's status chart, HistoryDialog's
 * "Open in Analytics") now reads a real answer, and anything added later
 * inherits the gate without being touched.
 */
export function SharedHistoryProvider({
  shareHash, passcode, homeId, enabled, onOpenHistory, onOpenAnalytics, children,
}: SharedHistoryProviderProps) {
  const analyticsAvailableFor = useCallback(
    // Not per-home: a share names one home, and `enabled` was computed for it
    // server-side. Accepting any id and answering the same thing keeps the
    // shape identical to HistoryProvider's for every consumer.
    (_forHomeId: string | undefined | null) => enabled,
    [enabled],
  );

  const historyAvailable = useCallback((accessory: HomeKitAccessory) => {
    if (!enabled) return false;
    return getRecordableCharacteristics(accessory).length > 0;
  }, [enabled]);

  // Each opener re-checks `enabled` rather than trusting that it was never
  // rendered: a callback captured before the flag changed must not still open
  // a surface the owner has since closed.
  const openHistory = useCallback((accessory: HomeKitAccessory) => {
    if (!enabled || !onOpenHistory) return;
    const target = accessory.homeId ?? homeId;
    if (!target) return;
    onOpenHistory({ homeId: target, accessory });
  }, [enabled, homeId, onOpenHistory]);

  const openGroupHistory = useCallback((group: HomeKitServiceGroup) => {
    if (!enabled || !onOpenHistory) return;
    const groupHomeId = group.homeId ?? homeId;
    if (!groupHomeId) return;
    onOpenHistory({
      homeId: groupHomeId,
      group: { id: group.id, name: group.name, memberIds: group.accessoryIds },
    });
  }, [enabled, homeId, onOpenHistory]);

  const openStatusHistory = useCallback((statusHomeId: string, status: StatusHistoryScope) => {
    if (!enabled || !onOpenHistory || status.categories.length === 0) return;
    onOpenHistory({ homeId: statusHomeId, status });
  }, [enabled, onOpenHistory]);

  const openAnalytics = useCallback((scope?: AnalyticsScope) => {
    if (!enabled) return;
    onOpenAnalytics?.(scope ?? { level: 'home' });
  }, [enabled, onOpenAnalytics]);

  const value = useMemo(
    () => ({
      defaultHomeId: homeId,
      historyAvailable,
      analyticsAvailable: enabled,
      analyticsAvailableFor,
      openHistory, openGroupHistory, openStatusHistory, openAnalytics,
      // No transport while the gate is shut, so a stray query cannot be built
      // from it either.
      transport: enabled ? { kind: 'share' as const, shareHash, passcode } : null,
    }),
    [homeId, historyAvailable, enabled, analyticsAvailableFor, openHistory,
     openGroupHistory, openStatusHistory, openAnalytics, shareHash, passcode],
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
