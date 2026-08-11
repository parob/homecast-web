// Client-side cross-series aggregation for Home Analytics.
//
// "Living Room temperature" is usually several sensors (every Hue motion
// sensor carries a thermometer). Charting 19 thin lines says less than one
// bold average inside a min–max band — but the per-series points arrive on
// irregular timestamps (raw tier records on change), so they must be
// re-gridded before they can be compared. LOCF onto a uniform grid, same
// semantics as everywhere else in history: between samples, the value held.

import type { HistorySeriesData } from '@/lib/graphql/types';

export interface AggregatePoint {
  ts: number;
  min: number;
  avg: number;
  max: number;
  /** Series contributing at this instant (those with a value by then). */
  count: number;
}

/**
 * Merge numeric series onto a uniform grid of `buckets` points across
 * [fromTs, toTs), returning the cross-series envelope and mean at each grid
 * point. Series with no value yet at a grid point (before their first
 * sample, no prevValue) simply don't contribute there.
 */
export function aggregateNumericSeries(
  seriesList: HistorySeriesData[],
  fromTs: number,
  toTs: number,
  buckets = 200,
): AggregatePoint[] {
  const span = toTs - fromTs;
  if (span <= 0 || seriesList.length === 0) return [];
  const stepMs = span / buckets;

  // Per series: a cursor walking its points as the grid advances.
  const cursors = seriesList.map(s => ({
    points: s.points,
    index: 0,
    value: s.prevValue,
  }));

  const out: AggregatePoint[] = [];
  for (let i = 0; i < buckets; i++) {
    const ts = fromTs + i * stepMs;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    for (const cursor of cursors) {
      while (cursor.index < cursor.points.length && cursor.points[cursor.index].ts <= ts) {
        cursor.value = cursor.points[cursor.index].avg;
        cursor.index++;
      }
      if (cursor.value === null || cursor.value === undefined) continue;
      min = Math.min(min, cursor.value);
      max = Math.max(max, cursor.value);
      sum += cursor.value;
      count++;
    }
    if (count > 0) {
      out.push({ ts, min, avg: sum / count, max, count });
    }
  }
  return out;
}

/** Normalize a value into 0–100 within [min, max]; flat series pin to 50. */
export function normalizeValue(value: number, min: number, max: number): number {
  if (max <= min) return 50;
  return ((value - min) / (max - min)) * 100;
}

/**
 * Package an aggregate back into the HistorySeriesData shape so the chart
 * pipeline treats a per-room average exactly like a fetched series — one
 * "Bedroom 2" line instead of that room's four sensors.
 */
export function aggregateToSeries(
  points: AggregatePoint[],
  template: { accessoryId: string; characteristicType: string; unit: string | null },
  resolution: HistorySeriesData['resolution'] = 'raw',
): HistorySeriesData {
  return {
    accessoryId: template.accessoryId,
    characteristicType: template.characteristicType,
    kind: 'numeric',
    unit: template.unit,
    resolution,
    prevValue: points[0]?.avg ?? null,
    points: points.map(p => ({ ts: p.ts, min: p.min, avg: p.avg, max: p.max, last: p.avg, count: p.count })),
    states: [],
    stateBuckets: [],
  };
}
