import { useCallback, useMemo, useState } from 'react';
import { analyticsWindowEnd } from '@/history/seriesCache';
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
  | { level: 'group'; groupId: string }
  /** A user-defined group of rooms — the sidebar's room groups. */
  | { level: 'roomGroup'; groupId: string };

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
  /**
   * The instant the window ends. Session-wide for the same reason rangeMs is:
   * every view used to call Date.now() for itself, so the room and the house
   * asked about windows a few seconds apart and no two questions ever matched.
   * Quantised by default (see analyticsWindowEnd) so the answers can be
   * cached; Refresh replaces it with an exact instant.
   */
  windowEnd: number;
}

/**
 * Minted, not frozen: windowEnd has to be read at the moment the surface opens.
 */
export function defaultSettings(): AnalyticsSettings {
  return {
    rangeMs: 24 * 3_600_000,
    windowEnd: analyticsWindowEnd(),
  };
}

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

export interface ScopeRoomGroupNode {
  id: string;
  name: string;
  /** The group's rooms, in the navigation's order. */
  rooms: ScopeRoom[];
  /** Everything recording across them — what the count means. */
  total: number;
}

export interface ScopeTreeModel {
  /** Room groups, each holding its own rooms. */
  roomGroups: ScopeRoomGroupNode[];
  /** Rooms that no group claims. */
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
  /** The sidebar's room groups, already resolved to room NAMES by the host. */
  roomGroups: Array<{ id: string; name: string; roomNames: string[] }> = [],
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
    const room = rooms.size === 1 ? [...rooms][0] : undefined;
    return [{
      // A group is named by the same rule as an accessory: "Living Lights"
      // sitting under Living is just "Lights". Groups are named after their
      // room even more reliably than accessories are, so leaving them raw
      // made the row that collapses nine bulbs the one row saying the room
      // twice. A group spanning rooms belongs to none and keeps its name.
      node: {
        id: group.id,
        name: getDisplayName(group.name, room ?? undefined),
        memberCount: members.length,
        members,
      },
      room,
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
  // Room groups take their rooms OUT of the top level: a room reachable
  // through its group and also loose beside it is the same duplication the
  // tree already refuses for a service group's members. A group needs two
  // recorded rooms to be worth a layer — one is that room with a lid on it.
  const claimedRooms = new Set<string>();
  const groupedRooms: ScopeRoomGroupNode[] = [];
  for (const group of roomGroups) {
    const wanted = new Set(group.roomNames.map(n => n.trim().toLowerCase()));
    const mine = rooms.filter(r => r.room && wanted.has(r.room.trim().toLowerCase()));
    if (mine.length < 2) continue;
    mine.forEach(r => claimedRooms.add(r.label));
    groupedRooms.push({
      id: group.id,
      name: group.name,
      rooms: mine,
      total: mine.reduce((n, r) => n + r.total, 0),
    });
  }

  return {
    roomGroups: groupedRooms,
    rooms: rooms.filter(r => !claimedRooms.has(r.label)),
    groups: crossRoom,
    accessoryCount: placed,
  };
}

/** Where you are, in words — the header's breadcrumb. */
export function scopeCrumbs(
  scope: AnalyticsScope,
  homeName: string,
  accessoryInfo: Map<string, AccessoryInfoEntry>,
  groups: Array<{ id: string; name: string }>,
  roomGroups: Array<{ id: string; name: string; roomNames: string[] }> = [],
): Array<{ label: string; scope: AnalyticsScope }> {
  const home = { label: homeName, scope: { level: 'home' } as AnalyticsScope };
  switch (scope.level) {
    case 'home':
      return [home];
    case 'room': {
      const crumbs = [home];
      const owner = scope.room
        ? roomGroups.find(g => g.roomNames.some(n => n.trim().toLowerCase() === scope.room!.trim().toLowerCase()))
        : undefined;
      if (owner) {
        crumbs.push({ label: owner.name, scope: { level: 'roomGroup', groupId: owner.id } });
      }
      crumbs.push({ label: scope.room ?? 'Elsewhere', scope });
      return crumbs;
    }
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
    case 'roomGroup': {
      const group = roomGroups.find(g => g.id === scope.groupId);
      return [home, { label: group?.name ?? 'Rooms', scope }];
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

/** Same place, not same object — every row builds a fresh scope literal. */
function sameScope(a: AnalyticsScope | undefined, b: AnalyticsScope): boolean {
  if (!a || a.level !== b.level) return false;
  switch (a.level) {
    case 'home': return true;
    case 'room': return a.room === (b as { room: string | null }).room;
    case 'accessory': return a.accessoryId === (b as { accessoryId: string }).accessoryId;
    case 'group':
    case 'roomGroup': return a.groupId === (b as { groupId: string }).groupId;
  }
}

export function useAnalyticsScope(initial?: AnalyticsScope): AnalyticsScopeState {
  const [history, setHistory] = useState<AnalyticsScope[]>([initial ?? { level: 'home' }]);
  const [settings, setSettingsState] = useState<AnalyticsSettings>(defaultSettings);

  const setScope = useCallback((next: AnalyticsScope) => {
    // Re-picking where you already are is not a step. It used to push anyway,
    // which only showed up as a back button that needed pressing twice; now
    // that a container row can be tapped repeatedly without closing the tree,
    // it would stack a whole run of them.
    setHistory(h => (sameScope(h[h.length - 1], next) ? h : [...h, next]));
  }, []);
  const back = useCallback(() => {
    setHistory(h => (h.length > 1 ? h.slice(0, -1) : h));
  }, []);
  const setSettings = useCallback((next: Partial<AnalyticsSettings>) => {
    setSettingsState(s => ({
      ...s,
      // A new range means a new question, so it should be asked about now
      // rather than about whenever the surface happened to open. Refresh
      // passes windowEnd explicitly and keeps it.
      ...(next.rangeMs !== undefined && next.windowEnd === undefined
        ? { windowEnd: analyticsWindowEnd() }
        : null),
      ...next,
    }));
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
