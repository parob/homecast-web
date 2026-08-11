import { describe, it, expect } from 'vitest';
import { coverageStart, unrecordedLeadIn, withCarryIn } from '../carry';
import type { HistorySeriesData } from '@/lib/graphql/types';

const FROM = 1_000_000;
const TO = FROM + 6 * 3_600_000;

const series = (over: Partial<HistorySeriesData>): HistorySeriesData => ({
  accessoryId: 'A', characteristicType: 'relative_humidity', kind: 'numeric',
  unit: '%', resolution: 'raw', prevValue: null,
  points: [], states: [], stateBuckets: [],
  ...over,
} as HistorySeriesData);

const point = (ts: number, v: number) => ({ ts, min: v, avg: v, max: v, last: v, count: 1 });

describe('withCarryIn', () => {
  it('opens the line at the window start with the value it carried in', () => {
    const out = withCarryIn(series({ prevValue: 68.6, points: [point(FROM + 1_080_000, 68.5)] }), FROM);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ ts: FROM, avg: 68.6, count: 0 });
  });

  it('leaves the points alone when nothing preceded the window', () => {
    const points = [point(FROM + 1_080_000, 68.5)];
    expect(withCarryIn(series({ prevValue: null, points }), FROM)).toBe(points);
  });

  it('does not prepend when a sample already sits at the window start', () => {
    const points = [point(FROM, 68.5), point(FROM + 60_000, 68.4)];
    expect(withCarryIn(series({ prevValue: 70, points }), FROM)).toBe(points);
  });

  it('covers a window whose only knowledge is the carried value', () => {
    const out = withCarryIn(series({ prevValue: 21, points: [] }), FROM);
    expect(out).toEqual([expect.objectContaining({ ts: FROM, avg: 21 })]);
  });
});

describe('coverageStart', () => {
  it('is the window start when a value carried in, however late the first sample', () => {
    expect(coverageStart(series({ prevValue: 68.6, points: [point(FROM + 1_080_000, 68.5)] }), FROM)).toBe(FROM);
  });

  it('is the first sample when nothing preceded the window', () => {
    const first = FROM + 1_080_000;
    expect(coverageStart(series({ prevValue: null, points: [point(first, 68.5)] }), FROM)).toBe(first);
  });

  it('reads state spans and buckets too, not just numeric points', () => {
    const ts = FROM + 500_000;
    expect(coverageStart(series({ kind: 'bool', states: [{ ts, value: 1 }] } as Partial<HistorySeriesData>), FROM)).toBe(ts);
  });

  it('is Infinity for a series with nothing at all', () => {
    expect(coverageStart(series({}), FROM)).toBe(Infinity);
  });
});

describe('unrecordedLeadIn', () => {
  it('says nothing when the window was covered from its start', () => {
    expect(unrecordedLeadIn(FROM, FROM, TO)).toBeNull();
  });

  it('ignores a lead-in too small to be a story', () => {
    expect(unrecordedLeadIn(FROM + 60_000, FROM, TO)).toBeNull(); // 1min of 6h
  });

  it('reports a real one', () => {
    const start = FROM + 4 * 3_600_000;
    expect(unrecordedLeadIn(start, FROM, TO)).toBe(start);
  });

  it('shades the whole window when the series is empty', () => {
    expect(unrecordedLeadIn(Infinity, FROM, TO)).toBe(TO);
  });
});
