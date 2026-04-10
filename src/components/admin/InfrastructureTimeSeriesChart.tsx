import { useQuery } from '@apollo/client/react';
import { GET_INFRASTRUCTURE_TIME_SERIES } from '@/lib/graphql/admin-queries';
import type { AdminTimeSeriesResponse } from '@/lib/graphql/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { InfoTooltip } from '@/components/admin/InfoTooltip';
import { defaultFormat, formatTime } from '@/components/admin/chart-format';

interface Props {
  metric: string;
  title: string;
  description: React.ReactNode;
  deployment?: string;
  hours?: number;
  /** Filter to a single pod (k8s metrics only — ignored for Pub/Sub metrics) */
  podName?: string;
  /** Format the y-axis value, e.g., bytes → "100 MiB" */
  formatValue?: (n: number) => string;
  color?: string;
}

export function InfrastructureTimeSeriesChart({
  metric,
  title,
  description,
  deployment = 'homecast',
  hours = 1,
  podName,
  formatValue,
  color = 'hsl(var(--primary))',
}: Props) {
  const { data, loading } = useQuery<AdminTimeSeriesResponse>(
    GET_INFRASTRUCTURE_TIME_SERIES,
    {
      variables: { metric, deployment, hours, podName },
      pollInterval: 30000,
    }
  );

  const result = data?.infrastructureTimeSeries;
  const points = result?.points ?? [];
  const fmt = formatValue ?? defaultFormat(result?.unit ?? '');

  // Latest value for the headline number
  const latest = points.length > 0 ? points[points.length - 1].value : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{title}</CardTitle>
            <InfoTooltip>{description}</InfoTooltip>
          </div>
          {latest !== null && (
            <div className="text-2xl font-bold">{fmt(latest)}</div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {loading && points.length === 0 ? (
          <div className="text-sm text-muted-foreground h-[180px] flex items-center justify-center">Loading...</div>
        ) : points.length === 0 ? (
          <div className="text-sm text-muted-foreground italic h-[180px] flex items-center justify-center">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={points} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis
                dataKey="timestamp"
                tickFormatter={formatTime}
                className="text-xs"
                tick={{ fill: 'currentColor' }}
              />
              <YAxis
                tickFormatter={fmt}
                className="text-xs"
                tick={{ fill: 'currentColor' }}
                width={50}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--popover))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                }}
                labelFormatter={formatTime}
                formatter={(value: number) => fmt(value)}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                fill={`url(#gradient-${metric})`}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
