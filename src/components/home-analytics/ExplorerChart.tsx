import { useMemo } from 'react';
import {
  Area,
  Brush,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistorySeriesData } from '@/lib/graphql/types';
import type { AggregatePoint } from '@/history/aggregate';
import { normalizeValue } from '@/history/aggregate';

/**
 * The Explorer's main mark: any mix of numeric series on one time axis.
 *
 * - Up to two unit groups get real axes (left/right); beyond that the
 *   Normalize toggle is the honest way to compare — the axis switches to
 *   0–100% of each series' own range.
 * - An aggregate band (min–max across many sensors) renders behind its bold
 *   average line — one room's 19 thermometers as one readable shape.
 * - Compare mode overlays the same series time-shifted, dashed: today
 *   against yesterday without leaving the chart.
 *
 * Lives in the /history route chunk, which is lazy — recharts never reaches
 * the dashboard bundle.
 */

// Series accents: index-stable, readable in both themes, distinguishable at
// thin line weights. First entry matches the app's primary accent.
export const SERIES_COLORS = [
  'hsl(var(--primary))',
  '#f59e0b',
  '#8b5cf6',
  '#10b981',
  '#ef4444',
  '#0ea5e9',
  '#ec4899',
  '#84cc16',
];

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length];
}

export interface ChartSeries {
  key: string;
  label: string;
  unit: string | null;
  data: HistorySeriesData;
  /** Ghost twin from compare mode, already time-shifted onto this range. */
  ghost?: HistorySeriesData;
}

interface ExplorerChartProps {
  series: ChartSeries[];
  /** Cross-sensor envelope rendered behind everything (aggregated presets). */
  band?: AggregatePoint[] | null;
  bandLabel?: string;
  fromTs: number;
  toTs: number;
  normalize: boolean;
  height?: number;
}

interface GridRow {
  ts: number;
  [seriesKey: string]: number | null;
}

/** LOCF every series onto one shared grid so recharts can join the rows. */
function buildGrid(
  series: ChartSeries[],
  band: AggregatePoint[] | null | undefined,
  fromTs: number,
  toTs: number,
  normalize: boolean,
  buckets = 300,
): { rows: GridRow[]; ranges: Map<string, { min: number; max: number }> } {
  const stepMs = Math.max((toTs - fromTs) / buckets, 1);
  const ranges = new Map<string, { min: number; max: number }>();

  const tracks: Array<{ key: string; points: Array<{ ts: number; v: number }>; opening: number | null }> = [];
  for (const s of series) {
    tracks.push({
      key: s.key,
      points: s.data.points.map(p => ({ ts: p.ts, v: p.avg })),
      opening: s.data.prevValue,
    });
    if (s.ghost) {
      tracks.push({
        key: `${s.key}::ghost`,
        points: s.ghost.points.map(p => ({ ts: p.ts, v: p.avg })),
        opening: s.ghost.prevValue,
      });
    }
  }
  for (const track of tracks) {
    let min = Infinity;
    let max = -Infinity;
    for (const p of track.points) {
      min = Math.min(min, p.v);
      max = Math.max(max, p.v);
    }
    if (track.opening !== null) {
      min = Math.min(min, track.opening);
      max = Math.max(max, track.opening);
    }
    ranges.set(track.key, { min, max });
  }

  const cursors = tracks.map(t => ({ ...t, index: 0, value: t.opening }));
  const bandCursor = band ? { points: band, index: 0, value: null as AggregatePoint | null } : null;

  const rows: GridRow[] = [];
  for (let ts = fromTs; ts < toTs; ts += stepMs) {
    const row: GridRow = { ts };
    for (const cursor of cursors) {
      while (cursor.index < cursor.points.length && cursor.points[cursor.index].ts <= ts) {
        cursor.value = cursor.points[cursor.index].v;
        cursor.index++;
      }
      const range = ranges.get(cursor.key)!;
      row[cursor.key] = cursor.value === null
        ? null
        : normalize
          ? normalizeValue(cursor.value, range.min, range.max)
          : cursor.value;
    }
    if (bandCursor) {
      while (bandCursor.index < bandCursor.points.length && bandCursor.points[bandCursor.index].ts <= ts) {
        bandCursor.value = bandCursor.points[bandCursor.index];
        bandCursor.index++;
      }
      if (bandCursor.value && !normalize) {
        row['__band'] = bandCursor.value.min as unknown as number;
        (row as Record<string, unknown>)['__bandRange'] = [bandCursor.value.min, bandCursor.value.max];
        row['__bandAvg'] = bandCursor.value.avg;
      }
    }
    rows.push(row);
  }
  return { rows, ranges };
}

function formatTick(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 48 * 3_600_000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function ExplorerChart({
  series, band, bandLabel, fromTs, toTs, normalize, height = 320,
}: ExplorerChartProps) {
  const { rows } = useMemo(
    () => buildGrid(series, band, fromTs, toTs, normalize),
    [series, band, fromTs, toTs, normalize],
  );
  const spanMs = toTs - fromTs;

  // Axis plan: units in appearance order; first → left, second → right.
  // More than two distinct units without Normalize would silently plot on
  // the wrong scale, so extra series borrow the left axis and the UI nudges
  // toward Normalize.
  const units = useMemo(() => {
    const seen: Array<string | null> = [];
    for (const s of series) {
      if (!seen.includes(s.unit)) seen.push(s.unit);
    }
    return seen;
  }, [series]);
  const axisFor = (unit: string | null): 'left' | 'right' => {
    if (normalize) return 'left';
    const index = units.indexOf(unit);
    return index === 1 ? 'right' : 'left';
  };
  const hasRightAxis = !normalize && units.length > 1;

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid className="stroke-border" vertical={false} />
          <XAxis
            dataKey="ts"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(ts: number) => formatTick(ts, spanMs)}
            tick={{ fontSize: 11, fill: 'currentColor' }}
            className="stroke-border text-muted-foreground"
            minTickGap={48}
          />
          <YAxis
            yAxisId="left"
            domain={normalize ? [0, 100] : ['auto', 'auto']}
            tick={{ fontSize: 11, fill: 'currentColor' }}
            className="stroke-border text-muted-foreground"
            width={44}
            tickFormatter={(v: number) => normalize ? `${Math.round(v)}%` : `${Number.isInteger(v) ? v : v.toFixed(1)}`}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={['auto', 'auto']}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="stroke-border text-muted-foreground"
              width={44}
              tickFormatter={(v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}`}
            />
          )}
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            labelFormatter={(ts: number) => new Date(ts).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
            formatter={(value: number | number[], name: string) => {
              if (name === '__bandRange') return null;
              if (Array.isArray(value)) return null;
              if (value === null || value === undefined) return null;
              const label = name === '__bandAvg' ? (bandLabel ?? 'average') : name.replace('::ghost', ' (previous)');
              return [normalize ? `${value.toFixed(0)}%` : value.toFixed(1), label];
            }}
          />
          {band && !normalize && (
            <Area
              yAxisId="left"
              name="__bandRange"
              type="stepAfter"
              dataKey="__bandRange"
              stroke="none"
              fill="currentColor"
              fillOpacity={0.1}
              className="text-primary"
              activeDot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          {band && !normalize && (
            <Line
              yAxisId="left"
              name="__bandAvg"
              type="stepAfter"
              dataKey="__bandAvg"
              stroke="hsl(var(--primary))"
              strokeWidth={2.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          {series.map((s, i) => (
            <Line
              key={s.key}
              yAxisId={axisFor(s.unit)}
              name={s.label}
              type="stepAfter"
              dataKey={s.key}
              stroke={seriesColor(i)}
              strokeWidth={band ? 1 : 2}
              strokeOpacity={band ? 0.45 : 1}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
          {series.filter(s => s.ghost).map((s, i) => (
            <Line
              key={`${s.key}::ghost`}
              yAxisId={axisFor(s.unit)}
              name={`${s.label} (previous)`}
              type="stepAfter"
              dataKey={`${s.key}::ghost`}
              stroke={seriesColor(series.indexOf(s))}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              strokeOpacity={0.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ))}
          <Brush
            dataKey="ts"
            height={22}
            travellerWidth={8}
            stroke="hsl(var(--muted-foreground))"
            fill="transparent"
            tickFormatter={(ts: number) => formatTick(ts, spanMs)}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
