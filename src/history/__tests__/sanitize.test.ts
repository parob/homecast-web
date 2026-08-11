import { describe, it, expect } from 'vitest';
import { sanitizeSeriesData, findOutlierSeries, plausibleRange } from '../sanitize';
import type { HistorySeriesData } from '@/lib/graphql/types';

const series = (type: string, avgs: number[], prevValue: number | null = null): HistorySeriesData => ({
  accessoryId: 'A', characteristicType: type, kind: 'numeric', unit: '°',
  resolution: 'raw', prevValue,
  points: avgs.map((v, i) => ({ ts: i * 1000, min: v, avg: v, max: v, last: v, count: 1 })),
  states: [], stateBuckets: [],
});

describe('sanitizeSeriesData', () => {
  it('drops the -40° radio-fault sentinel and keeps real readings', () => {
    const { data, droppedPoints } = sanitizeSeriesData(series('current_temperature', [21.2, -40, 21.4, -40, 21.6]));
    expect(droppedPoints).toBe(2);
    expect(data.points.map(p => p.avg)).toEqual([21.2, 21.4, 21.6]);
  });

  it('drops a bogus prevValue so LOCF cannot resurrect it', () => {
    const { data } = sanitizeSeriesData(series('current_temperature', [21], -40));
    expect(data.prevValue).toBeNull();
  });

  it('clamps rolled envelopes around a sane average', () => {
    const input = series('current_temperature', [21]);
    input.points[0].min = -40; // one glitch inside the hour
    const { data } = sanitizeSeriesData(input);
    expect(data.points[0].min).toBe(-25);
  });

  it('leaves in-range series untouched (same reference)', () => {
    const input = series('current_temperature', [20, 21, 22]);
    const { data, droppedPoints } = sanitizeSeriesData(input);
    expect(droppedPoints).toBe(0);
    expect(data).toBe(input);
  });

  it('has no rule for unbounded measures', () => {
    expect(plausibleRange('virtual_count')).toBeNull();
    expect(plausibleRange('current_temperature')).toEqual([-25, 50]);
  });
});

describe('findOutlierSeries', () => {
  const item = (key: string, mean: number) =>
    ({ key, label: key, characteristicType: 'current_temperature', mean });

  it('hides the boiler-cupboard sensor, keeps the outdoor one', () => {
    // Home around 21°, outdoor at 14° (legit), boiler cupboard at 38°.
    const verdict = findOutlierSeries([
      item('living', 21), item('kitchen', 20.5), item('bed1', 21.5),
      item('bed2', 22), item('garden', 14), item('boiler', 38),
    ]);
    expect([...verdict.hiddenKeys]).toEqual(['boiler']);
  });

  it('needs at least four peers to judge', () => {
    const verdict = findOutlierSeries([item('a', 21), item('b', 60), item('c', 21)]);
    expect(verdict.hiddenKeys.size).toBe(0);
  });

  it('has no opinion on measures without a floor', () => {
    const verdict = findOutlierSeries([
      { key: 'a', label: 'a', characteristicType: 'eve_energy_watt', mean: 5 },
      { key: 'b', label: 'b', characteristicType: 'eve_energy_watt', mean: 500 },
      { key: 'c', label: 'c', characteristicType: 'eve_energy_watt', mean: 6 },
      { key: 'd', label: 'd', characteristicType: 'eve_energy_watt', mean: 7 },
    ]);
    expect(verdict.hiddenKeys.size).toBe(0);
  });
});
