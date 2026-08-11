import { describe, it, expect } from 'vitest';
import { compareSeries, formatDelta, formatWindow, sameThreshold, verdictLabel } from '../comparison';
import type { HistorySeriesData } from '@/lib/graphql/types';

const seriesData = (values: number[]): HistorySeriesData => ({
  accessoryId: 'A', characteristicType: 'current_temperature', kind: 'numeric',
  unit: '°', resolution: 'raw', prevValue: null,
  points: values.map((v, i) => ({ ts: i * 1000, avg: v, min: v, max: v, last: v, count: 1 })),
  states: [], stateBuckets: [],
} as unknown as HistorySeriesData);

const colour = (i: number) => `c${i}`;

describe('compareSeries', () => {
  it('reports the change between window means', () => {
    const [row] = compareSeries(
      [{ key: 'k', label: 'Living Room', unit: '°', data: seriesData([21, 21]), ghost: seriesData([19, 20]) }],
      colour,
    );
    expect(row.current).toBe(21);
    expect(row.previous).toBe(19.5);
    expect(row.delta).toBeCloseTo(1.5);
    expect(row.verdict).toBe('higher');
  });

  it('calls a sub-threshold move "about the same" rather than a trend', () => {
    const [row] = compareSeries(
      [{ key: 'k', label: 'Bedroom', unit: '°', data: seriesData([19.4]), ghost: seriesData([19.7]) }],
      colour,
    );
    expect(row.verdict).toBe('same');
  });

  it('marks a series with no comparison data instead of dropping it', () => {
    const [row] = compareSeries(
      [{ key: 'k', label: 'Study', unit: '°', data: seriesData([21.7]), ghost: undefined }],
      colour,
    );
    expect(row.verdict).toBe('no-data');
    expect(row.current).toBe(21.7);
    expect(row.previous).toBeNull();
    expect(row.delta).toBeNull();
  });

  it('treats an empty comparison series the same as a missing one', () => {
    const [row] = compareSeries(
      [{ key: 'k', label: 'Study', unit: '°', data: seriesData([21.7]), ghost: seriesData([]) }],
      colour,
    );
    expect(row.verdict).toBe('no-data');
  });

  it('scales the threshold to the unit, not to a flat percentage', () => {
    // 14ppm is noise on a CO2 sensor; 0.6° is not noise on a thermometer.
    const [co2] = compareSeries(
      [{ key: 'c', label: 'Study', unit: 'ppm', data: seriesData([714]), ghost: seriesData([700]) }],
      colour,
    );
    const [temp] = compareSeries(
      [{ key: 't', label: 'Study', unit: '°', data: seriesData([20.6]), ghost: seriesData([20]) }],
      colour,
    );
    expect(co2.verdict).toBe('same');
    expect(temp.verdict).toBe('higher');
  });

  it('falls back to a relative threshold for an unknown unit', () => {
    expect(sameThreshold('bananas')).toBe(0);
    const [row] = compareSeries(
      [{ key: 'k', label: 'X', unit: 'bananas', data: seriesData([100.5]), ghost: seriesData([100]) }],
      colour,
    );
    expect(row.verdict).toBe('same'); // 0.5 < 2% of 100
  });
});

describe('verdictLabel', () => {
  it('says warmer/cooler for temperature and higher/lower otherwise', () => {
    expect(verdictLabel('higher', '°', 'yesterday')).toBe('warmer than yesterday');
    expect(verdictLabel('lower', '°', 'yesterday')).toBe('cooler than yesterday');
    expect(verdictLabel('higher', '%', 'last week')).toBe('higher than last week');
    expect(verdictLabel('same', '°', 'yesterday')).toBe('about the same');
  });
});

describe('formatWindow', () => {
  const now = new Date('2026-08-10T17:00:00Z').getTime();

  it('names the live end "now" rather than repeating the timestamp', () => {
    expect(formatWindow(now - 6 * 3_600_000, now, now)).toMatch(/– now$/);
  });

  it('drops clock times once the window spans more than two days', () => {
    const out = formatWindow(now - 30 * 86_400_000, now, now);
    expect(out).not.toMatch(/\d{2}:\d{2}/);
  });
});

describe('formatDelta', () => {
  it('signs the change and keeps a decimal only where it means something', () => {
    expect(formatDelta(1.24, '°')).toBe('+1.2°');
    expect(formatDelta(-0.3, '°')).toBe('−0.3°');
    expect(formatDelta(42.6, 'ppm')).toBe('+43ppm');
  });
});
