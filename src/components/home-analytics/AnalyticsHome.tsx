import { useMemo, useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { aggregateNumericSeries } from '@/history/aggregate';
import { CATEGORIES, type CategoryId, type OrganizedCategory } from '@/history/categories';
import {
  computeInsights,
  eventCount,
  selectInsightRefs,
  type Insight,
} from '@/history/insights';
import {
  batterySummary,
  climateSummary,
  energySummary,
  safetySummary,
  type LiveAccessory,
} from '@/history/summaries';
import type { AccessoryInfoEntry } from '@/history/categories';
import CategoryCard from './CategoryCard';
import HighlightsStrip from './HighlightsStrip';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { HistorySeriesData, HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

const DAY_MS = 86_400_000;

/**
 * The Analytics landing: answers first. A Highlights strip of computed
 * facts (each linking to the chart that explains it), compact category
 * cards with semantically-chosen headlines from LIVE accessory state, and
 * one quiet footer line for everything that is merely monitoring. The old
 * grid of eight tiles with arbitrary first-series headlines and
 * "1293 monitoring" counts is what this replaces.
 */
export default function AnalyticsHome({
  homeId,
  mock,
  organized,
  live,
  recorded,
  accessoryInfo,
  onOpenCategory,
}: {
  homeId: string | null;
  mock: boolean;
  organized: OrganizedCategory[];
  live: LiveAccessory[];
  recorded: HistorySeriesInfo[];
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  onOpenCategory: (category: CategoryId, room?: string | null) => void;
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

  const todayMap = useMemo(() => {
    const map = new Map<string, HistorySeriesData>();
    for (const [key, entry] of today.data) map.set(key, entry.main);
    return map;
  }, [today.data]);
  const yesterdayMap = useMemo(() => {
    const map = new Map<string, HistorySeriesData>();
    for (const [key, entry] of yesterday.data) map.set(key, entry.main);
    return map;
  }, [yesterday.data]);

  const insights = useMemo<Insight[]>(() => computeInsights({
    live,
    refs,
    today: todayMap,
    yesterday: yesterdayMap,
    window: { fromTs: dayStart, toTs: now },
    info,
  }), [live, refs, todayMap, yesterdayMap, dayStart, now, info]);

  // --- Card content: live-state headlines, history trends -----------------

  const climate = useMemo(() => climateSummary(live), [live]);
  const battery = useMemo(() => batterySummary(live), [live]);
  const energy = useMemo(() => energySummary(live), [live]);
  const safety = useMemo(() => safetySummary(live), [live]);

  const climateSpark = useMemo(() => {
    const temps = refs.temperature
      .map(r => todayMap.get(`${r.accessoryId.toUpperCase()}|${r.characteristicType}`))
      .filter((d): d is HistorySeriesData => !!d && d.points.length > 0);
    if (temps.length === 0) return undefined;
    const points = aggregateNumericSeries(temps, dayStart, now);
    return points.length > 1 ? points.map(p => p.avg) : undefined;
  }, [refs.temperature, todayMap, dayStart, now]);

  const wattsSpark = useMemo(() => {
    const watts = (refs.watts ?? [])
      .map(r => todayMap.get(`${r.accessoryId.toUpperCase()}|${r.characteristicType}`))
      .filter((d): d is HistorySeriesData => !!d && d.points.length > 0);
    if (watts.length === 0) return undefined;
    const points = aggregateNumericSeries(watts, dayStart, now);
    // The card's number is a SUM across meters; scale the average up so the
    // sparkline moves on the same axis of meaning.
    return points.length > 1 ? points.map(p => p.avg * watts.length) : undefined;
  }, [refs.watts, todayMap, dayStart, now]);

  const activityToday = useMemo(() => {
    let total = 0;
    const perRoom = new Map<string, number>();
    for (const ref of refs.activity) {
      const data = todayMap.get(`${ref.accessoryId.toUpperCase()}|${ref.characteristicType}`);
      if (!data) continue;
      const events = eventCount(data);
      total += events;
      const room = info.get(ref.accessoryId.toUpperCase())?.room ?? 'Elsewhere';
      perRoom.set(room, (perRoom.get(room) ?? 0) + events);
    }
    const busiest = [...perRoom.entries()].sort((a, b) => b[1] - a[1])[0];
    return { total, busiest: busiest && busiest[1] > 0 ? { room: busiest[0], events: busiest[1] } : null };
  }, [refs.activity, todayMap, info]);

  const has = useMemo(() => new Map(organized.map(c => [c.id, c])), [organized]);

  interface Card {
    category: CategoryId;
    title: string;
    headline: string;
    headlineSuffix?: string;
    sub?: string;
    spark?: number[];
  }
  const cards: Card[] = [];

  if (climate.sensorCount > 0 && has.has('climate')) {
    cards.push({
      category: 'climate',
      title: 'Climate',
      headline: `${climate.avgTemp!.toFixed(1)}°`,
      headlineSuffix: 'home average',
      sub: climate.rooms.length >= 2
        ? `warmest: ${climate.warmest!.room} (${climate.warmest!.temp.toFixed(1)}°) · coolest: ${climate.coldest!.room} (${climate.coldest!.temp.toFixed(1)}°)`
        : `${climate.sensorCount} sensor${climate.sensorCount === 1 ? '' : 's'}`,
      spark: climateSpark,
    });
  }
  if (has.has('activity') && refs.activity.length > 0) {
    cards.push({
      category: 'activity',
      title: 'Activity',
      headline: String(activityToday.total),
      headlineSuffix: 'events today',
      sub: activityToday.busiest
        ? `busiest: ${activityToday.busiest.room} (${activityToday.busiest.events})`
        : 'quiet so far today',
    });
  }
  if (has.has('energy') && (energy.watts !== null || energy.switchedCount > 0)) {
    cards.push({
      category: 'energy',
      title: 'Energy & Usage',
      headline: energy.watts !== null ? `${Math.round(energy.watts)}W` : String(energy.onCount),
      headlineSuffix: energy.watts !== null ? 'right now' : 'on now',
      sub: `${energy.onCount} of ${energy.switchedCount} switched accessories on`,
      spark: wattsSpark,
    });
  }
  if (battery.count > 0 && has.has('battery')) {
    cards.push({
      category: 'battery',
      title: 'Battery',
      headline: `${Math.round(battery.lowest!.level)}%`,
      headlineSuffix: `lowest — ${battery.lowest!.name}`,
      sub: battery.lowCount > 0
        ? `${battery.lowCount} below 20%`
        : `${battery.count} batteries · all healthy`,
    });
  }

  // Everything else is one quiet line, not a wall of empty tiles.
  const footer: Array<{ category: CategoryId; label: string }> = [];
  const carded = new Set(cards.map(c => c.category));
  if (safety.sensorCount > 0 || has.has('safety')) {
    footer.push({
      category: 'safety',
      label: safety.triggered.length === 0
        ? `Safety: all clear (${safety.sensorCount} sensors)`
        : `Safety: ${safety.triggered.length} alert${safety.triggered.length === 1 ? '' : 's'}`,
    });
  }
  for (const id of ['groups', 'virtual', 'other'] as CategoryId[]) {
    const cat = has.get(id);
    if (!cat || carded.has(id)) continue;
    const label = id === 'groups'
      ? `Groups (${cat.groups?.length ?? 0})`
      : `${CATEGORIES[id].title}${cat.series.length > 0 ? '' : ' — monitoring'}`;
    footer.push({ category: id, label });
  }

  return (
    <div className="space-y-5">
      <HighlightsStrip
        insights={insights}
        loading={today.loading || yesterday.loading}
        onOpen={(insight) => {
          if (insight.link) onOpenCategory(insight.link.category, insight.link.room);
        }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
        {cards.map(card => (
          <CategoryCard
            key={card.category}
            category={card.category}
            title={card.title}
            headline={card.headline}
            headlineSuffix={card.headlineSuffix}
            sub={card.sub}
            spark={card.spark}
            onOpen={() => onOpenCategory(card.category)}
          />
        ))}
      </div>

      {footer.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground border-t pt-3">
          {footer.map(item => (
            <button
              key={item.category}
              className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
              onClick={() => onOpenCategory(item.category)}
            >
              {item.category === 'safety' && safety.triggered.length === 0 && (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
              )}
              {item.label}
            </button>
          ))}
        </div>
      )}

      <p className="text-[10px] text-muted-foreground">
        Computed from what your home records — opt-in, per accessory
        (Settings → History). Headlines are live values; trends are today's
        recordings.
      </p>
    </div>
  );
}
