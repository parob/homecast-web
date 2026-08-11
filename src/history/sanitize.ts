// Bogus-data rules for charts.
//
// Real homes record sentinel garbage: a TRV reports -40° when its radio
// drops, a bridge pegs 100000 lux at boot, a boiler-cupboard sensor reads
// 60°. One such series stretches the axis until every real line is a flat
// band. Two rules clean it up, both reversible with the "Hide unusual
// data" checkbox (default ON) and always ANNOUNCED — nothing disappears
// silently:
//
// 1. Sample rule: readings outside the measure's physically-plausible
//    range are dropped (-40° is a radio fault, not weather).
// 2. Series rule (aggregate views only): a sensor whose window-average
//    sits far outside the home's typical band (median ± max(6×MAD, floor))
//    is excluded from the aggregate and named in the notice. Generous
//    floors keep legitimately-different sensors (an outdoor thermometer in
//    winter is cold, not broken) from vanishing quietly.

import { measureOf } from './categories';
import { canonicalHistoryType } from './keys';
import type { HistorySeriesData } from '@/lib/graphql/types';

/** Physically-plausible value range per measure id; null = no rule. */
const PLAUSIBLE_RANGES: Record<string, [number, number]> = {
  temperature: [-25, 50],
  humidity: [0, 100],
  light: [0, 120_000],
  co2: [0, 20_000],
  co: [0, 2_000],
  particulates: [0, 2_000],
  pressure: [700, 1_300],
  power: [0, 20_000],
  energy: [0, 1_000_000],
  voltage: [0, 500],
  current: [0, 100],
  brightness: [0, 100],
  position: [0, 100],
  speed: [0, 100],
  volume: [0, 100],
  water: [0, 100],
  battery: [0, 100],
  tilt: [-180, 180],
};

export function plausibleRange(characteristicType: string): [number, number] | null {
  const measure = measureOf(canonicalHistoryType(characteristicType));
  return PLAUSIBLE_RANGES[measure.id] ?? null;
}

export interface SanitizeResult {
  data: HistorySeriesData;
  /** Readings outside the plausible range that were dropped. */
  droppedPoints: number;
}

/** Drop numeric readings outside the measure's plausible range. */
export function sanitizeSeriesData(data: HistorySeriesData): SanitizeResult {
  if (data.kind !== 'numeric' || data.points.length === 0) {
    return { data, droppedPoints: 0 };
  }
  const range = plausibleRange(data.characteristicType);
  if (!range) return { data, droppedPoints: 0 };
  const [lo, hi] = range;
  const inRange = (v: number) => v >= lo && v <= hi;

  const points = data.points.filter(p => inRange(p.avg));
  const droppedPoints = data.points.length - points.length;
  const prevValue = data.prevValue !== null && inRange(data.prevValue) ? data.prevValue : null;
  // Rolled points can carry a bogus min/max around a sane average (one -40
  // inside an hour) — clamp the envelope so a single glitch doesn't stretch
  // the band.
  const needsClamp = points.some(p => p.min < lo || p.max > hi);
  if (droppedPoints === 0 && prevValue === data.prevValue && !needsClamp) {
    return { data, droppedPoints: 0 };
  }
  const clamped = needsClamp
    ? points.map(p => ({ ...p, min: Math.max(p.min, lo), max: Math.min(p.max, hi) }))
    : points;
  return {
    data: { ...data, points: clamped, prevValue },
    droppedPoints,
  };
}

/** Series-outlier floors per measure id — only where "typical" means much. */
const OUTLIER_FLOORS: Record<string, number> = {
  temperature: 8,
  humidity: 25,
};

export interface OutlierInput {
  key: string;
  label: string;
  characteristicType: string;
  /** Window-average AFTER sample sanitising. */
  mean: number;
}

export interface OutlierVerdict {
  hiddenKeys: Set<string>;
  hidden: Array<{ key: string; label: string; mean: number }>;
}

/**
 * Which series sit far outside the group's typical band. Median + MAD so a
 * single broken sensor can't drag the "typical" it is judged against;
 * requires ≥4 peers (with 3 sensors there is no "typical" to speak of).
 */
export function findOutlierSeries(items: OutlierInput[]): OutlierVerdict {
  const none: OutlierVerdict = { hiddenKeys: new Set(), hidden: [] };
  if (items.length < 4) return none;
  const floor = OUTLIER_FLOORS[measureOf(canonicalHistoryType(items[0].characteristicType)).id];
  if (floor === undefined) return none;

  const means = items.map(i => i.mean).sort((a, b) => a - b);
  const median = means[Math.floor(means.length / 2)];
  const deviations = means.map(m => Math.abs(m - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)];
  const threshold = Math.max(6 * mad * 1.4826, floor);

  const hidden = items
    .filter(i => Math.abs(i.mean - median) > threshold)
    .map(i => ({ key: i.key, label: i.label, mean: i.mean }));
  return { hiddenKeys: new Set(hidden.map(h => h.key)), hidden };
}
