import { useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_INFRASTRUCTURE_TIME_SERIES } from '@/lib/graphql/admin-queries';
import type { AdminTimeSeriesResponse } from '@/lib/graphql/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  Legend,
} from 'recharts';
import { InfoTooltip } from '@/components/admin/InfoTooltip';
import { defaultFormat, formatTime } from '@/components/admin/chart-format';

export interface SeriesDef {
  metric: string;
  label: string;
  color: string;
  /** Y-axis to plot on. Defaults to 'left'. Use 'right' for series with a different unit. */
  axis?: 'left' | 'right';
}

interface Props {
  series: SeriesDef[];
  title: string;
  description: React.ReactNode;
  deployment?: string;
  hours?: number;
  podName?: string;
  height?: number;
}

interface MergedRow {
  timestamp: string;
  [key: string]: string | number | null;
}

/**
 * Renders multiple time-series metrics overlaid on a single chart with optional
 * dual y-axes (one per unit). Each series fires its own Apollo query — the
 * Apollo cache will dedupe duplicate (metric,deployment,hours) calls.
 */
export function InfrastructureMultiSeriesChart({
  series,
  title,
  description,
  deployment = 'homecast',
  hours = 1,
  podName,
  height = 300,
}: Props) {
  // One useQuery per series. React requires a stable hook count, so we cap at 5.
  const MAX_SERIES = 5;
  const padded: (SeriesDef | null)[] = [
    ...series,
    ...Array(MAX_SERIES - series.length).fill(null),
  ].slice(0, MAX_SERIES);

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const q0 = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric: padded[0]?.metric ?? '_skip', deployment, hours, podName },
    skip: !padded[0],
    pollInterval: 30000,
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const q1 = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric: padded[1]?.metric ?? '_skip', deployment, hours, podName },
    skip: !padded[1],
    pollInterval: 30000,
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const q2 = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric: padded[2]?.metric ?? '_skip', deployment, hours, podName },
    skip: !padded[2],
    pollInterval: 30000,
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const q3 = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric: padded[3]?.metric ?? '_skip', deployment, hours, podName },
    skip: !padded[3],
    pollInterval: 30000,
  });
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const q4 = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric: padded[4]?.metric ?? '_skip', deployment, hours, podName },
    skip: !padded[4],
    pollInterval: 30000,
  });

  const queries = [q0, q1, q2, q3, q4];
  const results = padded.map((s, i) => ({
    def: s,
    result: queries[i].data?.infrastructureTimeSeries ?? null,
    loading: queries[i].loading,
  }));

  const activeSeries = results.filter((r) => r.def !== null);
  const anyLoading = activeSeries.some((r) => r.loading);
  const hasAnyData = activeSeries.some((r) => (r.result?.points?.length ?? 0) > 0);

  // Build a unit map per metric, used for tooltip formatting
  const unitByMetric = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of activeSeries) {
      if (r.def && r.result) m[r.def.metric] = r.result.unit;
    }
    return m;
  }, [activeSeries]);

  // Merge all series points into one row per timestamp
  const merged: MergedRow[] = useMemo(() => {
    const byTs: Record<string, MergedRow> = {};
    for (const r of activeSeries) {
      if (!r.def || !r.result) continue;
      for (const p of r.result.points) {
        if (!byTs[p.timestamp]) {
          byTs[p.timestamp] = { timestamp: p.timestamp };
        }
        byTs[p.timestamp][r.def.metric] = p.value;
      }
    }
    return Object.values(byTs).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [activeSeries]);

  // Per-axis formatters — use the unit of the first series on that axis
  const leftSeries = activeSeries.filter((r) => r.def?.axis !== 'right');
  const rightSeries = activeSeries.filter((r) => r.def?.axis === 'right');
  const leftUnit = leftSeries[0]?.result?.unit ?? '';
  const rightUnit = rightSeries[0]?.result?.unit ?? '';
  const leftFmt = defaultFormat(leftUnit);
  const rightFmt = defaultFormat(rightUnit);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle className="text-base">{title}</CardTitle>
          <InfoTooltip>{description}</InfoTooltip>
        </div>
      </CardHeader>
      <CardContent>
        {anyLoading && !hasAnyData ? (
          <div className="text-sm text-muted-foreground" style={{ height }}>
            <div className="h-full flex items-center justify-center">Loading...</div>
          </div>
        ) : !hasAnyData ? (
          <div className="text-sm text-muted-foreground italic" style={{ height }}>
            <div className="h-full flex items-center justify-center">No data available</div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <LineChart data={merged} margin={{ top: 10, right: 20, left: 5, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                className="text-xs"
                tick={{ fill: 'currentColor' }}
              />
              <YAxis
                yAxisId="left"
                tickFormatter={leftFmt}
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                width={60}
              />
              {rightSeries.length > 0 && (
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  tickFormatter={rightFmt}
                  className="text-xs"
                  tick={{ fill: 'currentColor' }}
                  width={60}
                />
              )}
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                labelFormatter={formatTime}
                formatter={(value: number, name: string) => {
                  // `name` is the series label (we set it via the Line `name` prop)
                  // map it back to its metric to find the unit
                  const def = activeSeries.find((r) => r.def?.label === name)?.def;
                  const unit = def ? unitByMetric[def.metric] : '';
                  return [defaultFormat(unit)(value), name];
                }}
              />
              <Legend
                verticalAlign="top"
                height={28}
                iconType="line"
                wrapperStyle={{ fontSize: '12px' }}
              />
              {activeSeries.map((r) =>
                r.def ? (
                  <Line
                    key={r.def.metric}
                    yAxisId={r.def.axis === 'right' ? 'right' : 'left'}
                    type="monotone"
                    dataKey={r.def.metric}
                    name={r.def.label}
                    stroke={r.def.color}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                ) : null
              )}
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
