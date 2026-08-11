import { describe, it, expect } from 'vitest';
import { groupStrip } from '../groupStrip';
import type { HistorySeriesData } from '@/lib/graphql/types';

const FROM = 0;
const TO = 100_000;

const member = (prevValue: number | null, states: Array<[number, number]> = []): HistorySeriesData => ({
  accessoryId: 'A', characteristicType: 'power_state', kind: 'bool', unit: null,
  resolution: 'raw', prevValue,
  points: [], stateBuckets: [],
  states: states.map(([ts, value]) => ({ ts, value })),
} as unknown as HistorySeriesData);

const shareOf = (bucket: { stateMsJson: string }) => {
  const ms = JSON.parse(bucket.stateMsJson) as Record<string, number>;
  const total = (ms['0'] ?? 0) + (ms['1'] ?? 0);
  return total > 0 ? (ms['1'] ?? 0) / total : 0;
};

describe('groupStrip', () => {
  it('shades a bucket by the share of members that were on', () => {
    const { buckets } = groupStrip([member(1), member(1), member(0), member(0)], FROM, TO, 4);
    expect(shareOf(buckets[0])).toBeCloseTo(0.5);
  });

  it('splits the window into all-on, some-on and off', () => {
    // One member on throughout; the second joins halfway.
    const result = groupStrip([member(1), member(0, [[50_000, 1]])], FROM, TO, 4);
    expect(result.someOnMs).toBeCloseTo(50_000);
    expect(result.allOnMs).toBeCloseTo(50_000);
    expect(result.offMs).toBe(0);
  });

  it('reads a group that was off all window as off, not as missing', () => {
    const result = groupStrip([member(0), member(0)], FROM, TO, 4);
    expect(result.offMs).toBeCloseTo(100_000);
    expect(result.buckets.every(b => shareOf(b) === 0)).toBe(true);
  });

  it('treats a member with no reading yet as unknown rather than off', () => {
    // One known member, on; one that has never reported. The group reads as
    // fully on, not half on.
    const { buckets } = groupStrip([member(1), member(null)], FROM, TO, 2);
    expect(shareOf(buckets[0])).toBe(1);
  });

  it('follows the rolled tier when there are no spans', () => {
    const rolled = {
      ...member(0),
      states: [],
      stateBuckets: [
        { ts: 0, dominant: 0, transitions: 0, stateMsJson: '{}' },
        { ts: 50_000, dominant: 1, transitions: 1, stateMsJson: '{}' },
      ],
    } as unknown as HistorySeriesData;
    const { buckets } = groupStrip([rolled], FROM, TO, 4);
    expect(buckets.map(shareOf)).toEqual([0, 0, 1, 1]);
  });

  it('has nothing to draw for an empty group', () => {
    expect(groupStrip([], FROM, TO)).toMatchObject({ buckets: [], allOnMs: 0, someOnMs: 0, offMs: 0 });
  });
});
