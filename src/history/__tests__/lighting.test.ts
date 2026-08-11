import { describe, it, expect } from 'vitest';
import { lightingSeries, lightingSummary } from '../lighting';
import type { HistorySeriesData } from '@/lib/graphql/types';

const FROM = 0;
const TO = 100_000;

const power = (prevValue: number | null, states: Array<[number, number]> = []): HistorySeriesData => ({
  accessoryId: 'A', characteristicType: 'power_state', kind: 'bool', unit: null,
  resolution: 'raw', prevValue,
  points: [], stateBuckets: [],
  states: states.map(([ts, value]) => ({ ts, value })),
} as unknown as HistorySeriesData);

const brightness = (prevValue: number | null, points: Array<[number, number]> = []): HistorySeriesData => ({
  accessoryId: 'A', characteristicType: 'brightness', kind: 'numeric', unit: '%',
  resolution: 'raw', prevValue,
  points: points.map(([ts, v]) => ({ ts, avg: v, min: v, max: v, last: v, count: 1 })),
  states: [], stateBuckets: [],
} as unknown as HistorySeriesData);

describe('lightingSeries', () => {
  it('counts only the lights that are actually on', () => {
    const out = lightingSeries([
      { power: power(1), brightness: brightness(100) },
      { power: power(0), brightness: brightness(100) },
      { power: power(1), brightness: brightness(50) },
    ], FROM, TO, 4);
    expect(out.map(p => p.onCount)).toEqual([2, 2, 2, 2]);
    expect(out[0].litBrightness).toBe(75); // (100 + 50) / 2 — the off one excluded
  });

  it('ignores a bulb that reports brightness while switched off', () => {
    // The whole reason the old panel was useless: HomeKit keeps reporting
    // the last brightness of a bulb that is off.
    const out = lightingSeries([
      { power: power(0), brightness: brightness(100) },
    ], FROM, TO, 2);
    expect(out.every(p => p.onCount === 0)).toBe(true);
    expect(out[0].litBrightness).toBeNull();
  });

  it('follows switches through the window', () => {
    const out = lightingSeries([
      { power: power(0, [[50_000, 1]]), brightness: brightness(80) },
    ], FROM, TO, 4);
    expect(out.map(p => p.onCount)).toEqual([0, 0, 1, 1]);
  });

  it('treats a light with no reading yet as unknown, not off', () => {
    const out = lightingSeries([
      { power: power(null, [[50_000, 1]]) },
    ], FROM, TO, 4);
    expect(out.map(p => p.onCount)).toEqual([0, 0, 1, 1]);
    // …and once it reports, a bulb with no brightness series counts as full.
    expect(out[3].litBrightness).toBe(100);
  });

  it('assumes full output for a lamp that cannot dim', () => {
    const out = lightingSeries([
      { power: power(1) },
      { power: power(1), brightness: brightness(50) },
    ], FROM, TO, 2);
    expect(out[0].onCount).toBe(2);
    expect(out[0].litBrightness).toBe(75); // (100 + 50) / 2
  });

  it('reads the rolled tier’s dominant state when there are no spans', () => {
    const rolled = {
      ...power(0),
      states: [],
      stateBuckets: [
        { ts: 0, dominant: 0, transitions: 0, stateMsJson: '{}' },
        { ts: 50_000, dominant: 1, transitions: 2, stateMsJson: '{}' },
      ],
    } as unknown as HistorySeriesData;
    const out = lightingSeries([{ power: rolled }], FROM, TO, 4);
    expect(out.map(p => p.onCount)).toEqual([0, 0, 1, 1]);
  });

  it('returns nothing when the room has no lights', () => {
    expect(lightingSeries([], FROM, TO)).toEqual([]);
  });
});

describe('lightingSummary', () => {
  it('totals lit time, the peak, and the mean intensity while lit', () => {
    const points = lightingSeries([
      { power: power(0, [[50_000, 1]]), brightness: brightness(60) },
      { power: power(0, [[75_000, 1]]), brightness: brightness(100) },
    ], FROM, TO, 4);
    const summary = lightingSummary(points, TO);
    expect(summary.onMs).toBe(50_000); // lit for the second half
    expect(summary.peak).toBe(2);
    expect(summary.peakTs).toBe(75_000);
    expect(summary.meanLit).toBeCloseTo(70); // 60 for 25s, then 80 for 25s
  });

  it('has nothing to say about a room that was never lit', () => {
    const points = lightingSeries([{ power: power(0) }], FROM, TO, 4);
    expect(lightingSummary(points, TO)).toMatchObject({ onMs: 0, peak: 0, meanLit: null });
  });
});
