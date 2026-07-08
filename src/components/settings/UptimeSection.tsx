import { useQuery } from '@apollo/client/react';
import { GET_HOME_UPTIME } from '@/lib/graphql/queries';
import { ShieldCheck, ShieldAlert, WifiOff, AlertTriangle, HelpCircle } from 'lucide-react';
import { formatRelativeAgo } from '@/lib/relay-last-seen';

interface UptimeBucket {
  bucketStart: string;
  verified: number;
  connected: number;
  degraded: number;
  offline: number;
  total: number;
}

interface UptimeOutage {
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  severity: 'offline' | 'degraded';
}

interface LastProbe {
  probedAt: string;
  status: string;
  accessoryName: string | null;
  characteristicType: string | null;
  value: string | null;
  reason: string | null;
}

interface UptimeSummary {
  currentStatus: string;
  uptimePercent24h: number;
  uptimePercent7d: number;
  uptimePercent30d: number;
  verifiedRatio7d: number;
  avgLatencyMs: number | null;
  lastProbe: LastProbe | null;
  timeline: UptimeBucket[];
  outages: UptimeOutage[];
}

interface GetHomeUptimeResponse {
  homeUptime: UptimeSummary;
}

function formatPercent(value: number): string {
  if (value >= 99.95) return '100%';
  if (value >= 10) return `${value.toFixed(1)}%`;
  if (value > 0) return `${value.toFixed(2)}%`;
  return '0%';
}

function percentColor(value: number): string {
  if (value >= 99.5) return 'text-green-600';
  if (value >= 98) return 'text-amber-600';
  return 'text-red-600';
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(seconds / 86400)}d`;
}

function statusBadge(status: string): { label: string; tooltip: string; icon: JSX.Element; classes: string } {
  switch (status) {
    case 'verified':
      return {
        label: 'Verified',
        tooltip:
          'We just confirmed your relay can read live values from one of your accessories. The full pipeline is working.',
        icon: <ShieldCheck className="h-3.5 w-3.5" />,
        classes: 'bg-green-500/10 text-green-700 dark:text-green-400',
      };
    case 'connected':
      return {
        label: 'Connected — not fully verified',
        tooltip:
          "We can reach your relay, but we haven't recently confirmed it can read from your accessories. Either no probable accessory was available or the last probe didn't return a value.",
        icon: <ShieldAlert className="h-3.5 w-3.5" />,
        classes: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
      };
    case 'degraded':
      return {
        label: 'Degraded',
        tooltip:
          'Your relay is connected, but multiple recent probes have timed out. The HomeKit pipeline appears stuck.',
        icon: <AlertTriangle className="h-3.5 w-3.5" />,
        classes: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
      };
    case 'offline':
      return {
        label: 'Offline',
        tooltip: 'Your relay is not connected to the cloud right now.',
        icon: <WifiOff className="h-3.5 w-3.5" />,
        classes: 'bg-red-500/10 text-red-700 dark:text-red-400',
      };
    default:
      return {
        label: 'Unknown',
        tooltip: 'No recent uptime data yet.',
        icon: <HelpCircle className="h-3.5 w-3.5" />,
        classes: 'bg-muted text-muted-foreground',
      };
  }
}

function TimelineStrip({ buckets }: { buckets: UptimeBucket[] }) {
  // Render exactly 7 × 24 = 168 cells, filling missing hours with neutral grey.
  const now = new Date();
  const startMs = now.getTime() - 7 * 24 * 60 * 60 * 1000;
  const startHour = new Date(startMs);
  startHour.setMinutes(0, 0, 0);

  const byHour = new Map<number, UptimeBucket>();
  for (const b of buckets) {
    const t = new Date(b.bucketStart).getTime();
    byHour.set(t - (t % (60 * 60 * 1000)), b);
  }

  const cells: JSX.Element[] = [];
  for (let i = 0; i < 168; i++) {
    const hourTs = startHour.getTime() + i * 60 * 60 * 1000;
    const b = byHour.get(hourTs);
    const total = b?.total ?? 0;
    const hourDate = new Date(hourTs);
    if (!b || total === 0) {
      cells.push(
        <div
          key={i}
          className="flex-1 h-6 rounded-sm bg-muted/40"
          title={`${hourDate.toLocaleString()}: no data`}
        />,
      );
      continue;
    }
    const v = (b.verified / total) * 100;
    const c = (b.connected / total) * 100;
    const d = (b.degraded / total) * 100;
    const o = (b.offline / total) * 100;
    const title = `${hourDate.toLocaleString()}: verified ${v.toFixed(0)}%, connected ${c.toFixed(0)}%, degraded ${d.toFixed(0)}%, offline ${o.toFixed(0)}%`;
    cells.push(
      <div
        key={i}
        className="flex-1 h-6 rounded-sm overflow-hidden flex flex-col"
        title={title}
      >
        {v > 0 && <div className="bg-green-500" style={{ height: `${v}%` }} />}
        {c > 0 && <div className="bg-green-300 dark:bg-green-700" style={{ height: `${c}%` }} />}
        {d > 0 && <div className="bg-orange-500" style={{ height: `${d}%` }} />}
        {o > 0 && <div className="bg-red-500" style={{ height: `${o}%` }} />}
      </div>,
    );
  }
  return <div className="flex gap-[1px] w-full">{cells}</div>;
}

interface UptimeSectionProps {
  homeId: string;
}

export function UptimeSection({ homeId }: UptimeSectionProps) {
  const { data, loading, error } = useQuery<GetHomeUptimeResponse>(GET_HOME_UPTIME, {
    variables: { homeId, days: 30 },
    pollInterval: 60_000,
    fetchPolicy: 'cache-and-network',
  });

  if (loading && !data) {
    return (
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reliability</p>
        <div className="rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">Loading…</div>
      </div>
    );
  }
  if (error || !data?.homeUptime) {
    return null;
  }

  const s = data.homeUptime;
  const badge = statusBadge(s.currentStatus);
  const lastProbe = s.lastProbe;

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reliability</p>
      <div className="rounded-lg border bg-muted/30 p-3 space-y-3 text-xs">
        {/* Live status */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-start gap-2">
            <span className={`flex items-center gap-1.5 font-medium px-1.5 py-0.5 rounded-full ${badge.classes}`}>
              {badge.icon}
              {badge.label}
            </span>
          </div>
        </div>
        <p className="text-muted-foreground text-[11px] leading-snug">{badge.tooltip}</p>

        {/* Last probe detail */}
        {lastProbe && (
          <div className="rounded border bg-background/60 p-2 text-[11px]">
            {lastProbe.status === 'verified' ? (
              <span>
                <span className="font-medium">Verified</span> — live accessory read
                {' '}<span className="text-muted-foreground">{formatRelativeAgo(lastProbe.probedAt)}</span>
              </span>
            ) : lastProbe.reason ? (
              <span className="text-muted-foreground">
                Last probe {formatRelativeAgo(lastProbe.probedAt)}: {lastProbe.reason}
              </span>
            ) : (
              <span className="text-muted-foreground">Last probe {formatRelativeAgo(lastProbe.probedAt)}</span>
            )}
          </div>
        )}

        {/* KPI tiles */}
        <div className="grid grid-cols-3 gap-2">
          {([
            { label: '24h', value: s.uptimePercent24h },
            { label: '7d', value: s.uptimePercent7d },
            { label: '30d', value: s.uptimePercent30d },
          ] as const).map((kpi) => (
            <div key={kpi.label} className="rounded border bg-background/60 p-2">
              <div className="text-[10px] text-muted-foreground">{kpi.label}</div>
              <div className={`text-base font-semibold ${percentColor(kpi.value)}`}>{formatPercent(kpi.value)}</div>
            </div>
          ))}
        </div>
        {s.uptimePercent7d > 0 && (
          <p className="text-[10px] text-muted-foreground">
            7-day uptime: {s.verifiedRatio7d.toFixed(0)}% fully verified, {(100 - s.verifiedRatio7d).toFixed(0)}% connected-only
            {s.avgLatencyMs !== null ? `, avg latency ${s.avgLatencyMs}ms` : ''}
          </p>
        )}

        {/* 7-day timeline */}
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>7 days ago</span>
            <span>Now</span>
          </div>
          <TimelineStrip buckets={s.timeline} />
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-0.5">
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-500" /> Verified</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-300 dark:bg-green-700" /> Connected only</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-orange-500" /> Degraded</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" /> Offline</span>
          </div>
        </div>

        {/* Recent outages */}
        {s.outages.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent outages</div>
            {s.outages.slice(0, 5).map((o, idx) => {
              const ongoing = !o.endedAt;
              return (
                <div key={`${o.startedAt}-${idx}`} className="flex items-center justify-between rounded border bg-background/60 px-2 py-1">
                  <span className={o.severity === 'offline' ? 'text-red-600' : 'text-orange-600'}>
                    {ongoing
                      ? `Currently ${o.severity === 'offline' ? 'offline' : 'degraded'} since ${formatRelativeAgo(o.startedAt)}`
                      : `${o.severity === 'offline' ? 'Offline' : 'Degraded'} ${formatRelativeAgo(o.startedAt)}`}
                  </span>
                  <span className="text-muted-foreground">
                    {ongoing ? `${formatDuration(o.durationSeconds)} so far` : formatDuration(o.durationSeconds)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
