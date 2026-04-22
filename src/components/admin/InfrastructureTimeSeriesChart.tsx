import { useQuery } from '@apollo/client/react';
import { GET_INFRASTRUCTURE_TIME_SERIES } from '@/lib/graphql/admin-queries';
import type { AdminTimeSeriesResponse } from '@/lib/graphql/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Tooltip } from 'recharts';
import { InfoTooltip } from '@/components/admin/InfoTooltip';
import { defaultFormat, formatTime } from '@/components/admin/chart-format';
import { useAdminEnvToggle } from '@/hooks/useAdminEnvToggle';
import { prodClient } from '@/lib/apollo-other-env';

const ENV_COLORS = {
  production: 'hsl(var(--primary))',
  staging: 'hsl(38 92% 50%)',
} as const;

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

export function InfrastructureTimeSeriesChart(props: Props) {
  const { showProduction, showStaging } = useAdminEnvToggle();
  // If the caller pinned a deployment, trust it and render single-series.
  if (props.deployment) {
    return <SingleInfrastructureTimeSeriesChart {...props} />;
  }
  return <PairedInfrastructureTimeSeriesChart {...props} showProd={showProduction} showStaging={showStaging} />;
}

function SingleInfrastructureTimeSeriesChart({
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
  const latest = points.length > 0 ? points[points.length - 1].value : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{title}</CardTitle>
            <InfoTooltip>{description}</InfoTooltip>
          </div>
          {latest !== null && <div className="text-2xl font-bold">{fmt(latest)}</div>}
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
              <XAxis dataKey="timestamp" tickFormatter={formatTime} className="text-xs" tick={{ fill: 'currentColor' }} />
              <YAxis tickFormatter={fmt} className="text-xs" tick={{ fill: 'currentColor' }} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                labelFormatter={formatTime}
                formatter={(value: number) => fmt(value)}
              />
              <Area type="monotone" dataKey="value" stroke={color} fill={`url(#gradient-${metric})`} strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

function PairedInfrastructureTimeSeriesChart({
  metric,
  title,
  description,
  hours = 1,
  podName,
  formatValue,
  showProd,
  showStaging,
}: Props & { showProd: boolean; showStaging: boolean }) {
  // GCP Cloud Monitoring queries go through either server's service account
  // (both have access to the same project), so we run both series against a
  // single Apollo client with different `deployment` filters.
  const client = prodClient ?? undefined;

  // GKE deployment naming: staging = "homecast", prod = "homecast-prod"
  // (historical — staging predates prod so the un-suffixed name is staging).
  const prodQ = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric, deployment: 'homecast-prod', hours, podName },
    pollInterval: 30000,
    skip: !showProd,
    client,
    errorPolicy: 'all',
  });
  const stagingQ = useQuery<AdminTimeSeriesResponse>(GET_INFRASTRUCTURE_TIME_SERIES, {
    variables: { metric, deployment: 'homecast', hours, podName },
    pollInterval: 30000,
    skip: !showStaging,
    client,
    errorPolicy: 'all',
  });

  const prodPoints = prodQ.data?.infrastructureTimeSeries?.points ?? [];
  const stagingPoints = stagingQ.data?.infrastructureTimeSeries?.points ?? [];
  const unit = prodQ.data?.infrastructureTimeSeries?.unit ?? stagingQ.data?.infrastructureTimeSeries?.unit ?? '';
  const fmt = formatValue ?? defaultFormat(unit);

  const bucket = new Map<string, { timestamp: string; prod?: number; staging?: number }>();
  for (const p of prodPoints) {
    const row = bucket.get(p.timestamp) ?? { timestamp: p.timestamp };
    row.prod = p.value;
    bucket.set(p.timestamp, row);
  }
  for (const p of stagingPoints) {
    const row = bucket.get(p.timestamp) ?? { timestamp: p.timestamp };
    row.staging = p.value;
    bucket.set(p.timestamp, row);
  }
  const points = Array.from(bucket.values()).sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1));

  const prodLatest = prodPoints.length > 0 ? prodPoints[prodPoints.length - 1].value : null;
  const stagingLatest = stagingPoints.length > 0 ? stagingPoints[stagingPoints.length - 1].value : null;

  const anyLoading = (showProd && prodQ.loading) || (showStaging && stagingQ.loading);
  const noData = points.length === 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <CardTitle className="text-base">{title}</CardTitle>
            <InfoTooltip>{description}</InfoTooltip>
          </div>
          <div className="flex items-baseline gap-2">
            {showProd && prodLatest !== null && (
              <span className="text-xl font-bold" style={{ color: ENV_COLORS.production }}>{fmt(prodLatest)}</span>
            )}
            {showStaging && stagingLatest !== null && (
              <span className="text-xl font-bold" style={{ color: ENV_COLORS.staging }}>{fmt(stagingLatest)}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {anyLoading && noData ? (
          <div className="text-sm text-muted-foreground h-[180px] flex items-center justify-center">Loading...</div>
        ) : noData ? (
          <div className="text-sm text-muted-foreground italic h-[180px] flex items-center justify-center">
            No data available
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={points} margin={{ top: 5, right: 5, left: 5, bottom: 5 }}>
              <defs>
                <linearGradient id={`gradient-${metric}-prod`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ENV_COLORS.production} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={ENV_COLORS.production} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`gradient-${metric}-staging`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={ENV_COLORS.staging} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={ENV_COLORS.staging} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="timestamp" tickFormatter={formatTime} className="text-xs" tick={{ fill: 'currentColor' }} />
              <YAxis tickFormatter={fmt} className="text-xs" tick={{ fill: 'currentColor' }} width={50} />
              <Tooltip
                contentStyle={{ backgroundColor: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: '6px', fontSize: '12px' }}
                labelFormatter={formatTime}
                formatter={(value: number, name: string) => [fmt(value), name]}
              />
              {showProd && (
                <Area
                  type="monotone"
                  dataKey="prod"
                  name="Production"
                  stroke={ENV_COLORS.production}
                  fill={`url(#gradient-${metric}-prod)`}
                  strokeWidth={2}
                  connectNulls
                />
              )}
              {showStaging && (
                <Area
                  type="monotone"
                  dataKey="staging"
                  name="Staging"
                  stroke={ENV_COLORS.staging}
                  fill={`url(#gradient-${metric}-staging)`}
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  connectNulls
                />
              )}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
