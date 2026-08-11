import { useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import type { WritableChar } from '@/components/automations/characteristics';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { LiveAccessory } from '@/history/summaries';
import AccessoryScopeView from './AccessoryScopeView';
import CustomView from './CustomView';
import GroupHistorySections from './GroupHistorySections';
import HomeOverview from './HomeOverview';
import RoomStackView from './RoomStackView';
import type { AnalyticsScope, AnalyticsSettings, ScopeTreeModel } from './scope';
import type { ExplorerView } from './types';
import type { HistorySeriesInfo, HomeKitAccessory } from '@/lib/graphql/types';

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
  tree,
  live,
  recorded,
  accessoryInfo,
  charByAccessory,
  groups,
  accessories,
  onSelect,
  onReplace,
}: {
  scope: AnalyticsScope;
  settings: AnalyticsSettings;
  homeId: string | null;
  mock: boolean;
  tree: ScopeTreeModel;
  live: LiveAccessory[];
  recorded: HistorySeriesInfo[];
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  /** Per-accessory characteristic lookup, for enum labels and ordering. */
  charByAccessory: Map<string, Map<string, WritableChar>>;
  groups: Array<{ id: string; name: string; memberIds: string[] }>;
  accessories: HomeKitAccessory[] | null;
  onSelect: (scope: AnalyticsScope) => void;
  onReplace: (scope: AnalyticsScope) => void;
}) {
  const enabled = useMemo(() => recorded.filter(s => s.enabled !== false), [recorded]);

  if (scope.level === 'home') {
    // The same view a room gets, aggregated: one line per room per measure,
    // the home's lights as one line, its groups as one strip each. Then the
    // highlights and the room list, which are the ways further in.
    return (
      <div className="space-y-5">
        {enabled.length > 0 && (
          <RoomStackView
            homeId={homeId}
            mock={mock}
            roomSeries={enabled}
            room={null}
            byRoom
            accessoryInfo={accessoryInfo}
            groups={groups}
            settings={settings}
            onCustomize={(view: ExplorerView) => onSelect({ level: 'custom', view })}
          />
        )}
        <HomeOverview
          homeId={homeId}
          mock={mock}
          tree={tree}
          live={live}
          recorded={recorded}
          accessoryInfo={accessoryInfo}
          onSelect={onSelect}
        />
      </div>
    );
  }

  if (scope.level === 'custom') {
    return (
      <CustomView
        homeId={homeId}
        mock={mock}
        view={scope.view}
        onViewChange={(view) => onReplace({ level: 'custom', view })}
        accessories={accessories}
        recorded={recorded}
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
  // measure — then the accessories in it, so the tree is not the only way down.
  const roomSeries = enabled.filter(s =>
    (accessoryInfo.get(s.accessoryId.toUpperCase())?.room ?? null) === scope.room);
  const roomNode = tree.rooms.find(r => r.room === scope.room);

  return (
    <div className="space-y-5">
      {roomSeries.length === 0 ? (
        <Empty>Nothing recorded in this room yet.</Empty>
      ) : (
        <RoomStackView
          homeId={homeId}
          mock={mock}
          roomSeries={roomSeries}
          room={scope.room}
          accessoryInfo={accessoryInfo}
          groups={groups}
          settings={settings}
          onCustomize={(view: ExplorerView) => onSelect({ level: 'custom', view })}
        />
      )}

      {roomNode && (roomNode.accessories.length > 0 || roomNode.groups.length > 0) && (
        // Folded away: the tree on the left is the primary way down, and a
        // list repeating it under every room pushed the charts up the page.
        <details className="group rounded-lg border">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className="mr-1 inline h-3 w-3 transition-transform group-open:rotate-90" />
            {roomNode.total} accessor{roomNode.total === 1 ? 'y' : 'ies'} recording here
          </summary>
          <div className="divide-y border-t">
            {[
              ...roomNode.groups.map(g => ({
                key: g.id, name: g.name, note: `${g.memberCount} accessories`,
                scope: { level: 'group' as const, groupId: g.id },
              })),
              ...roomNode.accessories.map(a => ({
                key: a.id, name: a.name, note: `${a.seriesCount} recording`,
                scope: { level: 'accessory' as const, accessoryId: a.id },
              })),
            ].map(row => (
              <button
                key={row.key}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                onClick={() => onSelect(row.scope)}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">{row.note}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-16 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
