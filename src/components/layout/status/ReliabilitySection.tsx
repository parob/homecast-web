/**
 * A home's reliability, in the connection popover.
 *
 * The dot in the header answers "is this device connected", and the popover
 * behind it explains the path to the home. This section adds what that path
 * has been like: the home's live status, how reachable it was today and this
 * week, the 7-day strip in miniature, and the most recent outage. The full
 * story — the hourly breakdown, every outage, what each check found — is in
 * Settings → Homes → the home → Reliability, which the footer link opens.
 *
 * Reads the same query as that page, with the same variables, so opening the
 * popover after the page (or the other way round) costs nothing.
 */
import { useQuery } from '@apollo/client/react';
import { ChevronRight } from 'lucide-react';
import { GET_HOME_UPTIME } from '@/lib/graphql/queries';
import { formatRelativeAgo } from '@/lib/relay-last-seen';
import { describeStatus } from '@/lib/uptime-copy';
import {
  CompactTimelineStrip,
  formatDuration,
  type UptimeOutage,
  type UptimeSummary,
} from '@/components/settings/UptimeSection';

const DOT: Record<string, string> = {
  verified: 'bg-green-500',
  connected: 'bg-yellow-500',
  degraded: 'bg-orange-500',
  offline: 'bg-red-500',
};

const OUTAGE_LABEL: Record<UptimeOutage['severity'], string> = {
  offline: 'Relay offline',
  degraded: 'Home not responding',
};

function pct(v: number): string {
  if (v >= 99.95) return '100%';
  return `${v.toFixed(v >= 10 ? 0 : 1)}%`;
}

/**
 * The line under the strip: the most recent outage that is *not* the one the
 * header row is already reporting. While the home is offline the header says
 * so with how long; repeating it here as "Relay offline now, 1h 11m so far"
 * was one of the three tellings homecast-cloud#103 counted. The previous
 * outage, if the week holds one, is the useful thing to add instead.
 */
function lastOutageLine(outages: UptimeOutage[]): string {
  const ended = outages.find((o) => !!o.endedAt) ?? null;
  const ongoing = outages.some((o) => !o.endedAt);
  if (!ended) return ongoing ? 'No other outages in the last 7 days.' : 'No outages in the last 7 days.';
  return `${OUTAGE_LABEL[ended.severity]} ${formatRelativeAgo(ended.startedAt)}, ${formatDuration(ended.durationSeconds)}.`;
}

/** "offline for 1h 11m" — the ongoing outage's duration, else since the status began. */
function offlineFor(s: UptimeSummary): string {
  const ongoing = s.outages.find((o) => !o.endedAt);
  if (ongoing) return `offline for ${formatDuration(ongoing.durationSeconds)}`;
  return s.statusSince ? `went offline ${formatRelativeAgo(s.statusSince)}` : 'offline';
}

interface ReliabilitySectionViewProps {
  summary: UptimeSummary;
  homeName: string | null;
  /** Opens Settings → the home → Reliability. Absent hides the link. */
  onOpenDetails?: () => void;
}

export function ReliabilitySectionView({ summary: s, homeName, onOpenDetails }: ReliabilitySectionViewProps) {
  const status = describeStatus(s.currentStatus);
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-muted-foreground truncate">
          Reliability{homeName ? ` · ${homeName}` : ''}
        </span>
        {onOpenDetails && (
          <button
            type="button"
            onClick={onOpenDetails}
            className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground shrink-0"
          >
            Details <ChevronRight className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span className={`h-2 w-2 rounded-full shrink-0 ${DOT[s.currentStatus] ?? 'bg-muted-foreground'}`} />
          {status.label}
        </span>
        {s.currentStatus === 'offline' ? (
          <span className="text-muted-foreground">{offlineFor(s)}</span>
        ) : (
          <span className="text-muted-foreground tabular-nums">
            {pct(s.uptimePercent24h)} today · {pct(s.uptimePercent7d)} this week
          </span>
        )}
      </div>
      <CompactTimelineStrip buckets={s.timeline} />
      <p className="text-[11px] text-muted-foreground leading-snug">{lastOutageLine(s.outages)}</p>
    </div>
  );
}

interface ReliabilitySectionProps {
  homeId: string;
  homeName: string | null;
  onOpenDetails?: () => void;
}

export function ReliabilitySection({ homeId, homeName, onOpenDetails }: ReliabilitySectionProps) {
  // Mounted only while the popover is open, so there is no polling to stop.
  const { data } = useQuery<{ homeUptime: UptimeSummary }>(GET_HOME_UPTIME, {
    variables: { homeId, days: 30 },
    fetchPolicy: 'cache-and-network',
  });
  const s = data?.homeUptime;
  if (!s) {
    return (
      <div className="text-[11px] text-muted-foreground">
        Reliability{homeName ? ` · ${homeName}` : ''}: checking…
      </div>
    );
  }
  return <ReliabilitySectionView summary={s} homeName={homeName} onOpenDetails={onOpenDetails} />;
}
