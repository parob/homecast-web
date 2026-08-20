import { aggregateNumericSeries, stateToNumericSeriesWith, type OnPredicate } from '@/history/aggregate';
import { sanitizeSeriesData } from '@/history/sanitize';
import { onMsWith, eventCount } from '@/history/insights';
import HistoryChart from '@/components/widgets/HistoryChart';
import { formatDuration } from './AccessorySections';
import type { HistoryPointData, HistorySeriesData } from '@/lib/graphql/types';

const NONZERO_IS_ON: OnPredicate = v => v !== 0;

/**
 * Several series of the same characteristic, drawn as one chart.
 *
 * Two shapes, and which one you get is the series' kind:
 *
 *  - numeric — the average with the min–max envelope shaded behind it. One
 *    bold line inside a band says more than nineteen thin ones, and the band
 *    is the honest answer to "is that 22° everywhere or 18° and 26°?".
 *  - state — "how many are on" over time, from each member's on-fraction.
 *
 * Extracted from the service-group view so the group popup, the Groups
 * screen and the Status analytics dialog cannot drift into telling three
 * different stories about the same arithmetic.
 */
export default function AggregateSeriesSection({
  title,
  source,
  entries,
  kind,
  unit,
  fromTs,
  toTs,
  gradientId,
  isOn = NONZERO_IS_ON,
  onLabel,
  note,
}: {
  /** Panel heading. */
  title: string;
  /** Provenance line at the top right ("average of 3 sensors · shaded = spread"). */
  source: string;
  entries: HistorySeriesData[];
  kind: 'numeric' | 'state';
  unit: string | null;
  fromTs: number;
  toTs: number;
  /** Must be unique on the page — it names an SVG gradient. */
  gradientId: string;
  /** State only: what counts as "on". Defaults to non-zero. */
  isOn?: OnPredicate;
  /** State only: the word in "___ for 2h 14m in total". */
  onLabel?: string;
  /** Appended to the caption — a truncation note, usually. */
  note?: string;
}) {
  if (entries.length === 0) return null;

  const caption = (text: string) => (
    <p className="text-[0.6875rem] text-muted-foreground">
      {text}{note ? ` · ${note}` : ''}
    </p>
  );

  const frame = (children: React.ReactNode) => (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{title}</span>
        <span className="text-[0.625rem] text-muted-foreground text-right">{source}</span>
      </div>
      {children}
    </div>
  );

  if (kind === 'numeric') {
    // Implausible readings (radio-fault sentinels) never reach the aggregate
    // — one -40° would drag the whole average.
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
    const suffix = unit ?? '';
    return frame(
      <>
        <HistoryChart points={points} unit={unit} gradientId={gradientId} fromTs={fromTs} toTs={toTs} />
        {caption(
          `min ${min.toFixed(1)}${suffix} · avg ${(sum / points.length).toFixed(1)}${suffix} · max ${max.toFixed(1)}${suffix}`,
        )}
      </>,
    );
  }

  // State kinds: "how many are on" over time — the honest aggregate of a set
  // of on/off members — plus totals.
  const numericized = entries.map(e => stateToNumericSeriesWith(e, isOn));
  const agg = aggregateNumericSeries(numericized, fromTs, toTs);
  const points: HistoryPointData[] = agg.map(p => {
    const on = p.avg * p.count;
    return { ts: p.ts, min: on, avg: on, max: on, last: on, count: p.count };
  });
  if (points.length === 0) return null;

  const totalOnMs = entries.reduce((a, d) => a + onMsWith(d, fromTs, toTs, isOn), 0);
  const changes = entries.reduce((a, d) => a + eventCount(d), 0);
  const changeText = `${changes} change${changes === 1 ? '' : 's'}`;
  return frame(
    <>
      <HistoryChart points={points} unit={null} gradientId={gradientId} fromTs={fromTs} toTs={toTs} />
      {caption(
        onLabel
          ? `${onLabel} for ${formatDuration(totalOnMs)} in total · ${changeText}`
          : `combined on-time ${formatDuration(totalOnMs)} · ${changeText}`,
      )}
    </>,
  );
}
