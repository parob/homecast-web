import { describe, it, expect } from 'vitest';
import { aggregateNumericSeries, normalizeValue } from '../aggregate';
import type { HistorySeriesData } from '@/lib/graphql/types';

const series = (prevValue: number | null, points: Array<[number, number]>): HistorySeriesData => ({
  accessoryId: 'a',
  characteristicType: 'current_temperature',
  kind: 'numeric',
  unit: '°',
  resolution: 'raw',
  prevValue,
  points: points.map(([ts, v]) => ({ ts, min: v, avg: v, max: v, last: v, count: 1 })),
  states: [],
  stateBuckets: [],
});

describe('aggregateNumericSeries', () => {
  it('computes the cross-series envelope with LOCF', () => {
    const a = series(20, [[5000, 22]]);
    const b = series(18, [[2000, 19], [8000, 21]]);
    const out = aggregateNumericSeries([a, b], 0, 10_000, 10);

    // At t=0: a=20 (prev), b=18 (prev) → avg 19, band [18, 20].
    expect(out[0]).toMatchObject({ min: 18, avg: 19, max: 20, count: 2 });
    // At t=9000: a=22, b=21.
    const last = out[out.length - 1];
    expect(last).toMatchObject({ min: 21, avg: 21.5, max: 22, count: 2 });
  });

  it('excludes series before their first value', () => {
    const late = series(null, [[6000, 30]]);
    const early = series(10, []);
    const out = aggregateNumericSeries([late, early], 0, 10_000, 10);
    // Early grid points only see the `early` series.
    expect(out[0]).toMatchObject({ avg: 10, count: 1 });
    // After 6000, both contribute.
    const after = out.find(p => p.ts >= 6000)!;
    expect(after.count).toBe(2);
    expect(after.max).toBe(30);
  });

  it('returns empty for empty input', () => {
    expect(aggregateNumericSeries([], 0, 1000)).toEqual([]);
    expect(aggregateNumericSeries([series(null, [])], 0, 1000)).toEqual([]);
  });
});

describe('normalizeValue', () => {
  it('maps to 0-100 and pins flat ranges to 50', () => {
    expect(normalizeValue(15, 10, 20)).toBe(50);
    expect(normalizeValue(10, 10, 20)).toBe(0);
    expect(normalizeValue(20, 10, 20)).toBe(100);
    expect(normalizeValue(7, 7, 7)).toBe(50);
  });
});
