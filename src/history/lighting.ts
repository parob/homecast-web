// Lighting as a line: how many of a room's lights are on.
//
// A room of nine bulbs charted as nine brightness lines said nothing —
// HomeKit keeps reporting a bulb's last brightness while it is OFF, so the
// panel was ten flat lines at 100% forever, and the axis ran to 160% for a
// quantity that stops at 100. The two things worth knowing are how much of
// the room was lit and how hard it was working, and they are independent:
// six bulbs at 20% and six at full sit at the same height and must not look
// the same. Height carries the count; stroke width carries the intensity.

import type { HistorySeriesData } from '@/lib/graphql/types';

export interface LightingPoint {
  ts: number;
  /** Lights on at this instant. */
  onCount: number;
  /** Mean brightness of the lit ones, or null when none are on. */
  litBrightness: number | null;
}

export interface LightingInput {
  /** bool/enum series — the source of truth for on/off. */
  power: HistorySeriesData;
  /** numeric brightness, if the bulb records it. */
  brightness?: HistorySeriesData;
}

/** Value of a bool/enum series at `ts`, LOCF from the window's opening value. */
function stateAt(data: HistorySeriesData, ts: number, cursor: { i: number; value: number | null }): number | null {
  if (data.states.length > 0) {
    while (cursor.i < data.states.length && data.states[cursor.i].ts <= ts) {
      cursor.value = data.states[cursor.i].value;
      cursor.i++;
    }
    return cursor.value;
  }
  if (data.stateBuckets.length > 0) {
    while (cursor.i < data.stateBuckets.length && data.stateBuckets[cursor.i].ts <= ts) {
      cursor.value = data.stateBuckets[cursor.i].dominant;
      cursor.i++;
    }
    return cursor.value;
  }
  return cursor.value;
}

/** Numeric value at `ts`, LOCF from the window's opening value. */
function numberAt(data: HistorySeriesData | undefined, ts: number, cursor: { i: number; value: number | null }): number | null {
  if (!data) return null;
  while (cursor.i < data.points.length && data.points[cursor.i].ts <= ts) {
    cursor.value = data.points[cursor.i].avg;
    cursor.i++;
  }
  return cursor.value;
}

export function lightingSeries(
  lights: LightingInput[],
  fromTs: number,
  toTs: number,
  buckets = 200,
): LightingPoint[] {
  const span = toTs - fromTs;
  if (span <= 0 || lights.length === 0) return [];
  const step = span / buckets;

  const cursors = lights.map(l => ({
    power: { i: 0, value: l.power.prevValue },
    brightness: { i: 0, value: l.brightness?.prevValue ?? null },
  }));

  const out: LightingPoint[] = [];
  for (let b = 0; b < buckets; b++) {
    const ts = fromTs + b * step;
    let onCount = 0;
    let brightnessSum = 0;
    let brightnessKnown = 0;
    lights.forEach((light, i) => {
      const state = stateAt(light.power, ts, cursors[i].power);
      const brightness = numberAt(light.brightness, ts, cursors[i].brightness);
      // A light with no reading yet is not "off" — it is unknown, and
      // counting it as off would draw a room that was never lit.
      if (state === null) return;
      if (state === 0) return;
      onCount++;
      if (brightness !== null) {
        brightnessSum += brightness;
        brightnessKnown++;
      }
    });
    out.push({
      ts,
      onCount,
      // Bulbs that don't report brightness are assumed full while on: an
      // unbrightnessable lamp IS at full output when it is switched on.
      litBrightness: onCount === 0
        ? null
        : brightnessKnown === 0
          ? 100
          : (brightnessSum + (onCount - brightnessKnown) * 100) / onCount,
    });
  }
  return out;
}

export interface LightingSummary {
  /** Time with at least one light on. */
  onMs: number;
  /** Most lights on at once, and when. */
  peak: number;
  peakTs: number | null;
  /** Mean brightness across the time anything was lit. */
  meanLit: number | null;
}



export function lightingSummary(points: LightingPoint[], toTs: number): LightingSummary {
  if (points.length === 0) return { onMs: 0, peak: 0, peakTs: null, meanLit: null };
  let onMs = 0;
  let peak = 0;
  let peakTs: number | null = null;
  let litSum = 0;
  let litMs = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const end = i + 1 < points.length ? points[i + 1].ts : toTs;
    const width = Math.max(end - p.ts, 0);
    if (p.onCount > 0) onMs += width;
    if (p.onCount > peak) {
      peak = p.onCount;
      peakTs = p.ts;
    }
    if (p.litBrightness !== null) {
      litSum += p.litBrightness * width;
      litMs += width;
    }
  }
  return { onMs, peak, peakTs, meanLit: litMs > 0 ? litSum / litMs : null };
}

/**
 * Package the count as a normal series, so the lighting chart is an ordinary
 * chart: same axis handling, same tooltip, same legend, same everything.
 */
export function lightingCountSeries(points: LightingPoint[]): HistorySeriesData {
  return {
    accessoryId: 'room:lighting',
    characteristicType: 'lights_on',
    kind: 'numeric',
    unit: null,
    resolution: 'raw',
    prevValue: null,
    points: points.map(p => ({ ts: p.ts, min: p.onCount, avg: p.onCount, max: p.onCount, last: p.onCount, count: 1 })),
    states: [],
    stateBuckets: [],
  } as unknown as HistorySeriesData;
}

/**
 * Mean brightness of whatever was lit, as its own series. Instants with
 * nothing on contribute no point — a dark room has no brightness, and
 * plotting zero would claim the lights were on and dimmed to nothing.
 */
export function lightingBrightnessSeries(points: LightingPoint[]): HistorySeriesData {
  const lit = points.flatMap(p => (p.litBrightness === null ? [] : [{
    ts: p.ts, min: p.litBrightness, avg: p.litBrightness, max: p.litBrightness, last: p.litBrightness, count: 1,
  }]));
  return {
    accessoryId: 'room:lighting',
    characteristicType: 'brightness',
    kind: 'numeric',
    unit: '%',
    resolution: 'raw',
    prevValue: null,
    points: lit,
    states: [],
    stateBuckets: [],
  } as unknown as HistorySeriesData;
}
