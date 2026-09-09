// @vitest-environment jsdom
//
// The status row and the outage line described the same ongoing outage, one
// directly above the other: "Offline · went offline 1 hour ago" and then
// "Relay offline now, 1h 11m so far." Part of homecast-cloud#103.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

import { ReliabilitySectionView } from '../ReliabilitySection';
import type { UptimeSummary, UptimeOutage } from '@/components/settings/UptimeSection';

afterEach(cleanup);

const HOUR = 3600_000;

function summary(over: Partial<UptimeSummary> = {}): UptimeSummary {
  return {
    currentStatus: 'verified',
    uptimePercent24h: 99.9,
    uptimePercent7d: 99.9,
    uptimePercent30d: 99.9,
    verifiedRatio7d: 90,
    avgLatencyMs: 100,
    statusSince: null,
    lastProbe: null,
    timeline: [],
    outages: [],
    ...over,
  };
}

function outage(over: Partial<UptimeOutage> = {}): UptimeOutage {
  return {
    startedAt: new Date(Date.now() - HOUR).toISOString(),
    endedAt: null,
    durationSeconds: 4260,
    severity: 'offline',
    ...over,
  };
}

describe('the outage line', () => {
  it('is dropped when the status row above already named the same running outage', () => {
    render(<ReliabilitySectionView
      summary={summary({
        currentStatus: 'offline',
        statusSince: new Date(Date.now() - HOUR).toISOString(),
        outages: [outage()],
      })}
      homeName="County Hall"
    />);
    // The row keeps it — it is the one with the dot.
    expect(screen.getByText(/went offline/i)).toBeTruthy();
    expect(screen.queryByText(/so far\./i)).toBeNull();
  });

  it('survives for an outage that has ended — the row is not talking about it', () => {
    render(<ReliabilitySectionView
      summary={summary({
        outages: [outage({ endedAt: new Date(Date.now() - HOUR / 2).toISOString() })],
      })}
      homeName="County Hall"
    />);
    expect(screen.getByText(/Relay offline/i)).toBeTruthy();
  });

  it('survives when there were none — it is the only history on the panel', () => {
    render(<ReliabilitySectionView summary={summary()} homeName="County Hall" />);
    expect(screen.getByText(/No outages in the last 7 days/i)).toBeTruthy();
  });
});
