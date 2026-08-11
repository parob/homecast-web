import { useMemo, useState } from 'react';
import { AlertTriangle, BatteryLow, ChevronRight, Layers } from 'lucide-react';
import { computeInsights, selectInsightRefs, type Insight } from '@/history/insights';
import type { AccessoryInfoEntry } from '@/history/categories';
import type { LiveAccessory } from '@/history/summaries';
import HighlightsStrip from './HighlightsStrip';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { AnalyticsScope, ScopeTreeModel } from './scope';
import type { HistorySeriesData, HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

const DAY_MS = 86_400_000;

/**
 * The home, in one screen: what changed, then the rooms.
 *
 * It deliberately does NOT chart anything. A real home has ninety climate
 * series and three hundred energy series, and the old landing page tried to
 * summarise all of them into eight category tiles whose headlines came from
 * whichever series happened to be first. A home-level view can honestly say
 * two things — here is what stands out, and here is what the house is made of
 * — and every number below is live state, which is complete and free.
 */
function roomStat(live: LiveAccessory[], room: string | null) {
  const inRoom = live.filter(a => (a.room ?? null) === room);
  const temps = inRoom
    .map(a => a.values['current_temperature'])
    .filter((v): v is number => typeof v === 'number');
  const batteries = inRoom
    .map(a => a.values['battery_level'])
    .filter((v): v is number => typeof v === 'number');
  const triggered = inRoom.some(a =>
    ['smoke_detected', 'carbon_monoxide_detected', 'leak_detected'].some(t => {
      const v = a.values[t];
      return v === 1 || v === '1';
    }));
  return {
    temperature: temps.length > 0 ? temps.reduce((a, b) => a + b, 0) / temps.length : null,
    lowBattery: batteries.length > 0 ? Math.min(...batteries) : null,
    triggered,
  };
}

export default function HomeOverview({
  homeId,
  mock,
  tree,
  live,
  recorded,
  accessoryInfo,
  onSelect,
}: {
  homeId: string | null;
  mock: boolean;
  tree: ScopeTreeModel;
  live: LiveAccessory[];
  recorded: HistorySeriesInfo[];
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  onSelect: (scope: AnalyticsScope) => void;
}) {
  // One frozen "now": the two windows must not drift between renders.
  const [now] = useState(() => Date.now());
  const dayStart = useMemo(() => new Date(now).setHours(0, 0, 0, 0), [now]);

  const info = accessoryInfo as Map<string, { name: string; room: string | null }>;
  const refs = useMemo(() => selectInsightRefs(recorded, info), [recorded, info]);
  const allRefs = useMemo<HistorySeriesRefInput[]>(() => (
    [...refs.temperature, ...refs.humidity, ...refs.activity, ...refs.power, ...(refs.watts ?? [])]
      .map(s => ({ accessoryId: s.accessoryId, characteristicType: s.characteristicType }))
  ), [refs]);

  const today = useMultiSeriesHistory(homeId, allRefs, dayStart, now, 0, mock);
  const yesterday = useMultiSeriesHistory(homeId, allRefs, dayStart - DAY_MS, now - DAY_MS, 0, mock);

  const mapOf = (data: Map<string, { main: HistorySeriesData }>) => {
    const out = new Map<string, HistorySeriesData>();
    for (const [key, entry] of data) out.set(key, entry.main);
    return out;
  };
  const todayMap = useMemo(() => mapOf(today.data), [today.data]);
  const yesterdayMap = useMemo(() => mapOf(yesterday.data), [yesterday.data]);

  const insights = useMemo<Insight[]>(() => computeInsights({
    live,
    refs,
    today: todayMap,
    yesterday: yesterdayMap,
    window: { fromTs: dayStart, toTs: now },
    info,
  }), [live, refs, todayMap, yesterdayMap, dayStart, now, info]);

  return (
    <div className="space-y-5">
      {insights.length > 0 && (
        <HighlightsStrip
          insights={insights}
          loading={today.loading}
          onOpen={(insight) => {
            // Every highlight is about a place; land on that place rather than
            // on a category filtered to it.
            const room = insight.link?.room;
            if (room !== undefined) onSelect({ level: 'room', room });
          }}
        />
      )}

      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h3 className="text-sm font-medium">Rooms</h3>
          <span className="text-[11px] text-muted-foreground">
            {tree.accessoryCount} accessor{tree.accessoryCount === 1 ? 'y' : 'ies'} recording
          </span>
        </div>
        <div className="divide-y rounded-lg border">
          {tree.rooms.map(room => {
            const stat = roomStat(live, room.room);
            return (
              <button
                key={room.label}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                onClick={() => onSelect({ level: 'room', room: room.room })}
              >
                <span className="min-w-0 flex-1 truncate text-sm">{room.label}</span>
                {stat.triggered && (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> alert
                  </span>
                )}
                {stat.lowBattery !== null && stat.lowBattery < 20 && (
                  <span className="flex shrink-0 items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400">
                    <BatteryLow className="h-3 w-3" /> {Math.round(stat.lowBattery)}%
                  </span>
                )}
                {stat.temperature !== null && (
                  <span className="shrink-0 tabular-nums text-sm">{stat.temperature.toFixed(1)}°</span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {room.accessories.length}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            );
          })}
        </div>
      </div>

      {tree.groups.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium">Groups</h3>
          <div className="divide-y rounded-lg border">
            {tree.groups.map(group => (
              <button
                key={group.id}
                className="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/60"
                onClick={() => onSelect({ level: 'group', groupId: group.id })}
              >
                <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-sm">{group.name}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {group.memberCount} recording
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
