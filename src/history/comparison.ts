// Window-vs-window comparison for Home Analytics.
//
// The dashed ghost line shows you the shape of the previous period; it does
// not answer the question people actually arrive with, which is "is it
// warmer than yesterday, and by how much?". Reading that off two overlaid
// lines is eyeballing. These are the numbers behind the summary strip, and
// the honest answer when a series has nothing to compare against — silence
// there is indistinguishable from a broken control.

import type { HistorySeriesData } from '@/lib/graphql/types';

export type CompareVerdict = 'higher' | 'lower' | 'same' | 'no-data';

export interface CompareRow {
  key: string;
  label: string;
  color: string;
  unit: string;
  /** Mean across the selected window; null when the series recorded nothing. */
  current: number | null;
  /** Mean across the comparison window; null when it recorded nothing. */
  previous: number | null;
  delta: number | null;
  verdict: CompareVerdict;
}

/**
 * How far two readings must differ before it is worth calling a change.
 *
 * Unit-aware rather than a flat percentage: 2% of a CO₂ reading is 14ppm
 * (noise), while 2% of a room temperature is 0.4° (a real difference). A
 * percentage alone would cry change on one and hide it on the other.
 */
export function sameThreshold(unit: string | null): number {
  switch (unit) {
    case '°':
    case '°C':
    case '°F': return 0.5;
    case '%': return 2;
    case 'ppm': return 25;
    case 'lux': return 5;
    case 'W': return 5;
    case 'kWh': return 0.1;
    default: return 0;
  }
}

function mean(data: HistorySeriesData | undefined): number | null {
  if (!data || data.points.length === 0) return null;
  let sum = 0;
  for (const p of data.points) sum += p.avg;
  return sum / data.points.length;
}

export function compareSeries(
  series: Array<{ key: string; label: string; unit: string | null; data: HistorySeriesData; ghost?: HistorySeriesData }>,
  colorOf: (index: number) => string,
): CompareRow[] {
  return series.map((s, i) => {
    const current = mean(s.data);
    const previous = mean(s.ghost);
    const unit = s.unit ?? '';
    if (previous === null || current === null) {
      return { key: s.key, label: s.label, color: colorOf(i), unit, current, previous, delta: null, verdict: 'no-data' as const };
    }
    const delta = current - previous;
    // A flat 0 threshold (unknown unit) must not make every rounding wobble a
    // change — fall back to 2% of the previous reading.
    const threshold = sameThreshold(s.unit) || Math.abs(previous) * 0.02;
    const verdict: CompareVerdict = Math.abs(delta) < threshold ? 'same' : delta > 0 ? 'higher' : 'lower';
    return { key: s.key, label: s.label, color: colorOf(i), unit, current, previous, delta, verdict };
  });
}

/** Temperature earns its own words; everything else is higher/lower. */
export function verdictLabel(verdict: CompareVerdict, unit: string | null, comparisonName: string): string {
  const isTemp = unit === '°' || unit === '°C' || unit === '°F';
  switch (verdict) {
    case 'higher': return isTemp ? `warmer than ${comparisonName}` : `higher than ${comparisonName}`;
    case 'lower': return isTemp ? `cooler than ${comparisonName}` : `lower than ${comparisonName}`;
    case 'same': return 'about the same';
    case 'no-data': return '';
  }
}

/**
 * "Mon 10 Aug 17:00 – now" / "Sun 9 Aug 17:00 – Mon 10 Aug 17:00".
 *
 * Clock times only while they mean something: across a month they are noise,
 * and the two windows are then better named by their dates alone.
 */
export function formatWindow(fromTs: number, toTs: number, now: number): string {
  const withTime = toTs - fromTs <= 48 * 3_600_000;
  const fmt = (ts: number) => new Date(ts).toLocaleString(undefined, withTime
    ? { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short' });
  const end = Math.abs(now - toTs) < 120_000 ? 'now' : fmt(toTs);
  return `${fmt(fromTs)} – ${end}`;
}

export function formatDelta(delta: number, unit: string): string {
  const abs = Math.abs(delta);
  const digits = abs < 10 ? 1 : 0;
  return `${delta > 0 ? '+' : '−'}${abs.toFixed(digits)}${unit}`;
}
