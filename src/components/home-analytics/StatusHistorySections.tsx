import { useMemo } from 'react';
import AggregateSeriesSection, { type AggregateEntry } from './AggregateSeriesSection';
import { disambiguateSeriesLabels } from '@/history/labels';
import ChartSkeleton from './ChartSkeleton';
import { useMultiSeriesHistory } from './useMultiSeriesHistory';
import type { StatusHistoryCategory } from '@/history/status-series';

/**
 * The Status bubbles, over time.
 *
 * One aggregate panel per category, in the order the bubbles appear: the
 * temperature bubble that reads "20.8 – 22.6°" becomes an average line with
 * the spread shaded behind it, and "2 open" becomes how many of the
 * contact sensors were open through the window. Same arithmetic and same
 * layout as a service group's charts — see AggregateSeriesSection.
 *
 * No recorded-series lookup: unlike a group, we already know exactly which
 * characteristics to ask for, and GetHistory answers for an unrecorded
 * series with an empty one, which renders as nothing.
 */
export default function StatusHistorySections({
  homeId,
  mock,
  categories,
  fromTs,
  toTs,
}: {
  /** Default home for refs that don't name their own. */
  homeId: string | null;
  mock: boolean;
  categories: StatusHistoryCategory[];
  fromTs: number;
  toTs: number;
}) {
  const refs = useMemo(() => categories.flatMap(c => c.refs), [categories]);

  const { data, loading, progress } = useMultiSeriesHistory(homeId, refs, fromTs, toTs, mock, {
    enabled: refs.length > 0,
  });

  const sections = useMemo(
    () => categories.map(category => {
      // Every sensor in a category reports the same characteristic, so the
      // name that tells them apart is the room and the accessory — which is
      // exactly what disambiguateSeriesLabels trims down to.
      const labels = disambiguateSeriesLabels(category.refs.map(ref => ({
        key: `${ref.accessoryId.toUpperCase()}|${ref.characteristicType}`,
        room: ref.roomName ?? null,
        accessoryName: ref.accessoryName,
        charLabel: category.title,
      })));
      const entries: AggregateEntry[] = category.refs.flatMap(ref => {
        const key = `${ref.accessoryId.toUpperCase()}|${ref.characteristicType}`;
        const main = data.get(key)?.main;
        return main ? [{ data: main, label: labels.get(key)?.short ?? ref.accessoryName }] : [];
      });
      return { category, entries };
    }),
    [categories, data],
  );

  const hasAnyData = sections.some(({ entries }) => entries.some(
    ({ data: d }) => d.points.length > 0 || d.states.length > 0 || d.stateBuckets.length > 0,
  ));

  if (loading && data.size === 0) {
    return <ChartSkeleton panels={Math.min(categories.length, 3)} progress={progress} />;
  }

  if (!hasAnyData) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Nothing recorded for this range yet — charts fill in as these sensors
        report changes.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {sections.map(({ category, entries }) => {
        const numeric = category.kind === 'numeric';
        const count = entries.length;
        const unit = entries.find(e => e.data.unit)?.data.unit ?? category.unit;
        return (
          <AggregateSeriesSection
            key={category.key}
            title={category.title}
            source={numeric
              ? `average of ${count} sensor${count === 1 ? '' : 's'} · shaded = spread`
              : `how many of ${count} are ${category.onLabel ?? 'on'}`}
            entries={entries}
            kind={category.kind}
            unit={unit}
            isOn={category.isOn}
            onLabel={category.onLabel}
            note={category.truncated > 0
              ? `${category.truncated} more sensor${category.truncated === 1 ? '' : 's'} not charted`
              : undefined}
            fromTs={fromTs}
            toTs={toTs}
            gradientId={`status-${category.key}`}
          />
        );
      })}
    </div>
  );
}
