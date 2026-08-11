import { describe, it, expect } from 'vitest';
import { formatStateDuration, stateTotals } from '../stateSummary';
import type { HistorySeriesData } from '@/lib/graphql/types';

const FROM = 1_700_000_000_000;
const TO = FROM + 86_400_000;

const series = (over: Partial<HistorySeriesData>): HistorySeriesData => ({
  accessoryId: 'A1',
  characteristicType: 'power_state',
  kind: 'bool',
  unit: null,
  resolution: 'raw',
  prevValue: null,
  points: [],
  states: [],
  stateBuckets: [],
  ...over,
} as HistorySeriesData);

describe('stateTotals', () => {
  it('splits the window at each change, carrying the previous value in', () => {
    const { totals, transitions } = stateTotals(series({
      prevValue: 0,
      states: [{ ts: FROM + 6 * 3_600_000, value: 1 }, { ts: FROM + 9 * 3_600_000, value: 0 }],
    } as Partial<HistorySeriesData>), FROM, TO);
    expect(Object.fromEntries(totals)).toEqual({ '0': 21 * 3_600_000, '1': 3 * 3_600_000 });
    expect(transitions).toBe(2);
  });

  it('gives the whole window to a value carried in and never changed', () => {
    // The ordinary case for an alarm: quiet since last month, so there is no
    // sample inside the window at all. Reporting nothing made the caption
    // contradict the strip drawn right above it.
    const { totals, transitions } = stateTotals(series({ prevValue: 0 }), FROM, TO);
    expect(Object.fromEntries(totals)).toEqual({ '0': 86_400_000 });
    expect(transitions).toBe(0);
  });

  it('keeps a string-kind series keyed by its text', () => {
    const { totals } = stateTotals(series({
      kind: 'string', prevValue: 0, prevValueText: 'Away',
    } as Partial<HistorySeriesData>), FROM, TO);
    expect(Object.fromEntries(totals)).toEqual({ Away: 86_400_000 });
  });

  it('says nothing when nothing is known — no samples and no carry-in', () => {
    const { totals } = stateTotals(series({}), FROM, TO);
    expect(totals).toEqual([]);
  });

  it('sums rolled-up buckets', () => {
    const { totals, transitions } = stateTotals(series({
      resolution: 'hourly',
      stateBuckets: [
        { ts: FROM, stateMsJson: '{"0":3600000}', transitions: 0 },
        { ts: FROM + 3_600_000, stateMsJson: '{"0":1800000,"1":1800000}', transitions: 1 },
      ],
    } as Partial<HistorySeriesData>), FROM, TO);
    expect(Object.fromEntries(totals)).toEqual({ '0': 5_400_000, '1': 1_800_000 });
    expect(transitions).toBe(1);
  });
});

describe('formatStateDuration', () => {
  it('reads in the largest unit that stays legible', () => {
    expect(formatStateDuration(45 * 60_000)).toBe('45m');
    expect(formatStateDuration(3 * 3_600_000 + 12 * 60_000)).toBe('3h 12m');
    expect(formatStateDuration(50 * 3_600_000)).toBe('2d 2h');
  });
});
