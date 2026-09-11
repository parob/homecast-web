import { useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { GET_HOME_UPTIME } from '@/lib/graphql/queries';
import { ShieldCheck, ShieldAlert, WifiOff, AlertTriangle, HelpCircle, X } from 'lucide-react';
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

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) {
    const h = Math.floor(seconds / 3600);
    const m = Math.round((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(seconds / 86400)}d`;
}

// The badge is the status, and only the status. `describeStatus` also carries
// an `explanation` for each one — a paragraph of prose the section used to
// print under the badge; homecast-cloud#115 took the prose off this screen, so
// it is read no longer. The copy itself is left in `uptime-copy.ts`, with its
// tests, because the popover may yet want it.
function statusBadge(status: string): { label: string; icon: JSX.Element; classes: string } {
  const { label } = describeStatus(status);
  switch (status) {
    case 'verified':
      return { label, icon: <ShieldCheck className="h-3.5 w-3.5" />, classes: 'bg-green-500/10 text-green-700 dark:text-green-400' };
    case 'connected':
      return { label, icon: <ShieldAlert className="h-3.5 w-3.5" />, classes: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400' };
    case 'degraded':
      return { label, icon: <AlertTriangle className="h-3.5 w-3.5" />, classes: 'bg-orange-500/10 text-orange-700 dark:text-orange-400' };
    case 'offline':
      return { label, icon: <WifiOff className="h-3.5 w-3.5" />, classes: 'bg-red-500/10 text-red-700 dark:text-red-400' };
    default:
      return { label, icon: <HelpCircle className="h-3.5 w-3.5" />, classes: 'bg-muted text-muted-foreground' };
  }
}

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 7 * 24;

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

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/** An outage is the relay's or the home's, and each means something different
 *  for what the owner should do about it. */
const OUTAGE_LABEL: Record<UptimeOutage['severity'], string> = {
  offline: 'Relay offline',
  degraded: 'Home not responding',
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

/** True if the outage overlaps any hour of the run — the day-group form of
 *  `outageTouchesHour`, which the selected-day panel and the row highlight
 *  both need. */
function outageTouchesHours(o: UptimeOutage, hours: number[]): boolean {
  if (hours.length === 0) return false;
  const [start, end] = outageSpan(o);
  return start < hours[hours.length - 1] + HOUR_MS && end > hours[0];
}

/** An outage's clock window, read against the day the reader is looking at:
 *  bare times while it stays inside one day, day and time once it crosses one.
 *  "07:18 PM → 09:30 AM" on its own does not say that fourteen hours passed. */
function outageClock(o: UptimeOutage, refTs: number): string {
  const [start, end] = outageSpan(o);
  const startText = sameDay(start, refTs) ? fmtHour(new Date(start)) : fmtDayTime(new Date(start));
  const endText = !o.endedAt ? 'now' : sameDay(end, start) ? fmtHour(new Date(end)) : fmtDayTime(new Date(end));
  return `${startText} → ${endText}`;
}

interface HourLine {
  swatch?: string;
  text: string;
}

/** "about 45 min" / "about 3h 20m" — a span said the way the reader asks it. */
function approxSpan(minutes: number): string {
  if (minutes < 60) return `about ${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `about ${h}h ${m}m` : `about ${h}h`;
}

interface WindowStats {
  verified: number;
  reachable: number;
  degraded: number;
  offline: number;
  reachableMin: number;
  degradedMin: number;
  offlineMin: number;
  /** At least one hour of the run recorded something. */
  sampled: boolean;
}

/** Minutes of each state over a run of hours. Each hour is converted on its
 *  own before being added up: the buckets do not all carry the same number of
 *  samples, so pooling them first would weight a busy hour above a quiet one. */
export function windowStats(byHour: Map<number, UptimeBucket>, hours: number[]): WindowStats {
  const s: WindowStats = {
    verified: 0, reachable: 0, degraded: 0, offline: 0,
    reachableMin: 0, degradedMin: 0, offlineMin: 0, sampled: false,
  };
  for (const ts of hours) {
    const b = byHour.get(ts);
    if (!b || b.total === 0) continue;
    s.sampled = true;
    s.verified += b.verified;
    s.reachable += b.verified + b.connected;
    s.degraded += b.degraded;
    s.offline += b.offline;
    s.reachableMin += ((b.verified + b.connected) / b.total) * 60;
    s.degradedMin += (b.degraded / b.total) * 60;
    s.offlineMin += (b.offline / b.total) * 60;
  }
  return s;
}

/** The split of a window, as lines. A state that was sampled at all gets a
 *  line, floored at one minute — "about 0 min" is not an answer. */
function stateLines(s: WindowStats): HourLine[] {
  const lines: HourLine[] = [];
  const mins = (raw: number) => Math.max(1, Math.round(raw));
  if (s.reachable > 0) lines.push({ swatch: 'bg-green-500', text: `Reachable ${approxSpan(mins(s.reachableMin))}` });
  if (s.degraded > 0) lines.push({ swatch: 'bg-orange-500', text: `Home not responding ${approxSpan(mins(s.degradedMin))}` });
  if (s.offline > 0) lines.push({ swatch: 'bg-red-500', text: `Relay offline ${approxSpan(mins(s.offlineMin))}` });
  lines.push({ text: s.verified > 0 ? `${s.verified} verified read${s.verified === 1 ? '' : 's'}` : 'No verified reads' });
  return lines;
}

/** What the hover on one hour of the strip says: the split of the hour, the
 *  verified reads in it, and any outage that overlapped it with its real
 *  start and end, not just this hour's slice. */
function describeHour(
  byHour: Map<number, UptimeBucket>,
  hourStart: number,
  outages: UptimeOutage[],
): { title: string; lines: HourLine[] } {
  const title = `${fmtDay(new Date(hourStart))}, ${fmtHour(new Date(hourStart))}–${fmtHour(new Date(hourStart + HOUR_MS))}`;
  const s = windowStats(byHour, [hourStart]);
  if (!s.sampled) return { title, lines: [{ text: 'Nothing recorded for this hour.' }] };
  const lines = stateLines(s);
  for (const o of outages) {
    if (!outageTouchesHour(o, hourStart)) continue;
    lines.push({
      swatch: OUTAGE_SWATCH[o.severity],
      text: `${OUTAGE_LABEL[o.severity]} ${outageClock(o, hourStart)}, ${formatDuration(o.durationSeconds)}`,
    });
  }
  return { title, lines };
}

/** The same reading for a whole day of the strip. This is the one a finger can
 *  actually ask for: at the width this section gets on a phone an hour is under
 *  two pixels wide, so an hour-sized target is not a target. */
export function describeDay(
  byHour: Map<number, UptimeBucket>,
  hours: number[],
  outages: UptimeOutage[],
): { title: string; lines: HourLine[] } {
  const title = fmtDay(new Date(hours[0]));
  const s = windowStats(byHour, hours);
  const lines: HourLine[] = s.sampled ? stateLines(s) : [{ text: 'Nothing recorded for this day.' }];
  for (const o of outages) {
    if (!outageTouchesHours(o, hours)) continue;
    lines.push({
      swatch: OUTAGE_SWATCH[o.severity],
      text: `${OUTAGE_LABEL[o.severity]} ${outageClock(o, hours[0])}, ${formatDuration(o.durationSeconds)}`,
    });
  }
  // The oldest and newest days of the window are partial, and a day that reads
  // "Reachable about 9h" without saying so looks like nine hours of outage.
  if (hours.length < 24) {
    lines.push({ text: `Only ${hours.length}h of this day is inside the 7-day window.` });
  }
  return { title, lines };
}

export interface DayGroup {
  /** Local midnight of the day, and the key selection is held by. */
  dayStart: number;
  /** The hours of that day that fall inside the 7-day window. */
  hours: number[];
}

/** The window's 168 hours, cut at local midnight. The window is hour-aligned
 *  rather than day-aligned, so the first and last groups are part-days and the
 *  groups are unequal — which is exactly why each one carries its own hours
 *  rather than a count the caller has to trust. */
export function buildDayGroups(now: number): DayGroup[] {
  const start = new Date(now - WINDOW_HOURS * HOUR_MS);
  start.setMinutes(0, 0, 0);
  const groups: DayGroup[] = [];
  for (let i = 0; i < WINDOW_HOURS; i++) {
    const ts = start.getTime() + i * HOUR_MS;
    const midnight = new Date(ts);
    midnight.setHours(0, 0, 0, 0);
    const key = midnight.getTime();
    const last = groups[groups.length - 1];
    if (last && last.dayStart === key) last.hours.push(ts);
    else groups.push({ dayStart: key, hours: [ts] });
  }
  return groups;
}

function bucketsByHour(buckets: UptimeBucket[]): Map<number, UptimeBucket> {
  const byHour = new Map<number, UptimeBucket>();
  for (const b of buckets) {
    const t = new Date(b.bucketStart).getTime();
    byHour.set(t - (t % HOUR_MS), b);
  }
  return byHour;
}

/** The strip at popover size: the same 168 hours and colours, eight pixels
 *  tall, no hover. A glance, not a reading; the reading is on the settings page. */
export function CompactTimelineStrip({ buckets }: { buckets: UptimeBucket[] }) {
  const startHour = new Date(Date.now() - WINDOW_HOURS * HOUR_MS);
  startHour.setMinutes(0, 0, 0);
  const byHour = bucketsByHour(buckets);
  const cells: JSX.Element[] = [];
  for (let i = 0; i < WINDOW_HOURS; i++) {
    const b = byHour.get(startHour.getTime() + i * HOUR_MS);
    const total = b?.total ?? 0;
    if (!b || total === 0) {
      cells.push(<div key={i} className="flex-1 h-2 rounded-[1px] bg-muted/40" />);
      continue;
    }
    // One colour per hour, the worst thing that happened in it — at eight
    // pixels a stacked column is noise.
    const worst = b.offline > 0 ? 'bg-red-500' : b.degraded > 0 ? 'bg-orange-500' : b.verified > 0 ? 'bg-green-500' : 'bg-green-300 dark:bg-green-700';
    cells.push(<div key={i} className={`flex-1 h-2 rounded-[1px] ${worst}`} />);
  }
  return <div className="flex gap-px w-full">{cells}</div>;
}

interface TimelineStripProps {
  byHour: Map<number, UptimeBucket>;
  days: DayGroup[];
  outages: UptimeOutage[];
  /** The day whose detail panel is open, drawn with a frame around it. */
  selectedDay: number | null;
  onSelectDay: (dayStart: number | null) => void;
}

function TimelineStrip({ byHour, days, outages, selectedDay, onSelectDay }: TimelineStripProps) {
  const hourCell = (hourTs: number) => {
    const b = byHour.get(hourTs);
    const total = b?.total ?? 0;
    const { title, lines } = describeHour(byHour, hourTs, outages);
    const frame = 'flex-1 h-6 rounded-sm';
    let bar: JSX.Element;
    if (!b || total === 0) {
      bar = <div className={`${frame} bg-muted/40`} />;
    } else {
      const v = (b.verified / total) * 100;
      const c = (b.connected / total) * 100;
      const d = (b.degraded / total) * 100;
      const o = (b.offline / total) * 100;
      bar = (
        <div className={`${frame} overflow-hidden flex flex-col`}>
          {v > 0 && <div className="bg-green-500" style={{ height: `${v}%` }} />}
          {c > 0 && <div className="bg-green-300 dark:bg-green-700" style={{ height: `${c}%` }} />}
          {d > 0 && <div className="bg-orange-500" style={{ height: `${d}%` }} />}
          {o > 0 && <div className="bg-red-500" style={{ height: `${o}%` }} />}
        </div>
      );
    }
    return (
      <Tooltip key={hourTs}>
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
      </Tooltip>
    );
  };

  // The tap target is the day, not the hour. Each group grows in proportion to
  // the hours it holds, so the part-days at either end of the window stay in
  // scale with the full ones between them.
  return (
    <div className="flex gap-[3px] w-full">
      {days.map((day) => {
        const open = selectedDay === day.dayStart;
        return (
          <div
            key={day.dayStart}
            role="button"
            tabIndex={0}
            aria-pressed={open}
            aria-label={`${fmtDay(new Date(day.dayStart))} — reliability detail`}
            // cursor-pointer is load-bearing on iOS Safari, which only
            // dispatches a click from a tap to elements it considers
            // clickable. React delegates its listeners to the root, so the
            // handler alone does not make this one of them.
            className={`flex gap-[1px] cursor-pointer rounded-sm ${open ? 'ring-1 ring-foreground' : ''}`}
            style={{ flexGrow: day.hours.length, flexBasis: 0 }}
            onClick={() => onSelectDay(open ? null : day.dayStart)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectDay(open ? null : day.dayStart);
              }
            }}
          >
            {day.hours.map(hourCell)}
          </div>
        );
      })}
    </div>
  );
}

/** The section, given its data. The query wrapper below is what the settings
 *  page mounts; this is what the dev preview mounts with a fixture. */
export function UptimeSectionView({ summary: s }: { summary: UptimeSummary }) {
  const badge = statusBadge(s.currentStatus);
  const lastProbe = s.lastProbe;
  // A day of the strip opens its own panel, naming every outage that ran
  // through it. That is the only reading of an outage the section offers, and
  // it is deliberately a tap rather than a hover: a Radix tooltip never opens
  // from a tap, so a hover-only reading is no reading at all on a phone.
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const byHour = bucketsByHour(s.timeline);
  const days = buildDayGroups(Date.now());
  const openDay = selectedDay === null ? null : days.find((d) => d.dayStart === selectedDay) ?? null;
  const dayDetail = openDay ? describeDay(byHour, openDay.hours, s.outages) : null;

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
            <TimelineStrip
              byHour={byHour}
              days={days}
              outages={s.outages}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
            {/* The reading a finger can ask for. It says which day it is
                describing, because the strip has no axis labels — there is no
                room for seven of them at this width. */}
            {dayDetail && (
              <div className="rounded border bg-background/60 p-2 text-[11px] space-y-0.5">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium">{dayDetail.title}</span>
                  <button
                    type="button"
                    aria-label="Close day detail"
                    className="shrink-0 -mr-0.5 -mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted cursor-pointer"
                    onClick={() => setSelectedDay(null)}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {dayDetail.lines.map((line, j) => (
                  <div key={j} className="flex items-center gap-1.5 text-muted-foreground">
                    {line.swatch && <span className={`inline-block w-2 h-2 rounded-sm shrink-0 ${line.swatch}`} />}
                    <span>{line.text}</span>
                  </div>
                ))}
              </div>
            )}
            {/* Wrapping between the items, not through them. Without the wrap
                and the nowrap the four items were squeezed into one rigid row
                and each label broke inside itself — two ragged lines with the
                swatches no longer beside their words. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground pt-0.5">
              <span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-sm bg-green-500" /> Verified</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-sm bg-green-300 dark:bg-green-700" /> Connected only</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-sm bg-orange-500" /> Home not responding</span>
              <span className="inline-flex items-center gap-1 whitespace-nowrap"><span className="inline-block w-2 h-2 rounded-sm bg-red-500" /> Relay offline</span>
            </div>
          </div>
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
