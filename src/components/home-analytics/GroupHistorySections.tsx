import { useMemo } from 'react';
import { aggregateNumericSeries, stateToNumericSeries } from '@/history/aggregate';
import { sanitizeSeriesData } from '@/history/sanitize';
import { HISTORY_CHAR_ORDER } from '@/components/automations/characteristics';
import { charLabel } from '@/components/automations/format';
import { canonicalHistoryType } from '@/history/keys';
import { stateValueLabel } from '@/history/labels';
import { onMs, eventCount } from '@/history/insights';
import ChartSkeleton from './ChartSkeleton';
import { SETPOINT_STATE_TYPES } from '@/history/categories';
import HistoryChart from '@/components/widgets/HistoryChart';
import StateTimeline from '@/components/widgets/StateTimeline';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import type { HistoryPointData, HistorySeriesData, HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

const MAX_REFS = 36;

export interface GroupRef {
  id: string;
  name: string;
  memberIds: string[];
}

function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * The aggregated per-characteristic sections for a service group — the SAME
 * layout as the compact accessory view, fed by every member: temperatures
 * become an average with a min–max spread, on/off states become a "how many
 * are on" count over time, and commands sent to the group as a whole show
 * as their own timeline. Shared by the compact group popup and the
 * full-screen Groups view so both places tell the same story.
 */
export default function GroupHistorySections({
  homeId,
  mock,
  group,
  recorded,
  fromTs,
  toTs,
}: {
  homeId: string | null;
  mock: boolean;
  group: GroupRef;
  /** The home's recorded-series listing (member + group-id lookup). */
  recorded: HistorySeriesInfo[];
  fromTs: number;
  toTs: number;
}) {
  // Member series grouped by characteristic, importance-ordered — the same
  // section order the accessory view uses.
  const sections = useMemo(() => {
    const memberIds = new Set(group.memberIds.map(id => id.toUpperCase()));
    const byType = new Map<string, HistorySeriesInfo[]>();
    for (const s of recorded) {
      if (!s.enabled || !memberIds.has(s.accessoryId.toUpperCase())) continue;
      const canonical = canonicalHistoryType(s.characteristicType);
      if (SETPOINT_STATE_TYPES.has(canonical)) continue; // config, not behavior
      const list = byType.get(canonical) ?? [];
      list.push(s);
      byType.set(canonical, list);
    }
    const rank = new Map(HISTORY_CHAR_ORDER.map((t, i) => [t, i]));
    return [...byType.entries()]
      .sort((a, b) => (rank.get(a[0]) ?? HISTORY_CHAR_ORDER.length) - (rank.get(b[0]) ?? HISTORY_CHAR_ORDER.length))
      .map(([type, list]) => ({ type, list, kind: list[0].kind, unit: list[0].unit }));
  }, [group.memberIds, recorded]);

  // Commands addressed to the group itself record under the group id.
  const ownSeries = useMemo(
    () => recorded.filter(s => s.enabled && s.accessoryId.toUpperCase() === group.id.toUpperCase()),
    [recorded, group.id],
  );

  const refs = useMemo<HistorySeriesRefInput[]>(() => {
    const out: HistorySeriesRefInput[] = [];
    for (const section of sections) {
      for (const s of section.list) {
        if (out.length >= MAX_REFS) break;
        out.push({ accessoryId: s.accessoryId, characteristicType: s.characteristicType });
      }
    }
    for (const own of ownSeries) {
      out.push({ accessoryId: own.accessoryId, characteristicType: own.characteristicType });
    }
    return out;
  }, [sections, ownSeries]);

  const { data, loading, progress } = useMultiSeriesHistory(homeId, refs, fromTs, toTs, mock, {
    enabled: refs.length > 0,
  });

  const entryOf = (s: HistorySeriesInfo): HistorySeriesData | undefined =>
    data.get(`${s.accessoryId.toUpperCase()}|${canonicalHistoryType(s.characteristicType)}`)?.main;

  if (sections.length === 0 && ownSeries.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-sm text-muted-foreground">
          Nothing recorded for {group.name}'s members yet — charts build as
          they report changes.
        </p>
      </div>
    );
  }
  if (loading && data.size === 0) return <ChartSkeleton progress={progress} />;

  return (
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
          // Implausible readings (radio-fault sentinels) never reach the
          // aggregate — one -40° would drag the whole group average.
          const sane = entries.map(e => sanitizeSeriesData(e).data);
          const points: HistoryPointData[] = aggregateNumericSeries(sane, fromTs, toTs)
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
                <span className="text-[0.625rem] text-muted-foreground">
                  average of {entries.length} member{entries.length === 1 ? '' : 's'} · shaded = spread
                </span>
              </div>
              <HistoryChart
                points={points}
                unit={section.unit}
                gradientId={`group-${group.id}-${section.type}`}
                fromTs={fromTs}
                toTs={toTs}
              />
              <p className="text-[0.6875rem] text-muted-foreground">
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
              <span className="text-[0.625rem] text-muted-foreground">
                how many of {entries.length} are on
              </span>
            </div>
            <HistoryChart
              points={points}
              unit={null}
              gradientId={`group-${group.id}-${section.type}`}
              fromTs={fromTs}
              toTs={toTs}
            />
            <p className="text-[0.6875rem] text-muted-foreground">
              combined on-time {formatDuration(totalOnMs)} · {changes} change{changes === 1 ? '' : 's'}
            </p>
          </div>
        );
      })}

      {ownSeries.map(own => {
        const ownData = entryOf(own);
        if (!ownData) return null;
        return (
          <div key={`own-${own.characteristicType}`} className="space-y-1.5">
            <div className="flex items-baseline justify-between">
              {/* Separator rather than "Group {label lowercased}": labels that
                  read as a verb phrase ("Heat to") turn that into nonsense. */}
              <span className="text-xs font-medium">Group · {charLabel(own.characteristicType)}</span>
              <span className="text-[0.625rem] text-muted-foreground">commands sent to the group as a whole</span>
            </div>
            <StateTimeline
              fromTs={fromTs}
              toTs={toTs}
              padLeft={PLOT_LEFT}
              padRight={PLOT_RIGHT}
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
  );
}
