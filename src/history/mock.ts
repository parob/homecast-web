// Deterministic fake history for chart development and screenshots.
//
// `?mockHistory=1` routes the History dialog (and later the Explorer) here
// instead of GraphQL — same trick as the MQTT browser's `?mock=1`: develop
// the UI with realistic shapes, no relay, no recorded data, no waiting a week
// for a chart to fill. Deterministic by (seriesRef, range) so screenshots are
// reproducible.

import type {
  HistorySeriesData,
  HistoryPointData,
  HistoryStateSpanData,
  HistoryStateBucketData,
  HistorySeriesRefInput,
} from '@/lib/graphql/types';
import { getProfile } from './policy';
import { canonicalHistoryType } from './keys';
import { HOUR_MS, DAY_MS } from './rollup';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic [0,1) noise from a seed and step. */
function noise(seed: number, step: number): number {
  const x = Math.sin(seed + step * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function isMockHistoryEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('mockHistory');
}

export function mockHistoryData(
  refs: HistorySeriesRefInput[],
  fromTs: number,
  toTs: number,
  maxPoints = 500,
): HistorySeriesData[] {
  return refs.map(ref => {
    const canonical = canonicalHistoryType(ref.characteristicType);
    const profile = getProfile(canonical);
    const kind = profile?.kind ?? 'numeric';
    const seed = hash(`${ref.accessoryId}|${canonical}`);
    const span = toTs - fromTs;
    const resolution = span <= 48 * HOUR_MS ? 'raw' : span <= 60 * DAY_MS ? 'hourly' : 'daily';

    if (kind === 'numeric') {
      const n = Math.min(maxPoints, 200);
      const stepMs = span / n;
      // Base level + daily sine + slow random walk: reads like a room sensor.
      const base = canonical.includes('temp') ? 20 : canonical.includes('humid') ? 52 : 60;
      const amp = canonical.includes('temp') ? 3 : canonical.includes('humid') ? 8 : 35;
      let walk = 0;
      const points: HistoryPointData[] = [];
      for (let i = 0; i < n; i++) {
        const ts = fromTs + i * stepMs;
        const dayPhase = ((ts % DAY_MS) / DAY_MS) * Math.PI * 2;
        walk += (noise(seed, i) - 0.5) * amp * 0.08;
        walk *= 0.98;
        const avg = base + Math.sin(dayPhase - Math.PI / 2) * amp * 0.5 + walk;
        const jitter = resolution === 'raw' ? 0 : amp * 0.15;
        points.push({
          ts,
          min: avg - jitter - noise(seed, i + 1000) * amp * 0.1,
          avg,
          max: avg + jitter + noise(seed, i + 2000) * amp * 0.1,
          last: avg,
          count: resolution === 'raw' ? 1 : 12,
        });
      }
      return {
        accessoryId: ref.accessoryId,
        characteristicType: canonical,
        kind,
        unit: profile?.unit ?? null,
        resolution,
        prevValue: points[0]?.avg ?? null,
        points,
        states: [],
        stateBuckets: [],
      };
    }

    // bool/enum: square wave with a seeded duty cycle.
    const values = kind === 'bool' ? [0, 1] : [0, 1, 2];
    if (resolution === 'raw') {
      const states: HistoryStateSpanData[] = [];
      let t = fromTs;
      let idx = Math.floor(noise(seed, 0) * values.length);
      let step = 0;
      while (t < toTs && states.length < 300) {
        idx = (idx + 1 + Math.floor(noise(seed, step) * (values.length - 1))) % values.length;
        states.push({ ts: t, value: values[idx] });
        t += span * (0.02 + noise(seed, step + 500) * 0.12);
        step++;
      }
      return {
        accessoryId: ref.accessoryId,
        characteristicType: canonical,
        kind,
        unit: null,
        resolution,
        prevValue: values[(idx + 1) % values.length],
        points: [],
        states,
        stateBuckets: [],
      };
    }

    const bucketMs = resolution === 'hourly' ? HOUR_MS : DAY_MS;
    const stateBuckets: HistoryStateBucketData[] = [];
    for (let t = fromTs, i = 0; t < toTs; t += bucketMs, i++) {
      const onMs = Math.round(bucketMs * noise(seed, i));
      const dominant = onMs > bucketMs / 2 ? values[values.length - 1] : 0;
      stateBuckets.push({
        ts: t,
        dominant,
        stateMsJson: JSON.stringify({ '0': bucketMs - onMs, [String(values[values.length - 1])]: onMs }),
        transitions: Math.floor(noise(seed, i + 700) * 6),
      });
    }
    return {
      accessoryId: ref.accessoryId,
      characteristicType: canonical,
      kind,
      unit: null,
      resolution,
      prevValue: 0,
      points: [],
      states: [],
      stateBuckets,
    };
  });
}
