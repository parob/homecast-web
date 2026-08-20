import { lazy, Suspense, useMemo, useState } from 'react';
import { aggregateNumericSeries, stateToNumericSeriesWith, type OnPredicate } from '@/history/aggregate';
import { sanitizeSeriesData } from '@/history/sanitize';
import { onMsWith, eventCount } from '@/history/insights';
import { canonicalHistoryType } from '@/history/keys';
import { stateValueLabel } from '@/history/labels';
import HistoryChart from '@/components/widgets/HistoryChart';
import StateTimeline from '@/components/widgets/StateTimeline';
import { seriesColor, type ChartSeries } from './chartColors';
import { PLOT_LEFT, PLOT_RIGHT } from './chartGeometry';
import { formatDuration } from './AccessorySections';
import type { HistoryPointData, HistorySeriesData } from '@/lib/graphql/types';

// Only loaded when someone actually splits a chart apart — it pulls ECharts.
const EChartsTimeChart = lazy(() => import('./EChartsTimeChart'));

const NONZERO_IS_ON: OnPredicate = v => v !== 0;

export interface AggregateEntry {
  data: HistorySeriesData;
  /** What this line is called once the aggregate is split apart. */
  label: string;
}

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
 * An average is a claim about a group, and sometimes the question is which
 * member made it — so a section with more than one series can be split into
 * its parts: the numeric chart redraws as a line per sensor over the same
 * band, and the state chart becomes one timeline per member. Nothing is
 * recomputed and nothing is refetched; it is the same data, ungrouped.
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
  entries: AggregateEntry[];
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
  const [separate, setSeparate] = useState(false);

  const numeric = kind === 'numeric';
  // Radio-fault sentinels (-40°) never reach the aggregate or the lines —
  // one would drag the average and flatten everything else.
  const prepared = useMemo(
    () => entries.map(e => (numeric
      ? { ...e, data: sanitizeSeriesData(e.data).data }
      : { ...e, data: stateToNumericSeriesWith(e.data, isOn) })),
    [entries, numeric, isOn],
  );

  const aggregate = useMemo(
    () => aggregateNumericSeries(prepared.map(e => e.data), fromTs, toTs),
    [prepared, fromTs, toTs],
  );

  const chartSeries = useMemo<ChartSeries[]>(
    () => prepared.map((e, i) => ({
      key: `${e.data.accessoryId}|${e.data.characteristicType}`,
      label: e.label,
      unit: numeric ? unit : null,
      data: e.data,
      color: seriesColor(i),
    })),
    [prepared, numeric, unit],
  );

  if (entries.length === 0) return null;

  const splittable = entries.length > 1;

  const frame = (children: React.ReactNode, caption?: string) => (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium">{title}</span>
        <span className="flex min-w-0 items-baseline justify-end gap-2">
          <span className="truncate text-[0.625rem] text-muted-foreground text-right">{source}</span>
          {splittable && (
            // Says what you will get, not what you are looking at — a toggle
            // labelled with its current state reads as a status line.
            <button
              type="button"
              onClick={() => setSeparate(v => !v)}
              className="shrink-0 rounded px-1.5 py-0.5 text-[0.625rem] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              title={separate
                ? 'Combine these back into one average'
                : `Draw each of the ${entries.length} separately`}
            >
              {separate ? 'Combine' : 'Separate'}
            </button>
          )}
        </span>
      </div>
      {children}
      {caption && (
        <p className="text-[0.6875rem] text-muted-foreground">
          {caption}{note ? ` · ${note}` : ''}
        </p>
      )}
    </div>
  );

  if (numeric) {
    const points: HistoryPointData[] = aggregate
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
    const caption =
      `min ${min.toFixed(1)}${suffix} · avg ${(sum / points.length).toFixed(1)}${suffix} · max ${max.toFixed(1)}${suffix}`;

    if (separate) {
      return frame(
        <Suspense fallback={<div className="h-[220px]" />}>
          {/* The band stays: each line is worth more against the spread it
              came from than floating on its own. */}
          <EChartsTimeChart
            series={chartSeries}
            band={aggregate}
            bandLabel="average"
            fromTs={fromTs}
            toTs={toTs}
            normalize={false}
            height={220}
            hideSlider
          />
        </Suspense>,
        caption,
      );
    }

    return frame(
      <HistoryChart points={points} unit={unit} gradientId={gradientId} fromTs={fromTs} toTs={toTs} />,
      caption,
    );
  }

  // State kinds: "how many are on" over time — the honest aggregate of a set
  // of on/off members — plus totals.
  const points: HistoryPointData[] = aggregate.map(p => {
    const on = p.avg * p.count;
    return { ts: p.ts, min: on, avg: on, max: on, last: on, count: p.count };
  });
  if (points.length === 0) return null;

  const totalOnMs = entries.reduce((a, e) => a + onMsWith(e.data, fromTs, toTs, isOn), 0);
  const changes = entries.reduce((a, e) => a + eventCount(e.data), 0);
  const changeText = `${changes} change${changes === 1 ? '' : 's'}`;
  const caption = onLabel
    ? `${onLabel} for ${formatDuration(totalOnMs)} in total · ${changeText}`
    : `combined on-time ${formatDuration(totalOnMs)} · ${changeText}`;

  if (separate) {
    // A count-of-N line per member would be N lines pinned to 0 and 1, drawn
    // on top of each other. A state series' own chart is its timeline, so
    // that is what each member gets — one labelled row apiece.
    return frame(
      <div className="space-y-1">
        {entries.map(e => (
          <div key={`${e.data.accessoryId}|${e.data.characteristicType}`} className="space-y-0.5">
            <span className="text-[0.625rem] text-muted-foreground">{e.label}</span>
            <StateTimeline
              fromTs={fromTs}
              toTs={toTs}
              padLeft={PLOT_LEFT}
              padRight={PLOT_RIGHT}
              prevValue={e.data.prevValue}
              prevValueText={e.data.prevValueText}
              states={e.data.states}
              stateBuckets={e.data.stateBuckets}
              labelFor={(v, text) => text ?? stateValueLabel(canonicalHistoryType(e.data.characteristicType), v)}
            />
          </div>
        ))}
      </div>,
      caption,
    );
  }

  return frame(
    <HistoryChart points={points} unit={null} gradientId={gradientId} fromTs={fromTs} toTs={toTs} />,
    caption,
  );
}
