import { useMemo, useState } from 'react';
import { aggregateNumericSeries, stateToNumericSeries } from '@/history/aggregate';
import { HISTORY_CHAR_ORDER } from '@/components/automations/characteristics';
import { charLabel } from '@/components/automations/format';
import { canonicalHistoryType } from '@/history/keys';
import { stateValueLabel } from '@/history/labels';
import { onMs, eventCount } from '@/history/insights';
import HistoryChart from '@/components/widgets/HistoryChart';
import StateTimeline from '@/components/widgets/StateTimeline';
import type { AccessoryInfoEntry, OrganizedCategory } from '@/history/categories';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { HistoryPointData, HistorySeriesData, HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

const RANGES = [
  { label: '6h', ms: 6 * 3_600_000 },
  { label: '24h', ms: 24 * 3_600_000 },
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '1y', ms: 365 * 86_400_000 },
] as const;

const MAX_REFS = 36;

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * A group reads like ONE accessory with aggregated data — the same
 * per-characteristic layout as the compact accessory view (the one the
 * user called perfect), but each section combines the members:
 * temperatures become an average with a min–max band across members,
 * on/off states become a "how many are on" count over time. The group's
 * own recorded series (commands sent to the group as a whole) shows as its
 * timeline when it exists.
 */
export default function GroupView({
  homeId,
  mock,
  category,
  groupId,
  accessoryInfo,
  recorded,
  onGroupChange,
}: {
  homeId: string | null;
  mock: boolean;
  category: OrganizedCategory;
  groupId?: string | null;
  accessoryInfo: Map<string, AccessoryInfoEntry>;
  /** The home's full recorded-series listing (member lookup). */
  recorded: HistorySeriesInfo[];
  onGroupChange: (groupId: string) => void;
}) {
  const [rangeMs, setRangeMs] = useState<number>(24 * 3_600_000);
  const groups = category.groups ?? [];
  const activeGroup = groups.find(g => g.id.toUpperCase() === groupId?.toUpperCase()) ?? groups[0] ?? null;

  const seriesKey = activeGroup?.id ?? '';
  const toTs = useMemo(() => Date.now(), [seriesKey, rangeMs]); // eslint-disable-line react-hooks/exhaustive-deps
  const fromTs = toTs - rangeMs;

  // Member series grouped by characteristic, importance-ordered — the same
  // section order the accessory view uses.
  const sections = useMemo(() => {
    if (!activeGroup) return [];
    const memberIds = new Set(activeGroup.memberIds.map(id => id.toUpperCase()));
    const byType = new Map<string, HistorySeriesInfo[]>();
    for (const s of recorded) {
      if (!s.enabled || !memberIds.has(s.accessoryId.toUpperCase())) continue;
      const canonical = canonicalHistoryType(s.characteristicType);
      const list = byType.get(canonical) ?? [];
      list.push(s);
      byType.set(canonical, list);
    }
    const rank = new Map(HISTORY_CHAR_ORDER.map((t, i) => [t, i]));
    return [...byType.entries()]
      .sort((a, b) => (rank.get(a[0]) ?? HISTORY_CHAR_ORDER.length) - (rank.get(b[0]) ?? HISTORY_CHAR_ORDER.length))
      .map(([type, list]) => ({ type, list, kind: list[0].kind, unit: list[0].unit }));
  }, [activeGroup, recorded]);

  const refs = useMemo<HistorySeriesRefInput[]>(() => {
    const out: HistorySeriesRefInput[] = [];
    for (const section of sections) {
      for (const s of section.list) {
        if (out.length >= MAX_REFS) break;
        out.push({ accessoryId: s.accessoryId, characteristicType: s.characteristicType });
      }
    }
    for (const own of activeGroup?.series ?? []) {
      out.push({ accessoryId: own.accessoryId, characteristicType: own.characteristicType });
    }
    return out;
  }, [sections, activeGroup]);

  const { data, loading } = useMultiSeriesHistory(homeId, refs, fromTs, toTs, 0, mock, {
    enabled: refs.length > 0,
  });

  const entryOf = (s: HistorySeriesInfo): HistorySeriesData | undefined =>
    data.get(`${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`)?.main;

  const memberCount = activeGroup?.memberIds.length ?? 0;

  return (
    <div className="space-y-4">
      {groups.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {groups.map(g => (
            <button
              key={g.id}
              onClick={() => onGroupChange(g.id)}
              className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                g.id === activeGroup?.id
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {g.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRangeMs(r.ms)}
              className={`text-[11px] px-2.5 py-1 rounded-md transition-colors ${
                rangeMs === r.ms
                  ? 'bg-background text-foreground shadow-sm font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
        {activeGroup && (
          <p className="text-[11px] text-muted-foreground">
            aggregated across {memberCount} member{memberCount === 1 ? '' : 's'}
          </p>
        )}
      </div>

      {sections.length === 0 && (activeGroup?.series.length ?? 0) === 0 ? (
        <div className="py-12 text-center">
          <p className="text-sm text-muted-foreground">
            Nothing recorded for {activeGroup?.name ?? 'this group'}'s members
            yet — charts build as they report changes.
          </p>
        </div>
      ) : loading && data.size === 0 ? (
        <div className="py-12 flex justify-center text-muted-foreground">
          <span className="text-xs">Loading…</span>
        </div>
      ) : (
        <div className="space-y-5">
          {sections.map(section => {
            const entries = section.list
              .map(s => entryOf(s))
              .filter((d): d is HistorySeriesData => !!d);
            if (entries.length === 0) return null;
            const label = charLabel(section.type);

            if (section.kind === 'numeric') {
              // Average across members with the min–max envelope — the same
              // chart the accessory view draws, fed by the whole group.
              const points: HistoryPointData[] = aggregateNumericSeries(entries, fromTs, toTs)
                .map(p => ({ ts: p.ts, min: p.min, avg: p.avg, max: p.max, last: p.avg, count: p.count }));
              if (points.length === 0) return null;
              let min = Infinity;
              let max = -Infinity;
              let sum = 0;
              for (const p of points) {
                min = Math.min(min, p.min);
                max = Math.max(max, p.max);
                sum += p.avg;
              }
              const unit = section.unit ?? '';
              return (
                <div key={section.type} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium">{label}</span>
                    <span className="text-[10px] text-muted-foreground">
                      average of {entries.length} member{entries.length === 1 ? '' : 's'} · shaded = spread
                    </span>
                  </div>
                  <HistoryChart points={points} unit={section.unit} gradientId={`group-${activeGroup?.id}-${section.type}`} />
                  <p className="text-[11px] text-muted-foreground">
                    min {min.toFixed(1)}{unit} · avg {(sum / points.length).toFixed(1)}{unit} · max {max.toFixed(1)}{unit}
                  </p>
                </div>
              );
            }

            // State kinds: "how many are on" over time — the honest group
            // aggregate of on/off members — plus totals.
            const numericized = entries.map(stateToNumericSeries);
            const agg = aggregateNumericSeries(numericized, fromTs, toTs);
            const points: HistoryPointData[] = agg.map(p => {
              const on = p.avg * p.count;
              return { ts: p.ts, min: on, avg: on, max: on, last: on, count: p.count };
            });
            if (points.length === 0) return null;
            const totalOnMs = entries.reduce((a, d) => a + onMs(d, fromTs, toTs), 0);
            const changes = entries.reduce((a, d) => a + eventCount(d), 0);
            return (
              <div key={section.type} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium">{label}</span>
                  <span className="text-[10px] text-muted-foreground">
                    how many of {entries.length} are on
                  </span>
                </div>
                <HistoryChart points={points} unit={null} gradientId={`group-${activeGroup?.id}-${section.type}`} />
                <p className="text-[11px] text-muted-foreground">
                  combined on-time {formatDuration(totalOnMs)} · {changes} change{changes === 1 ? '' : 's'}
                </p>
              </div>
            );
          })}

          {(activeGroup?.series ?? []).map(own => {
            const ownData = entryOf(own);
            if (!ownData) return null;
            return (
              <div key={`own-${own.characteristicType}`} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs font-medium">Group {charLabel(own.characteristicType).toLowerCase()}</span>
                  <span className="text-[10px] text-muted-foreground">commands sent to the group as a whole</span>
                </div>
                <StateTimeline
                  fromTs={fromTs}
                  toTs={toTs}
                  prevValue={ownData.prevValue}
                  prevValueText={ownData.prevValueText}
                  states={ownData.states}
                  stateBuckets={ownData.stateBuckets}
                  labelFor={(v, text) => text ?? stateValueLabel(canonicalHistoryType(own.characteristicType), v)}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
