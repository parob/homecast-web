import { useQuery } from '@apollo/client/react';
import { GET_INFRASTRUCTURE_TIME_SERIES } from '@/lib/graphql/admin-queries';
import type { AdminTimeSeriesResponse } from '@/lib/graphql/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { InfoTooltip } from '@/components/admin/InfoTooltip';

interface Props {
  metric: string;
  title: string;
  description: React.ReactNode;
  deployment?: string;
  hours?: number;
  /** Format the y-axis value, e.g., bytes → "100 MiB" */
  formatValue?: (n: number) => string;
  color?: string;
}

function defaultFormat(unit: string) {
  return (n: number) => {
    if (unit === 'bytes' || unit === 'bytes/sec') {
      if (n < 1024) return `${n.toFixed(0)}`;
      if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)}K`;
      if (n < 1024 ** 3) return `${(n / 1024 / 1024).toFixed(0)}M`;
      return `${(n / 1024 / 1024 / 1024).toFixed(1)}G`;
    }
    if (unit === 'millicores') return `${Math.round(n)}m`;
    return n.toFixed(0);
  };
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function InfrastructureTimeSeriesChart({
  metric,
  title,
  description,
  deployment = 'homecast',
  hours = 1,
  formatValue,
  color = 'hsl(var(--primary))',
}: Props) {
  const { data, loading } = useQuery<AdminTimeSeriesResponse>(
    GET_INFRASTRUCTURE_TIME_SERIES,
    {
      variables: { metric, deployment, hours },
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
