/**
 * Dev-only preview of the whole status popover, at the viewport it was
 * reported from.
 *
 * homecast-cloud#103 said the panel is "far too long" and shipped a screenshot
 * that ran off the bottom of an iPhone mid-sentence. There was no way to see
 * that without a cloud account, an offline relay and a phone, so the length was
 * never anyone's to look at — every section that made it long was merged
 * separately and is defensible alone.
 *
 * This mounts the real sections, in the real 280px bubble, in the state from
 * that report: cloud-managed account, relay offline, Local Mode active and
 * serving, 728 of 751 accessories matched. Mounted at /dev/status-panel in
 * development builds only.
 *
 * The frame is 440×956 — an iPhone 16 Pro Max in CSS pixels, the viewport the
 * report carried — so what runs past its bottom edge here is what ran past it
 * on the phone.
 */
import { ConnectionSection } from '@/components/layout/status/ConnectionSection';
import { ReliabilitySectionView } from '@/components/layout/status/ReliabilitySection';
import { LocalModeSectionView } from '@/components/layout/status/LocalModeSection';
import { buildChain } from '@/lib/connection-chain';
import { statusPresentation } from '@/lib/status-badge';
import type { UptimeBucket, UptimeOutage, UptimeSummary } from '@/components/settings/UptimeSection';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

/** A week of buckets with the last 1h11m offline, as the report had it. */
function week(now: number, outageStart: number): UptimeBucket[] {
  const firstHour = Math.floor((now - 7 * 24 * HOUR) / HOUR) * HOUR;
  const buckets: UptimeBucket[] = [];
  for (let h = firstHour; h <= now; h += HOUR) {
    const minutes = h + HOUR <= now ? 60 : Math.max(1, Math.round((now - h) / MIN));
    const offline = Math.min(
      minutes,
      Math.round(Math.max(0, Math.min(h + HOUR, now) - Math.max(h, outageStart)) / MIN),
    );
    const up = minutes - offline;
    const verified = Math.round((up / 60) * 12);
    buckets.push({
      bucketStart: new Date(h).toISOString(),
      verified,
      connected: up,
      degraded: 0,
      offline,
      total: verified + up + offline,
    });
  }
  return buckets;
}

function offlineNow(now: number): UptimeSummary {
  const start = now - (1 * HOUR + 11 * MIN);
  const ongoing: UptimeOutage = {
    startedAt: new Date(start).toISOString(),
    endedAt: null,
    durationSeconds: Math.round((now - start) / 1000),
    severity: 'offline',
  };
  return {
    currentStatus: 'offline',
    uptimePercent24h: 95.1,
    uptimePercent7d: 99.3,
    uptimePercent30d: 99.1,
    verifiedRatio7d: 94.0,
    avgLatencyMs: 480,
    statusSince: ongoing.startedAt,
    lastProbe: {
      probedAt: new Date(start - 2 * MIN).toISOString(),
      status: 'verified',
      accessoryName: 'Kitchen',
      characteristicType: 'brightness',
      value: '70',
      reason: null,
    },
    timeline: week(now, start),
    outages: [ongoing],
  };
}

/** The popover content, at its real width, in the reported state. */
function StatusPanel({ summary }: { summary: UptimeSummary }) {
  const quality = 'good' as const;
  const localMode = { active: true, unmapped: false };
  const chain = buildChain({
    quality,
    reconnected: false,
    relayStatus: false,
    localMode,
    managed: true,
    selfRelay: false,
    community: false,
    rtt: '480ms',
    homeName: 'County Hall',
    homeUnreachable: true,
  });
  const p = statusPresentation({ quality, reconnected: false, localMode, relayStatus: false });
  return (
    <div
      data-testid="status-panel"
      className="w-[280px] rounded-xl border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <div className="space-y-3">
        <ConnectionSection
          quality={quality}
          headline={p.headline}
          onReconnect={() => {}}
          chain={chain}
          chainVariant="rail"
        />
        <div className="border-t" />
        <ReliabilitySectionView summary={summary} homeName="County Hall" onOpenDetails={() => {}} />
        <div className="border-t" />
        <LocalModeSectionView
          reason="relay-offline"
          identityState="partial"
          matched={728}
          reported={751}
          isPhone
          onOpenSettings={() => {}}
        />
      </div>
    </div>
  );
}

export default function StatusPanelPreview() {
  const now = Date.now();
  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="space-y-4">
        <div className="max-w-[440px]">
          <h1 className="text-sm font-semibold">Status popover, at the reported viewport</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Development only. The state from homecast-cloud#103: cloud account, relay
            offline for 1h11m, Local Mode active, 728 of 751 accessories matched. The
            outlined frame is 440×956 — the phone the report came from. Anything past
            its bottom edge is off the screen.
          </p>
        </div>
        {/* The frame is the measurement: the panel is positioned where the
            header pill puts it, 205px down, as in the report's screenshot. */}
        <div
          data-testid="phone-frame"
          className="relative w-[440px] h-[956px] shrink-0 overflow-hidden rounded-[2rem] border-2 border-dashed border-muted-foreground/40"
        >
          <div className="absolute right-3 top-[205px]">
            <StatusPanel summary={offlineNow(now)} />
          </div>
        </div>
      </div>
    </div>
  );
}
