import { describe, it, expect } from 'vitest';
import { aggregateNumericSeries, normalizeValue, stateToNumericSeries, stateToNumericSeriesWith } from '../aggregate';
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

const stateSeries = (
  prevValue: number | null,
  states: Array<[number, number]>,
): HistorySeriesData => ({
  accessoryId: 'lock',
  characteristicType: 'lock_current_state',
  kind: 'enum',
  unit: null,
  resolution: 'raw',
  prevValue,
  points: [],
  states: states.map(([ts, value]) => ({ ts, value })),
  stateBuckets: [],
});

const bucketSeries = (stateMs: Record<string, number>): HistorySeriesData => ({
  accessoryId: 'lock',
  characteristicType: 'lock_current_state',
  kind: 'enum',
  unit: null,
  resolution: 'hourly',
  prevValue: null,
  points: [],
  states: [],
  stateBuckets: [{ ts: 0, dominant: 1, stateMsJson: JSON.stringify(stateMs), transitions: 2 }],
});

describe('stateToNumericSeries', () => {
  it('treats non-zero as on', () => {
    const out = stateToNumericSeries(stateSeries(0, [[100, 1], [200, 0]]));
    expect(out.kind).toBe('numeric');
    expect(out.prevValue).toBe(0);
    expect(out.points.map(p => p.avg)).toEqual([1, 0]);
  });

  it('reads a rolled bucket as the fraction of time not in state 0', () => {
    const out = stateToNumericSeries(bucketSeries({ '0': 25, '1': 75 }));
    expect(out.points[0].avg).toBeCloseTo(0.75);
  });
});

describe('stateToNumericSeriesWith', () => {
  it('lets the caller say what on means', () => {
    // Locks: 0 unsecured / 1 secured / 2 jammed. "Unlocked" is v !== 1, so a
    // jammed door reads as not locked.
    const isUnlocked = (v: number) => v !== 1;
    const out = stateToNumericSeriesWith(stateSeries(1, [[100, 0], [200, 2], [300, 1]]), isUnlocked);

    expect(out.prevValue).toBe(0);
    expect(out.points.map(p => p.avg)).toEqual([1, 1, 0]);
  });

  it('applies the predicate to rolled bucket keys', () => {
    const isUnlocked = (v: number) => v !== 1;
    // 25ms unsecured + 15ms jammed = 40ms of 100ms not locked.
    const out = stateToNumericSeriesWith(bucketSeries({ '0': 25, '1': 60, '2': 15 }), isUnlocked);
    expect(out.points[0].avg).toBeCloseTo(0.4);
  });
});
