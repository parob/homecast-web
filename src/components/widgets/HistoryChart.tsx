import {
  Area,
  ComposedChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { HistoryPointData } from '@/lib/graphql/types';
import { PLOT_LEFT, PLOT_RIGHT } from '@/components/home-analytics/chartGeometry';

/**
 * Numeric characteristic history: a stepAfter line of the (time-weighted)
 * average with a min–max envelope behind it when the tier carries one.
 *
 * Separate module + React.lazy for the same reason as DealPriceChart:
 * recharts is ~400 KB and belongs nowhere near the dashboard bundle.
 * stepAfter, not a curve — a characteristic holds its value until it
 * changes; smoothing would claim states the device never reported.
 */
export interface HistoryChartProps {
  points: HistoryPointData[];
  unit: string | null;
  gradientId: string;
  /**
   * The reading the window opened with (`HistorySeriesData.prevValue`). The
   * line is drawn from `fromTs` at this value: a series records on change, so
   * the first in-window sample is normally later than the window start, and
   * starting the line there both loses a known stretch and makes the space in
   * front of it look unrecorded when it isn't.
   */
  carriedValue?: number | null;
  /** Bare sparkline (no axes/grid/tooltip) at 60px. */
  sparkline?: boolean;
  /**
   * The window the user asked for. Without it the axis fits itself to the
   * DATA extent, so picking 30d on an accessory with 16 hours of recording
   * drew those 16 hours stretched across the panel and labelled 21:00–13:00
   * — the chart claimed a month it did not have. With it, the data sits in
   * its true slice and the rest of the window reads as what it is: no
   * recording yet.
   */
  fromTs?: number;
  toTs?: number;
}

function formatTick(ts: number, spanMs: number): string {
  const d = new Date(ts);
  if (spanMs <= 48 * 3_600_000) {
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function HistoryChart({
  points: rawPoints, unit, gradientId, sparkline = false, fromTs, toTs, carriedValue,
}: HistoryChartProps) {
  const windowed = fromTs !== undefined && toTs !== undefined;
  const carried = windowed && carriedValue !== null && carriedValue !== undefined
    && (rawPoints.length === 0 || rawPoints[0].ts > fromTs);
  const points = carried
    ? [{ ts: fromTs!, min: carriedValue!, avg: carriedValue!, max: carriedValue!, last: carriedValue!, count: 0 }, ...rawPoints]
    : rawPoints;
  const spanMs = windowed
    ? toTs - fromTs
    : (points.length > 1 ? points[points.length - 1].ts - points[0].ts : 0);
  const hasBand = points.some(p => p.max > p.min);
  const suffix = unit ?? '';

  // Hold the last reading to the edge of the window — the value did not stop
  // existing when recording paused, and a line ending mid-panel reads as a
  // rendering bug rather than as "now".
  const data = windowed && points.length > 0 && points[points.length - 1].ts < toTs
    ? [...points, { ...points[points.length - 1], ts: toTs }]
    : points;

  // Blank chart on the left of a 30d view is ambiguous: is that flat nothing,
  // a dead sensor, or a window that reaches back further than the recording?
  // Shade the stretch before anything was KNOWN — which is not the same as
  // before the first sample: a carried value covers the window from its start.
  const recordingStart = windowed && !carried && points.length > 0 ? points[0].ts : null;
  const showUnrecorded = !sparkline && recordingStart !== null
    && recordingStart - fromTs! > spanMs * 0.05;

  return (
    <div className={`text-primary ${sparkline ? 'h-[60px]' : 'h-[200px]'} w-full`}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={data}
          margin={sparkline
            ? { top: 2, right: 2, bottom: 2, left: 2 }
            : { top: 8, right: PLOT_RIGHT, bottom: 4, left: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity={0.18} />
              <stop offset="100%" stopColor="currentColor" stopOpacity={0.01} />
            </linearGradient>
          </defs>
          {!sparkline && <CartesianGrid className="stroke-border" vertical={false} />}
          {showUnrecorded && (
            <ReferenceArea
              x1={fromTs}
              x2={recordingStart!}
              className="fill-muted-foreground"
              fillOpacity={0.07}
              strokeOpacity={0}
              ifOverflow="extendDomain"
              label={{
                value: 'No data',
                position: 'center',
                className: 'fill-muted-foreground',
                fontSize: 10,
              }}
            />
          )}
          {!sparkline && (
            <XAxis
              dataKey="ts"
              type="number"
              scale="time"
              domain={windowed ? [fromTs, toTs] : ['dataMin', 'dataMax']}
              allowDataOverflow
              tickFormatter={(ts: number) => formatTick(ts, spanMs)}
              tick={{ fontSize: 11, fill: 'currentColor' }}
              className="stroke-border text-muted-foreground"
              minTickGap={40}
            />
          )}
          <YAxis
            domain={['auto', 'auto']}
            hide={sparkline}
            tick={{ fontSize: 11, fill: 'currentColor' }}
            className="stroke-border text-muted-foreground"
            width={PLOT_LEFT}
            tickFormatter={(v: number) => `${Number.isInteger(v) ? v : v.toFixed(1)}${suffix === '%' ? '%' : ''}`}
          />
          {!sparkline && (
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 8 }}
              labelFormatter={(ts: number) => new Date(ts).toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
              formatter={(value: number, name: string) => {
                if (name === 'band') return null;
                return [`${value.toFixed(1)}${suffix}`, 'Value'];
              }}
            />
          )}
          {hasBand && (
            // The envelope: what the value actually spanned inside each bucket.
            <Area
              name="band"
              type="stepAfter"
              dataKey={(p: HistoryPointData) => [p.min, p.max]}
              stroke="none"
              fill="currentColor"
              fillOpacity={0.12}
              activeDot={false}
              isAnimationActive={false}
            />
          )}
          <Area
            name="avg"
            type="stepAfter"
            dataKey="avg"
            stroke="currentColor"
            strokeWidth={2}
            fill={hasBand ? 'none' : `url(#${gradientId})`}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
