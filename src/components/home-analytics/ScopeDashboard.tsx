import { useMemo } from 'react';
import type { WritableChar } from '@/components/automations/characteristics';
import type { AccessoryInfoEntry } from '@/history/categories';
import AccessoryScopeView from './AccessoryScopeView';
import GroupHistorySections from './GroupHistorySections';
import RoomStackView from './RoomStackView';
import type { AnalyticsScope, AnalyticsSettings } from './scope';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

/**
 * The detail pane: whatever the current scope is, rendered at the depth that
 * scope can honestly support.
 *
 * The rule this enforces is the anti-overload one. A home does not chart
 * ninety series — it lists its rooms. A room charts its own two or three
 * accessories per measure. An accessory charts its own characteristics. Each
 * step down narrows the data instead of filtering a firehose, and each step
 * ends with the scopes inside it so there is always a way further in.
 */
export default function ScopeDashboard({
  scope,
  settings,
  homeId,
  mock,
  recorded,
  accessoryInfo,
  charByAccessory,
  groups,
  roomGroups = [],
}: {
  scope: AnalyticsScope;
  settings: AnalyticsSettings;
  homeId: string | null;
  mock: boolean;
  recorded: HistorySeriesInfo[];
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  /** Per-accessory characteristic lookup, for enum labels and ordering. */
  charByAccessory: Map<string, Map<string, WritableChar>>;
  groups: Array<{ id: string; name: string; memberIds: string[] }>;
  /** The sidebar's room groups, resolved to room names by the host. */
  roomGroups?: Array<{ id: string; name: string; roomNames: string[] }>;
}) {
  const enabled = useMemo(() => recorded.filter(s => s.enabled !== false), [recorded]);

  // Each scope gets its own first load. Without this the view is one long-lived
  // component: switching home or room kept the PREVIOUS scope's fetched data,
  // so "have we loaded yet" answered yes, the skeleton never appeared, and a
  // scope whose fetch had not landed rendered "Nothing recorded here yet" over
  // the top of a request still in flight.
  const scopeKey = `${homeId ?? ''}|${scope.level}|${
    scope.level === 'room' ? scope.room ?? ''
      : scope.level === 'accessory' ? scope.accessoryId
        : scope.level === 'group' || scope.level === 'roomGroup' ? scope.groupId : ''}`;

  if (scope.level === 'home') {
    // Exactly the view a room gets, aggregated: one line per room per
    // measure, the home's lights as one line, its groups as one strip each.
    // The tree on the left is how you go further in.
    if (enabled.length === 0) return <Empty>Nothing recorded in this home yet.</Empty>;
    return (
      <RoomStackView
        key={scopeKey}
        homeId={homeId}
        mock={mock}
        roomSeries={enabled}
        room={null}
        byRoom
        accessoryInfo={accessoryInfo}
        groups={groups}
        settings={settings}
      />
    );
  }

  if (scope.level === 'roomGroup') {
    // A room group is the home view, narrowed: one averaged line per room in
    // it, the same aggregation the whole-home scope already does.
    const group = roomGroups.find(g => g.id === scope.groupId);
    if (!group) return <Empty>That room group is no longer here.</Empty>;
    const wanted = new Set(group.roomNames.map(n => n.trim().toLowerCase()));
    const groupSeries = enabled.filter(s => {
      const room = accessoryInfo.get(s.accessoryId.toUpperCase())?.room;
      return !!room && wanted.has(room.trim().toLowerCase());
    });
    if (groupSeries.length === 0) return <Empty>Nothing recorded in these rooms yet.</Empty>;
    return (
      <RoomStackView
        key={scopeKey}
        homeId={homeId}
        mock={mock}
        roomSeries={groupSeries}
        room={null}
        byRoom
        accessoryInfo={accessoryInfo}
        groups={groups}
        settings={settings}
      />
    );
  }

  if (scope.level === 'group') {
    const group = groups.find(g => g.id === scope.groupId);
    if (!group) return <Empty>That group is no longer here.</Empty>;
    // Not Date.now(): this is the render body, so every re-render used to mint
    // a new window, change useMultiSeriesHistory's effect deps and refetch the
    // whole group.
    const toTs = settings.windowEnd;
    return (
      <GroupHistorySections
        key={scopeKey}
        homeId={homeId}
        mock={mock}
        group={group}
        recorded={recorded}
        fromTs={toTs - settings.rangeMs}
        toTs={toTs}
      />
    );
  }

  if (scope.level === 'accessory') {
    const id = scope.accessoryId.toUpperCase();
    const info = accessoryInfo.get(id);
    const types = enabled
      .filter(s => s.accessoryId.toUpperCase() === id)
      .map(s => s.characteristicType);
    if (types.length === 0) return <Empty>Nothing recorded for this accessory yet.</Empty>;
    return (
      <AccessoryScopeView
        key={scopeKey}
        homeId={homeId}
        mock={mock}
        accessoryId={scope.accessoryId}
        name={info?.name ?? 'Accessory'}
        types={types}
        charByType={charByAccessory.get(id) ?? new Map()}
        settings={settings}
      />
    );
  }

  // Room scope: this room's series across every category, one panel per
  // measure. The tree on the left is how you go further in.
  const roomSeries = enabled.filter(s =>
    (accessoryInfo.get(s.accessoryId.toUpperCase())?.room ?? null) === scope.room);

  if (roomSeries.length === 0) return <Empty>Nothing recorded in this room yet.</Empty>;
  return (
    <RoomStackView
      key={scopeKey}
      homeId={homeId}
      mock={mock}
      roomSeries={roomSeries}
      room={scope.room}
      accessoryInfo={accessoryInfo}
      groups={groups}
      settings={settings}
    />
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
