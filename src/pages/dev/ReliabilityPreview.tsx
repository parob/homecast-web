/**
 * Dev-only preview of the Reliability section, fed a week shaped like the one
 * that prompted it: a relay outage of fourteen hours, a power cut at the house
 * of two and a half hours, and a short stretch of the home not responding.
 *
 * Mounted at /dev/reliability by App.tsx in development builds only, so the
 * hover links between the strip and the outage list can be looked at without
 * signing in, and without waiting for a real outage.
 */
import { useState } from 'react';
import { UptimeSectionView, type UptimeBucket, type UptimeOutage, type UptimeSummary } from '@/components/settings/UptimeSection';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { ConnectionSection } from '@/components/layout/status/ConnectionSection';
import { ReliabilitySectionView } from '@/components/layout/status/ReliabilitySection';
import { buildChain } from '@/lib/connection-chain';
import { statusPresentation } from '@/lib/status-badge';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

interface Span {
  start: number;
  end: number;
  severity: UptimeOutage['severity'];
}

/** How much of [hourStart, hourStart + 1h) the span covers, in minutes. */
function overlapMinutes(span: Span, hourStart: number): number {
  const s = Math.max(span.start, hourStart);
  const e = Math.min(span.end, hourStart + HOUR);
  return e > s ? Math.round((e - s) / MIN) : 0;
}

/** A week of hourly buckets, as the sampler would have written them: a ping a
 *  minute and a probe every five while connected, and the given spans of
 *  relay-offline or home-not-responding minutes carved out of that. */
function buildWeek(now: number, spans: Span[], cachedOnlyHours: number[] = []): UptimeBucket[] {
  const firstHour = Math.floor((now - 7 * 24 * HOUR) / HOUR) * HOUR;
  const buckets: UptimeBucket[] = [];
  for (let h = firstHour; h <= now; h += HOUR) {
    const minutesInHour = h + HOUR <= now ? 60 : Math.max(1, Math.round((now - h) / MIN));
    let offline = 0;
    let degraded = 0;
    for (const span of spans) {
      const m = overlapMinutes(span, h);
      if (span.severity === 'offline') offline += m;
      else degraded += m;
    }
    offline = Math.min(offline, minutesInHour);
    degraded = Math.min(degraded, minutesInHour - offline);
    const upMinutes = minutesInHour - offline - degraded;
    // 12 probes an hour while up; verified unless this was a cached-only hour.
    const probes = Math.round((upMinutes / 60) * 12);
    const verified = cachedOnlyHours.includes(h) ? 0 : probes;
    const connected = upMinutes + (probes - verified);
    buckets.push({
      bucketStart: new Date(h).toISOString(),
      verified,
      connected,
      degraded,
      offline,
      total: verified + connected + degraded + offline,
    });
  }
  return buckets;
}

function outage(span: Span): UptimeOutage {
  return {
    startedAt: new Date(span.start).toISOString(),
    endedAt: span.end === Infinity ? null : new Date(span.end).toISOString(),
    durationSeconds: Math.round(((span.end === Infinity ? Date.now() : span.end) - span.start) / 1000),
    severity: span.severity,
  };
}

function healthyWeek(now: number): UptimeSummary {
  const relayOut: Span = { start: now - 52 * HOUR - 10 * MIN, end: now - 52 * HOUR - 10 * MIN + (14 * HOUR + 12 * MIN), severity: 'offline' };
  const powerCut: Span = { start: now - 76 * HOUR + 46 * MIN, end: now - 76 * HOUR + 46 * MIN + (2 * HOUR + 30 * MIN), severity: 'degraded' };
  const blip: Span = { start: now - 20 * HOUR + 3 * MIN, end: now - 20 * HOUR + 16 * MIN, severity: 'degraded' };
  const spans = [relayOut, powerCut, blip];
  const cachedOnly = [1, 2, 3].map((k) => Math.floor((powerCut.start - k * HOUR) / HOUR) * HOUR);
  return {
    currentStatus: 'verified',
    uptimePercent24h: 99.2,
    uptimePercent7d: 93.7,
    uptimePercent30d: 95.8,
    verifiedRatio7d: 54.2,
    avgLatencyMs: 398,
    statusSince: null,
    lastProbe: {
      probedAt: new Date(now - 3 * MIN).toISOString(),
      status: 'verified',
      accessoryName: 'Bedroom 1 Spot 1',
      characteristicType: 'power_state',
      value: 'true',
      reason: null,
    },
    timeline: buildWeek(now, spans, cachedOnly),
    outages: [outage(blip), outage(relayOut), outage(powerCut)],
  };
}

function offlineNow(now: number): UptimeSummary {
  const ongoing: Span = { start: now - 3 * HOUR - 7 * MIN, end: Infinity, severity: 'offline' };
  const earlier: Span = { start: now - 5 * 24 * HOUR, end: now - 5 * 24 * HOUR + 10 * MIN, severity: 'offline' };
  const spans = [{ ...ongoing, end: now }, earlier];
  return {
    currentStatus: 'offline',
    uptimePercent24h: 87.1,
    uptimePercent7d: 98.0,
    uptimePercent30d: 97.4,
    verifiedRatio7d: 96.0,
    avgLatencyMs: 361,
    statusSince: new Date(ongoing.start).toISOString(),
    lastProbe: {
      probedAt: new Date(ongoing.start - 2 * MIN).toISOString(),
      status: 'verified',
      accessoryName: 'Kitchen',
      characteristicType: 'brightness',
      value: '70',
      reason: null,
    },
    timeline: buildWeek(now, spans),
    outages: [outage(ongoing), outage(earlier)],
  };
}

/** The status popover's content, at its real width, around the new section. */
function PopoverMock({ summary }: { summary: UptimeSummary }) {
  const quality = 'good' as const;
  const localMode = { active: false, unmapped: false };
  const chain = buildChain({
    quality, reconnected: false, relayStatus: null, localMode,
    managed: true, selfRelay: false, community: false, rtt: '34ms', homeName: 'George Street',
  });
  const p = statusPresentation({ quality, reconnected: false, localMode, relayStatus: null });
  return (
    <div className="w-[280px] rounded-xl border bg-popover p-3 text-popover-foreground shadow-md">
      <div className="space-y-3">
        <ConnectionSection quality={quality} headline={p.headline} onReconnect={() => {}} chain={chain} chainVariant="rail" />
        <div className="border-t" />
        <ReliabilitySectionView summary={summary} homeName="George Street" onOpenDetails={() => {}} />
      </div>
    </div>
  );
}

export default function ReliabilityPreview() {
  const now = Date.now();
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div className="min-h-screen bg-background text-foreground p-6">
      <div className="mx-auto max-w-[440px] space-y-10">
        <div>
          <h1 className="text-sm font-semibold">Reliability section, preview</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Development only. A week shaped like the real one: a fourteen-hour relay outage, a two-and-a-half-hour power cut at the house, a short blip, and three cached-only hours before the cut. Hover the strip, and hover the outages.
          </p>
        </div>
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">The connection popover, from the green dot</h2>
          <div className="flex flex-wrap gap-6">
            <PopoverMock summary={healthyWeek(now)} />
            <PopoverMock summary={offlineNow(now)} />
          </div>
        </section>
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">A healthy home today</h2>
          <UptimeSectionView summary={healthyWeek(now)} />
        </section>
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">While the relay is offline</h2>
          <UptimeSectionView summary={offlineNow(now)} />
        </section>
        {/* The real section sits inside the settings dialog, which stacks
            above the dashboard's tooltip layer; a hover that is fine on this
            page can be hidden in there. So one copy can be opened in a dialog. */}
        <section className="space-y-2">
          <h2 className="text-xs font-medium text-muted-foreground">Inside the settings dialog</h2>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded-md border px-3 py-1.5 text-xs hover:bg-muted"
          >
            Open the section in a dialog
          </button>
        </section>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent className="max-w-[460px]">
            <DialogTitle className="text-sm">Inside the settings dialog</DialogTitle>
            <UptimeSectionView summary={healthyWeek(now)} />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
