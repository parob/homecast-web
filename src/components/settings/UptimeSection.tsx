import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_HOME_UPTIME } from '@/lib/graphql/queries';
import { ShieldCheck, ShieldAlert, WifiOff, AlertTriangle, HelpCircle } from 'lucide-react';
import { formatRelativeAgo } from '@/lib/relay-last-seen';
import { describeProbeReason, describeStatus } from '@/lib/uptime-copy';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export interface UptimeBucket {
  bucketStart: string;
  verified: number;
  connected: number;
  degraded: number;
  offline: number;
  total: number;
}

export interface UptimeOutage {
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
  severity: 'offline' | 'degraded';
}

export interface LastProbe {
  probedAt: string;
  status: string;
  accessoryName: string | null;
  characteristicType: string | null;
  value: string | null;
  reason: string | null;
}

export interface UptimeSummary {
  currentStatus: string;
  uptimePercent24h: number;
  uptimePercent7d: number;
  uptimePercent30d: number;
  verifiedRatio7d: number;
  avgLatencyMs: number | null;
  /** Offline only: when the relay was last seen, so the badge can say since when. */
  statusSince: string | null;
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
  const { label, explanation: tooltip } = describeStatus(status);
  switch (status) {
    case 'verified':
      return { label, tooltip, icon: <ShieldCheck className="h-3.5 w-3.5" />, classes: 'bg-green-500/10 text-green-700 dark:text-green-400' };
    case 'connected':
      return { label, tooltip, icon: <ShieldAlert className="h-3.5 w-3.5" />, classes: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' };
    case 'degraded':
      return { label, tooltip, icon: <AlertTriangle className="h-3.5 w-3.5" />, classes: 'bg-orange-500/10 text-orange-700 dark:text-orange-400' };
    case 'offline':
      return { label, tooltip, icon: <WifiOff className="h-3.5 w-3.5" />, classes: 'bg-red-500/10 text-red-700 dark:text-red-400' };
    default:
      return { label, tooltip, icon: <HelpCircle className="h-3.5 w-3.5" />, classes: 'bg-muted text-muted-foreground' };
  }
}

const HOUR_MS = 60 * 60 * 1000;

// This section lives inside the settings dialog, which sits at 10050 (see
// ui/dialog.tsx). The tooltip's default layer, 10005, is for the dashboard; in
// here it opened underneath the dialog. 10060 is where select and dropdown
// menus inside dialogs already sit.
const TOOLTIP_Z = 'z-[10060]';

function fmtHour(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function fmtDay(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function fmtDayTime(d: Date): string {
  return `${fmtDay(d)}, ${fmtHour(d)}`;
}

/** An outage is the relay's or the home's, and each means something different
 *  for what the owner should do about it. */
const OUTAGE_LABEL: Record<UptimeOutage['severity'], string> = {
  offline: 'Relay offline',
  degraded: 'Home not responding',
};
const OUTAGE_EXPLANATION: Record<UptimeOutage['severity'], string> = {
  offline: 'The relay lost its connection to the cloud. Every home on it was out of reach from outside, and nothing could be checked.',
  degraded: "The relay was connected, but this home's accessories did not answer its checks. The house, not the relay.",
};
const OUTAGE_SWATCH: Record<UptimeOutage['severity'], string> = {
  offline: 'bg-red-500',
  degraded: 'bg-orange-500',
};

/** The interval an outage covers, with an open one running to now. */
function outageSpan(o: UptimeOutage): [number, number] {
  const start = new Date(o.startedAt).getTime();
  const end = o.endedAt ? new Date(o.endedAt).getTime() : Date.now();
  return [start, end];
}

function outageTouchesHour(o: UptimeOutage, hourStart: number): boolean {
  const [start, end] = outageSpan(o);
  return start < hourStart + HOUR_MS && end > hourStart;
}

interface HourLine {
  swatch?: string;
  text: string;
}

/** What the hover on one hour of the strip says: the split of the hour, the
 *  verified reads in it, and any outage that overlapped it with its real
 *  start and end, not just this hour's slice. Sample counts are turned into
 *  minutes of the hour, which is what the reader is actually asking. */
function describeHour(
  b: UptimeBucket | undefined,
  hourStart: Date,
  outages: UptimeOutage[],
): { title: string; lines: HourLine[] } {
  const hourEnd = new Date(hourStart.getTime() + HOUR_MS);
  const title = `${fmtDay(hourStart)}, ${fmtHour(hourStart)}–${fmtHour(hourEnd)}`;
  const total = b?.total ?? 0;
  if (!b || total === 0) return { title, lines: [{ text: 'Nothing recorded for this hour.' }] };
  const minutes = (n: number) => Math.round((n / total) * 60);
  const lines: HourLine[] = [];
  const up = minutes(b.verified + b.connected);
  if (up > 0) lines.push({ swatch: 'bg-green-500', text: `Reachable about ${up} min` });
  if (b.degraded > 0) lines.push({ swatch: 'bg-orange-500', text: `Home not responding about ${minutes(b.degraded)} min` });
  if (b.offline > 0) lines.push({ swatch: 'bg-red-500', text: `Relay offline about ${minutes(b.offline)} min` });
  lines.push({ text: b.verified > 0 ? `${b.verified} verified read${b.verified === 1 ? '' : 's'}` : 'No verified reads' });
  for (const o of outages) {
    if (!outageTouchesHour(o, hourStart.getTime())) continue;
    const [start, end] = outageSpan(o);
    const endText = o.endedAt ? fmtHour(new Date(end)) : 'now';
    lines.push({
      swatch: OUTAGE_SWATCH[o.severity],
      text: `${OUTAGE_LABEL[o.severity]} ${fmtHour(new Date(start))} → ${endText}, ${formatDuration(o.durationSeconds)}`,
    });
  }
  return { title, lines };
}

interface TimelineStripProps {
  buckets: UptimeBucket[];
  outages: UptimeOutage[];
  /** The outage whose row is under the pointer: its hours light up, the rest fade. */
  highlight: UptimeOutage | null;
  onHoverHour: (hourStart: number | null) => void;
}

function TimelineStrip({ buckets, outages, highlight, onHoverHour }: TimelineStripProps) {
  // Render exactly 7 × 24 = 168 cells, filling missing hours with neutral grey.
  const now = new Date();
  const startHour = new Date(now.getTime() - 7 * 24 * HOUR_MS);
  startHour.setMinutes(0, 0, 0);

  const byHour = new Map<number, UptimeBucket>();
  for (const b of buckets) {
    const t = new Date(b.bucketStart).getTime();
    byHour.set(t - (t % HOUR_MS), b);
  }

  const cells: JSX.Element[] = [];
  for (let i = 0; i < 168; i++) {
    const hourTs = startHour.getTime() + i * HOUR_MS;
    const b = byHour.get(hourTs);
    const total = b?.total ?? 0;
    const { title, lines } = describeHour(b, new Date(hourTs), outages);
    const lit = highlight !== null && outageTouchesHour(highlight, hourTs);
    const dimmed = highlight !== null && !lit;
    const frame = `flex-1 h-6 rounded-sm transition-opacity ${dimmed ? 'opacity-30' : ''} ${lit ? 'ring-1 ring-foreground' : ''}`;
    const hover = {
      onMouseEnter: () => onHoverHour(hourTs),
      onMouseLeave: () => onHoverHour(null),
    };
    let bar: JSX.Element;
    if (!b || total === 0) {
      bar = <div className={`${frame} bg-muted/40`} {...hover} />;
    } else {
      const v = (b.verified / total) * 100;
      const c = (b.connected / total) * 100;
      const d = (b.degraded / total) * 100;
      const o = (b.offline / total) * 100;
      bar = (
        <div className={`${frame} overflow-hidden flex flex-col`} {...hover}>
          {v > 0 && <div className="bg-green-500" style={{ height: `${v}%` }} />}
          {c > 0 && <div className="bg-green-300 dark:bg-green-700" style={{ height: `${c}%` }} />}
          {d > 0 && <div className="bg-orange-500" style={{ height: `${d}%` }} />}
          {o > 0 && <div className="bg-red-500" style={{ height: `${o}%` }} />}
        </div>
      );
    }
    cells.push(
      <Tooltip key={i}>
        <TooltipTrigger asChild>{bar}</TooltipTrigger>
        <TooltipContent side="top" className={`${TOOLTIP_Z} max-w-[300px] text-xs`}>
          <div className="font-medium">{title}</div>
          {lines.map((line, j) => (
            <div key={j} className="flex items-center gap-1.5 opacity-80">
              {line.swatch && <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${line.swatch}`} />}
              <span>{line.text}</span>
            </div>
          ))}
        </TooltipContent>
      </Tooltip>,
    );
  }
  return <div className="flex gap-[1px] w-full">{cells}</div>;
}

interface OutageRowProps {
  outage: UptimeOutage;
  /** The pointer is on an hour of the strip this outage covers. */
  lit: boolean;
  onHover: (outage: UptimeOutage | null) => void;
}

function OutageRow({ outage: o, lit, onHover }: OutageRowProps) {
  const ongoing = !o.endedAt;
  const [start, end] = outageSpan(o);
  const label = OUTAGE_LABEL[o.severity];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={`flex items-center justify-between rounded border bg-background/60 px-2 py-1 cursor-default transition-colors ${lit ? 'ring-1 ring-foreground' : ''}`}
          onMouseEnter={() => onHover(o)}
          onMouseLeave={() => onHover(null)}
        >
          <span className={`inline-flex items-center gap-1.5 ${o.severity === 'offline' ? 'text-red-600' : 'text-orange-600'}`}>
            <span className={`inline-block w-2 h-2 rounded-sm ${OUTAGE_SWATCH[o.severity]}`} />
            {/* An offline outage is the relay's, and it shows on every home
                that relay serves; say so, or a power cut at one house reads
                as three houses going down. */}
            {ongoing ? `${label} since ${formatRelativeAgo(o.startedAt)}` : `${label} ${formatRelativeAgo(o.startedAt)}`}
          </span>
          <span className="text-muted-foreground">
            {ongoing ? `${formatDuration(o.durationSeconds)} so far` : formatDuration(o.durationSeconds)}
          </span>
        </div>
      </TooltipTrigger>
      {/* Below the row, not above it: above would sit on the strip, hiding
          the hours this row has just lit up. */}
      <TooltipContent side="bottom" align="start" className={`${TOOLTIP_Z} max-w-[300px] text-xs`}>
        <div className="font-medium">{label}</div>
        <div className="opacity-80">Started {fmtDayTime(new Date(start))}</div>
        <div className="opacity-80">{ongoing ? 'Still going' : `Ended ${fmtDayTime(new Date(end))}`}</div>
        <div className="opacity-80">Lasted {formatDuration(o.durationSeconds)}{ongoing ? ' so far' : ''}</div>
        <div className="opacity-80 mt-1">{OUTAGE_EXPLANATION[o.severity]}</div>
      </TooltipContent>
    </Tooltip>
  );
}

/** The section, given its data. The query wrapper below is what the settings
 *  page mounts; this is what the dev preview mounts with a fixture. */
export function UptimeSectionView({ summary: s }: { summary: UptimeSummary }) {
  const badge = statusBadge(s.currentStatus);
  const lastProbe = s.lastProbe;
  // Hover links the two views of the same week: an outage row lights the
  // hours it covers on the strip, and an hour on the strip lights the rows of
  // the outages that ran through it.
  const [hoverOutage, setHoverOutage] = useState<UptimeOutage | null>(null);
  const [hoverHour, setHoverHour] = useState<number | null>(null);

  return (
    <TooltipProvider delayDuration={80} skipDelayDuration={400}>
      <div className="space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Reliability</p>
        <div className="rounded-lg border bg-muted/30 p-3 space-y-3 text-xs">
          {/* Live status. The server answers this from the sessions table, so
              it agrees with the Connection block above it — and says since when. */}
          <div className="flex items-center justify-between gap-2">
            <span className={`flex items-center gap-1.5 font-medium px-1.5 py-0.5 rounded-full ${badge.classes}`}>
              {badge.icon}
              {badge.label}
            </span>
            {s.currentStatus === 'offline' && s.statusSince && (
              <span className="text-muted-foreground">went offline {formatRelativeAgo(s.statusSince)}</span>
            )}
          </div>
          <p className="text-muted-foreground text-[11px] leading-snug">{badge.tooltip}</p>

          {/* Last probe detail — not while offline, when the last check is
              older than the outage and says nothing the badge doesn't. */}
          {lastProbe && s.currentStatus !== 'offline' && (
            <div className="rounded border bg-background/60 p-2 text-[11px]">
              {lastProbe.status === 'verified' ? (
                <span>
                  <span className="font-medium">Verified</span> — live accessory read
                  {' '}<span className="text-muted-foreground">{formatRelativeAgo(lastProbe.probedAt)}</span>
                </span>
              ) : (
                <span className="text-muted-foreground">
                  Last check {formatRelativeAgo(lastProbe.probedAt)}: {describeProbeReason(lastProbe.reason)}
                </span>
              )}
            </div>
          )}

          {/* KPI tiles — the share of each window the relay was reachable. An
              hour offline is an hour, whether or not anything sampled it. */}
          <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground">Reachable</div>
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
            <p className="text-[10px] text-muted-foreground leading-snug">
              Reachable is your relay's connection to the cloud, so every home on the same relay shares it. Verified and Home not responding are this home's own checks.
            </p>
          </div>
          {s.uptimePercent7d > 0 && (
            <p className="text-[10px] text-muted-foreground">
              Verified {s.verifiedRatio7d.toFixed(0)}% of checks over 7 days
              {s.avgLatencyMs !== null ? `, average read ${s.avgLatencyMs} ms` : ''}
            </p>
          )}

          {/* 7-day timeline */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>7 days ago</span>
              <span>Now</span>
            </div>
            <TimelineStrip buckets={s.timeline} outages={s.outages} highlight={hoverOutage} onHoverHour={setHoverHour} />
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground pt-0.5">
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-500" /> Verified</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-green-300 dark:bg-green-700" /> Connected only</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-orange-500" /> Home not responding</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" /> Relay offline</span>
            </div>
          </div>

          {/* Recent outages */}
          {s.outages.length > 0 && (
            <div className="space-y-1.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Recent outages</div>
              {s.outages.slice(0, 5).map((o, idx) => (
                <OutageRow
                  key={`${o.startedAt}-${idx}`}
                  outage={o}
                  lit={hoverHour !== null && outageTouchesHour(o, hoverHour)}
                  onHover={setHoverOutage}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
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

  return <UptimeSectionView summary={data.homeUptime} />;
}
