import { useCallback, useMemo, useState } from 'react';
import { getDisplayName } from '@/lib/graphql/types';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

/**
 * Analytics is scoped to a PLACE, not to a data category.
 *
 * The old model made Climate/Activity/Energy/… the top axis and put the room
 * inside it as a filter chip, so "how is Bedroom 2 doing?" meant picking a
 * category first and reading the answer across five of them — and a category
 * view could never reach the accessory screen at all. A home is rooms and
 * accessories; the tree says so, and each category becomes a SECTION of
 * whatever scope you are standing in.
 */
export type AnalyticsScope =
  | { level: 'home' }
  /** `room: null` is the roomless bucket (virtual accessories, Default Room). */
  | { level: 'room'; room: string | null }
  | { level: 'accessory'; accessoryId: string }
  | { level: 'group'; groupId: string };

export const RANGES = [
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '1y', ms: 365 * 86_400_000 },
] as const;

/**
 * How you are looking, as opposed to what at: a property of the SESSION, not
 * of the screen. Picking 7d and then opening a room used to drop you back to
 * 24h, because each view owned its own copy. One object, held above the
 * scope, so moving around never silently changes the window.
 */
export interface AnalyticsSettings {
  rangeMs: number;
}

export const DEFAULT_SETTINGS: AnalyticsSettings = {
  rangeMs: 24 * 3_600_000,
};

export interface ScopeAccessory {
  id: string;
  name: string;
  /** Recorded characteristic count — what the tree can promise is there. */
  seriesCount: number;
  /** What kind of thing it is, for the row's icon. */
  widgetType?: string;
}

export interface ScopeGroupNode {
  id: string;
  name: string;
  memberCount: number;
  /** Recorded members, for nesting under the group. */
  members: ScopeAccessory[];
}

export interface ScopeRoom {
  /** null = the roomless bucket. */
  room: string | null;
  label: string;
  /** Groups whose recorded members all live in this room. */
  groups: ScopeGroupNode[];
  /** Accessories in this room that no such group already covers. */
  accessories: ScopeAccessory[];
  /** Everything recording here, grouped or not — what the count means. */
  total: number;
}

export interface ScopeTreeModel {
  rooms: ScopeRoom[];
  /** Groups that span rooms, so they belong to no single one. */
  groups: ScopeGroupNode[];
  accessoryCount: number;
}

/**
 * The navigable shape of the home: only what actually has recorded history.
 *
 * An accessory with nothing recorded is not a place you can go — listing it
 * would be the tree's own version of the data overload this rework exists to
 * end.
 */
export function buildScopeTree(
  recorded: HistorySeriesInfo[],
  accessoryInfo: Map<string, AccessoryInfoEntry>,
  groups: Array<{ id: string; name: string; memberIds: string[] }>,
  /** Room names in the order the main navigation shows them. */
  roomOrder: string[] = [],
): ScopeTreeModel {
  const counts = new Map<string, number>();
  for (const series of recorded) {
    if (series.enabled === false) continue;
    const id = series.accessoryId.toUpperCase();
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const accessoryOf = (id: string): ScopeAccessory | null => {
    const info = accessoryInfo.get(id);
    const seriesCount = counts.get(id);
    // getDisplayName, not our own stripper: an accessory is named the same
    // here as it is on the dashboard, by the same rule.
    return info && seriesCount
      ? {
        id,
        name: getDisplayName(info.name, info.room ?? undefined),
        seriesCount,
        widgetType: info.widgetType,
      }
      : null;
  };
  const roomOf = (id: string) => accessoryInfo.get(id)?.room ?? null;
  const roomKeyOf = (room: string | null) => room ?? ' roomless';

  // A group is a room's when everything recording in it lives there; a group
  // spanning rooms belongs to none of them and sits on its own.
  const nodes = groups.flatMap(group => {
    const members = group.memberIds
      .map(id => accessoryOf(id.toUpperCase()))
      .filter((a): a is ScopeAccessory => a !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (members.length < 2) return [];
    const rooms = new Set(members.map(m => roomOf(m.id)));
    return [{
      node: { id: group.id, name: group.name, memberCount: members.length, members },
      room: rooms.size === 1 ? [...rooms][0] : undefined,
    }];
  });

  const groupsByRoom = new Map<string, ScopeGroupNode[]>();
  const claimed = new Set<string>();
  for (const { node, room } of nodes) {
    if (room === undefined) continue;
    const key = roomKeyOf(room);
    groupsByRoom.set(key, [...(groupsByRoom.get(key) ?? []), node]);
    // A grouped accessory is reachable through its group; listing it twice
    // is how a room of nine downlights filled the sidebar.
    node.members.forEach(m => claimed.add(m.id));
  }

  const byRoom = new Map<string, ScopeAccessory[]>();
  const totals = new Map<string, number>();
  for (const id of counts.keys()) {
    const accessory = accessoryOf(id);
    if (!accessory) continue;
    const key = roomKeyOf(roomOf(id));
    totals.set(key, (totals.get(key) ?? 0) + 1);
    if (claimed.has(id)) continue;
    byRoom.set(key, [...(byRoom.get(key) ?? []), accessory]);
  }

  const rooms: ScopeRoom[] = [...new Set([...byRoom.keys(), ...groupsByRoom.keys()])]
    .map(key => ({
      room: key === ' roomless' ? null : key,
      label: key === ' roomless' ? 'Elsewhere' : key,
      groups: (groupsByRoom.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      accessories: (byRoom.get(key) ?? []).sort((a, b) => a.name.localeCompare(b.name)),
      total: totals.get(key) ?? 0,
    }))
    // The order the sidebar uses, so the two navigations agree; rooms it
    // doesn't know fall in alphabetically after. Roomless last either way:
    // it is a leftovers bucket, not a place in the house.
    .sort((a, b) => {
      if (a.room === null) return 1;
      if (b.room === null) return -1;
      const ai = roomOrder.indexOf(a.label);
      const bi = roomOrder.indexOf(b.label);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.label.localeCompare(b.label);
    });

  const crossRoom = nodes
    .filter(n => n.room === undefined)
    .map(n => n.node)
    .sort((a, b) => a.name.localeCompare(b.name));

  // Resolved, not recorded: an id whose accessory has not arrived yet cannot
  // be placed in a room, and counting it made an empty tree look populated —
  // which is how the sidebar came to say Nothing matches "" with no filter.
  const placed = rooms.reduce(
    (n, r) => n + r.accessories.length + r.groups.reduce((m, g) => m + g.members.length, 0),
    0,
  );
  return { rooms, groups: crossRoom, accessoryCount: placed };
}

/** Where you are, in words — the header's breadcrumb. */
export function scopeCrumbs(
  scope: AnalyticsScope,
  homeName: string,
  accessoryInfo: Map<string, AccessoryInfoEntry>,
  groups: Array<{ id: string; name: string }>,
): Array<{ label: string; scope: AnalyticsScope }> {
  const home = { label: homeName, scope: { level: 'home' } as AnalyticsScope };
  switch (scope.level) {
    case 'home':
      return [home];
    case 'room':
      return [home, { label: scope.room ?? 'Elsewhere', scope }];
    case 'accessory': {
      const info = accessoryInfo.get(scope.accessoryId.toUpperCase());
      const crumbs = [home];
      if (info?.room) crumbs.push({ label: info.room, scope: { level: 'room', room: info.room } });
      crumbs.push({ label: info?.name ?? 'Accessory', scope });
      return crumbs;
    }
    case 'group': {
      const group = groups.find(g => g.id === scope.groupId);
      return [home, { label: group?.name ?? 'Group', scope }];
    }
  }
}

export interface AnalyticsScopeState {
  scope: AnalyticsScope;
  settings: AnalyticsSettings;
  setScope: (next: AnalyticsScope) => void;
  setSettings: (next: Partial<AnalyticsSettings>) => void;
  back: () => void;
  canGoBack: boolean;
}

export function useAnalyticsScope(initial?: AnalyticsScope): AnalyticsScopeState {
  const [history, setHistory] = useState<AnalyticsScope[]>([initial ?? { level: 'home' }]);
  const [settings, setSettingsState] = useState<AnalyticsSettings>(DEFAULT_SETTINGS);

  const setScope = useCallback((next: AnalyticsScope) => {
    setHistory(h => [...h, next]);
  }, []);
  const back = useCallback(() => {
    setHistory(h => (h.length > 1 ? h.slice(0, -1) : h));
  }, []);
  const setSettings = useCallback((next: Partial<AnalyticsSettings>) => {
    setSettingsState(s => ({ ...s, ...next }));
  }, []);

  return useMemo(() => ({
    scope: history[history.length - 1],
    settings,
    setScope,
    setSettings,
    back,
    canGoBack: history.length > 1,
  }), [history, settings, setScope, setSettings, back]);
}
