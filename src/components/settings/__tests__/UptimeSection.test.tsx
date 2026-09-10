// @vitest-environment jsdom
//
// The Reliability section's two readings — an hour of the strip and one outage
// — used to live only in Radix tooltips, which never open from a tap. On a
// phone that made the strip and the outage list decorative: homecast-cloud#111.
//
// So what is pinned here is the touch route to both, and the fact that it is a
// route a mouse can take too: a day of the strip opens its own panel, an
// outage row opens its own detail, and each lights the other's half of the
// week. The legend's wrapping is pinned as classes, because jsdom has no
// layout — the measurement of it is in the pull request.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import {
  UptimeSectionView,
  buildDayGroups,
  describeDay,
  windowStats,
  type UptimeBucket,
  type UptimeOutage,
  type UptimeSummary,
} from '../UptimeSection';

const HOUR = 60 * 60 * 1000;
const MIN = 60 * 1000;

afterEach(cleanup);

/** One hour's worth of samples, split the way the sampler would have written it. */
function bucket(ts: number, over: Partial<UptimeBucket> = {}): UptimeBucket {
  const base = { verified: 12, connected: 60, degraded: 0, offline: 0, ...over };
  return {
    bucketStart: new Date(ts).toISOString(),
    ...base,
    total: base.verified + base.connected + base.degraded + base.offline,
  };
}

function summary(now: number): UptimeSummary {
  // A relay outage that ran from 20h ago to 18h ago, and nothing else.
  const outStart = now - 20 * HOUR;
  const outEnd = now - 18 * HOUR;
  const timeline: UptimeBucket[] = [];
  const first = Math.floor((now - 7 * 24 * HOUR) / HOUR) * HOUR;
  for (let ts = first; ts <= now; ts += HOUR) {
    const inOutage = ts >= outStart - HOUR && ts < outEnd;
    timeline.push(inOutage ? bucket(ts, { verified: 0, connected: 0, offline: 60 }) : bucket(ts));
  }
  const outage: UptimeOutage = {
    startedAt: new Date(outStart).toISOString(),
    endedAt: new Date(outEnd).toISOString(),
    durationSeconds: 2 * 3600,
    severity: 'offline',
  };
  return {
    currentStatus: 'verified',
    uptimePercent24h: 91.6,
    uptimePercent7d: 98.8,
    uptimePercent30d: 99.1,
    verifiedRatio7d: 71,
    avgLatencyMs: 372,
    statusSince: null,
    lastProbe: {
      probedAt: new Date(now - 2 * MIN).toISOString(),
      status: 'verified',
      accessoryName: 'Kitchen',
      characteristicType: 'power_state',
      value: 'true',
      reason: null,
    },
    timeline,
    outages: [outage],
  };
}

describe('buildDayGroups', () => {
  it('covers the whole 168-hour window exactly once', () => {
    const groups = buildDayGroups(Date.now());
    const all = groups.flatMap((g) => g.hours);
    expect(all).toHaveLength(168);
    expect(new Set(all).size).toBe(168);
    // Hour-aligned, ascending, no gaps.
    for (let i = 1; i < all.length; i++) expect(all[i] - all[i - 1]).toBe(HOUR);
  });

  it('cuts at local midnight, so the two end days are partial', () => {
    const groups = buildDayGroups(Date.now());
    // 168 hours that do not start at midnight span eight calendar days; only
    // when the window happens to start exactly at midnight is it seven.
    expect(groups.length).toBeGreaterThanOrEqual(7);
    expect(groups.length).toBeLessThanOrEqual(8);
    for (const g of groups) {
      const midnight = new Date(g.hours[0]);
      expect(g.dayStart).toBe(new Date(midnight).setHours(0, 0, 0, 0));
      expect(g.hours.length).toBeLessThanOrEqual(24);
    }
  });
});

describe('windowStats', () => {
  it('converts each hour on its own rather than pooling the samples', () => {
    // A busy hour that was entirely reachable and a quiet hour that was
    // entirely offline are half an hour each, not weighted by sample count.
    const byHour = new Map<number, UptimeBucket>([
      [0, bucket(0, { verified: 200, connected: 400, offline: 0 })],
      [HOUR, bucket(HOUR, { verified: 0, connected: 0, offline: 3 })],
    ]);
    const s = windowStats(byHour, [0, HOUR]);
    expect(Math.round(s.reachableMin)).toBe(60);
    expect(Math.round(s.offlineMin)).toBe(60);
    expect(s.verified).toBe(200);
  });

  it('reports nothing sampled for a run of empty hours', () => {
    expect(windowStats(new Map(), [0, HOUR]).sampled).toBe(false);
  });
});

describe('describeDay', () => {
  it('names the outage that ran through the day, with its real span', () => {
    const now = Date.now();
    const s = summary(now);
    const byHour = new Map<number, UptimeBucket>();
    for (const b of s.timeline) {
      const t = new Date(b.bucketStart).getTime();
      byHour.set(t - (t % HOUR), b);
    }
    const day = buildDayGroups(now).find((g) => g.hours.some((h) => h >= now - 20 * HOUR && h < now - 18 * HOUR))!;
    const { lines } = describeDay(byHour, day.hours, s.outages);
    expect(lines.some((l) => l.text.startsWith('Relay offline'))).toBe(true);
    expect(lines.some((l) => /verified read/.test(l.text))).toBe(true);
  });

  it('says so when only part of the day is inside the window', () => {
    const now = Date.now();
    const groups = buildDayGroups(now);
    const partial = groups.find((g) => g.hours.length < 24);
    if (!partial) return; // the window began exactly at midnight
    const { lines } = describeDay(new Map(), partial.hours, []);
    expect(lines.some((l) => l.text.includes('inside the 7-day window'))).toBe(true);
  });
});

describe('UptimeSectionView — the touch route', () => {
  it('opens a day of the strip on click, and closes it again', () => {
    render(<UptimeSectionView summary={summary(Date.now())} />);
    const days = screen.getAllByRole('button', { name: /reliability detail$/ });
    expect(days.length).toBeGreaterThanOrEqual(7);
    expect(screen.queryByLabelText('Close day detail')).toBeNull();

    fireEvent.click(days[3]);
    expect(screen.getByLabelText('Close day detail')).toBeTruthy();
    expect(days[3].getAttribute('aria-pressed')).toBe('true');
    // The panel is a real reading of that day, not an empty shell.
    expect(screen.getByText(/verified read|Nothing recorded for this day/)).toBeTruthy();

    fireEvent.click(days[3]);
    expect(screen.queryByLabelText('Close day detail')).toBeNull();
  });

  it('opens an outage row on click, showing what the tooltip used to hold', () => {
    render(<UptimeSectionView summary={summary(Date.now())} />);
    const row = screen.getAllByRole('button', { name: /^Relay offline/ })[0];
    expect(row.getAttribute('aria-expanded')).toBe('false');
    // The explanation is what only a hover could reach before.
    expect(screen.queryByText(/lost its connection to the cloud/)).toBeNull();

    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText(/lost its connection to the cloud/)).toBeTruthy();
    expect(screen.getByText(/^Started /)).toBeTruthy();
    expect(screen.getByText(/^Ended /)).toBeTruthy();
    expect(screen.getByText(/^Lasted /)).toBeTruthy();
  });

  it('carries the outage clock window on the row itself, unopened', () => {
    render(<UptimeSectionView summary={summary(Date.now())} />);
    const row = screen.getAllByRole('button', { name: /^Relay offline/ })[0];
    // Two rows reading "Relay offline 1 day ago" are one row to a reader; the
    // clock window is what tells them apart at a glance.
    expect(row.textContent).toMatch(/→/);
  });

  it('lights the outage row whose hours the open day covers', () => {
    const now = Date.now();
    render(<UptimeSectionView summary={summary(now)} />);
    const row = screen.getAllByRole('button', { name: /^Relay offline/ })[0];
    expect(row.className).not.toContain('ring-foreground');

    const outageDay = new Date(now - 19 * HOUR);
    const label = outageDay.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
    fireEvent.click(screen.getByRole('button', { name: `${label} — reliability detail` }));
    expect(row.className).toContain('ring-foreground');
  });
});

describe('UptimeSectionView — the legend', () => {
  it('wraps between its items rather than through them', () => {
    render(<UptimeSectionView summary={summary(Date.now())} />);
    const item = screen.getByText('Home not responding');
    // Each item stays on one line...
    expect(item.className).toContain('whitespace-nowrap');
    // ...and the row it sits in is allowed to wrap instead.
    expect(item.parentElement!.className).toContain('flex-wrap');
  });
});
