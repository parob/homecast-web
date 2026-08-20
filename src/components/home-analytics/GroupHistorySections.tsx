import { useMemo } from 'react';
import { HISTORY_CHAR_ORDER } from '@/components/automations/characteristics';
import { charLabel } from '@/components/automations/format';
import { canonicalHistoryType } from '@/history/keys';
import { stateValueLabel } from '@/history/labels';
import ChartSkeleton from './ChartSkeleton';
import { SETPOINT_STATE_TYPES } from '@/history/categories';
import StateTimeline from '@/components/widgets/StateTimeline';
import AggregateSeriesSection from './AggregateSeriesSection';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import type { HistorySeriesData, HistorySeriesInfo, HistorySeriesRefInput } from '@/lib/graphql/types';

const MAX_REFS = 36;

export interface GroupRef {
  id: string;
  name: string;
  memberIds: string[];
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
        const numeric = section.kind === 'numeric';
        return (
          <AggregateSeriesSection
            key={section.type}
            title={charLabel(section.type)}
            source={numeric
              ? `average of ${entries.length} member${entries.length === 1 ? '' : 's'} · shaded = spread`
              : `how many of ${entries.length} are on`}
            entries={entries}
            kind={numeric ? 'numeric' : 'state'}
            unit={section.unit}
            fromTs={fromTs}
            toTs={toTs}
            gradientId={`group-${group.id}-${section.type}`}
          />
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
