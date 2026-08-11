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
}) {
  const enabled = useMemo(() => recorded.filter(s => s.enabled !== false), [recorded]);

  if (scope.level === 'home') {
    // Exactly the view a room gets, aggregated: one line per room per
    // measure, the home's lights as one line, its groups as one strip each.
    // The tree on the left is how you go further in.
    if (enabled.length === 0) return <Empty>Nothing recorded in this home yet.</Empty>;
    return (
      <RoomStackView
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

  if (scope.level === 'group') {
    const group = groups.find(g => g.id === scope.groupId);
    if (!group) return <Empty>That group is no longer here.</Empty>;
    const toTs = Date.now();
    return (
      <GroupHistorySections
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
