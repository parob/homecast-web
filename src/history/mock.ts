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
  HistorySeriesInfo,
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

export interface MockAccessoryEntry {
  accessoryId: string;
  name: string;
  room: string | null;
  isVirtual?: boolean;
  /** Profiled characteristics this accessory carries. */
  recordable: string[];
  /** Subset of `recordable` that has recorded data (rest = monitoring). */
  recorded: string[];
}

/**
 * The mock home: five rooms, safety devices with recordable-but-silent
 * characteristics (a quiet smoke alarm must read as monitoring), energy,
 * battery, a virtual accessory, and a service group. Deterministic — this
 * is what the screenshots and every ?mockHistory=1 session see.
 */
export const MOCK_ACCESSORIES: MockAccessoryEntry[] = [
  { accessoryId: 'MOCK-LR-SENSOR', name: 'Living Room Sensor', room: 'Living Room', recordable: ['current_temperature', 'relative_humidity', 'current_ambient_light_level', 'motion_detected', 'battery_level'], recorded: ['current_temperature', 'relative_humidity', 'current_ambient_light_level', 'motion_detected', 'battery_level'] },
  { accessoryId: 'MOCK-LR-SENSOR2', name: 'Bookshelf Sensor', room: 'Living Room', recordable: ['current_temperature', 'motion_detected', 'battery_level'], recorded: ['current_temperature', 'motion_detected', 'battery_level'] },
  { accessoryId: 'MOCK-BED-SENSOR', name: 'Bedroom Sensor', room: 'Bedroom', recordable: ['current_temperature', 'relative_humidity', 'battery_level'], recorded: ['current_temperature', 'relative_humidity', 'battery_level'] },
  { accessoryId: 'MOCK-KITCHEN-TH', name: 'Kitchen Thermostat', room: 'Kitchen', recordable: ['current_temperature', 'target_temperature', 'heating_cooling_current'], recorded: ['current_temperature', 'target_temperature', 'heating_cooling_current'] },
  { accessoryId: 'MOCK-STUDY-SENSOR', name: 'Study Sensor', room: 'Study', recordable: ['current_temperature', 'relative_humidity', 'carbon_dioxide_level'], recorded: ['current_temperature', 'relative_humidity', 'carbon_dioxide_level'] },
  { accessoryId: 'MOCK-DOOR', name: 'Front Door', room: 'Hallway', recordable: ['contact_state', 'battery_level'], recorded: ['contact_state', 'battery_level'] },
  { accessoryId: 'MOCK-SMOKE', name: 'Hall Smoke Alarm', room: 'Hallway', recordable: ['smoke_detected', 'status_low_battery'], recorded: [] },
  { accessoryId: 'MOCK-CO', name: 'Boiler CO Sensor', room: 'Kitchen', recordable: ['carbon_monoxide_detected', 'carbon_monoxide_level'], recorded: ['carbon_monoxide_level'] },
  { accessoryId: 'MOCK-OUTLET', name: 'Desk Outlet', room: 'Study', recordable: ['power_state', 'eve_energy_watt'], recorded: ['power_state', 'eve_energy_watt'] },
  { accessoryId: 'MOCK-LAMP', name: 'Reading Lamp', room: 'Bedroom', recordable: ['power_state', 'brightness'], recorded: ['power_state', 'brightness'] },
  { accessoryId: 'MOCK-VIRT-COUNT', name: 'Coffee Counter', room: null, isVirtual: true, recordable: ['virtual_count'], recorded: ['virtual_count'] },
  { accessoryId: 'MOCK-VIRT-MODE', name: 'House Mode', room: null, isVirtual: true, recordable: ['virtual_mode'], recorded: ['virtual_mode'] },
];

export const MOCK_SERVICE_GROUPS = [
  { id: 'MOCK-GROUP-1', name: 'Kitchen Lights', memberIds: ['MOCK-LAMP', 'MOCK-OUTLET'] },
];

/** Recorded-series listing shaped like GetHistorySeries responses. */
export function mockRecordedSeries(): HistorySeriesInfo[] {
  const out: HistorySeriesInfo[] = [];
  for (const acc of MOCK_ACCESSORIES) {
    for (const type of acc.recorded) {
      const canonical = canonicalHistoryType(type);
      const profile = getProfile(canonical);
      out.push({
        accessoryId: acc.accessoryId,
        characteristicType: canonical,
        // Unprofiled types default numeric — the same fallback
        // mockHistoryData uses, so listing and data agree.
        kind: profile?.kind ?? 'numeric',
        unit: profile?.unit ?? null,
        enabled: true,
        minIntervalS: profile?.minIntervalS ?? null,
        deadband: profile?.deadband ?? null,
        firstTs: null,
        lastTs: null,
        sampleCount: 1000,
      });
    }
  }
  // The group's own series (group writes record under the group id).
  out.push({
    accessoryId: 'MOCK-GROUP-1', characteristicType: 'power_state', kind: 'bool', unit: null,
    enabled: true, minIntervalS: 0, deadband: null, firstTs: null, lastTs: null, sampleCount: 200,
  });
  return out;
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
      // Per-type presets keep the mock believable (spiky watts, slow battery
      // decline, CO2 rising with occupancy).
      const base = canonical.includes('watt') ? 45
        : canonical === 'battery_level' ? 82
        : canonical === 'carbon_dioxide_level' ? 650
        : canonical === 'carbon_monoxide_level' ? 2
        : canonical === 'virtual_count' ? 12
        : canonical.includes('temp') ? 20 : canonical.includes('humid') ? 52 : 60;
      const amp = canonical.includes('watt') ? 60
        : canonical === 'battery_level' ? 4
        : canonical === 'carbon_dioxide_level' ? 350
        : canonical === 'carbon_monoxide_level' ? 2
        : canonical === 'virtual_count' ? 6
        : canonical.includes('temp') ? 3 : canonical.includes('humid') ? 8 : 35;
      let walk = 0;
      const points: HistoryPointData[] = [];
      for (let i = 0; i < n; i++) {
        const ts = fromTs + i * stepMs;
        const dayPhase = ((ts % DAY_MS) / DAY_MS) * Math.PI * 2;
        // Seed the walk by absolute day so compare-mode ghosts (the same
        // series a day/week earlier) differ visibly from today.
        walk += (noise(seed + Math.floor(ts / DAY_MS), i) - 0.5) * amp * 0.08;
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

    // string kind: seeded rotation through a text vocabulary.
    if (kind === 'string') {
      const vocab = canonical === 'virtual_timer'
        ? ['idle', 'active', 'paused']
        : ['Home', 'Away', 'Movie Night', 'Night'];
      if (resolution === 'raw') {
        const states: HistoryStateSpanData[] = [];
        let t = fromTs;
        let idx = Math.floor(noise(seed, 0) * vocab.length);
        let step = 0;
        while (t < toTs && states.length < 60) {
          idx = (idx + 1 + Math.floor(noise(seed, step) * (vocab.length - 1))) % vocab.length;
          states.push({ ts: t, value: 0, valueText: vocab[idx] });
          t += span * (0.05 + noise(seed, step + 500) * 0.2);
          step++;
        }
        return {
          accessoryId: ref.accessoryId,
          characteristicType: canonical,
          kind,
          unit: null,
          resolution,
          prevValue: 0,
          prevValueText: vocab[(idx + 1) % vocab.length],
          points: [],
          states,
          stateBuckets: [],
        };
      }
      const bucketMs = resolution === 'hourly' ? HOUR_MS : DAY_MS;
      const stateBuckets: HistoryStateBucketData[] = [];
      for (let t = fromTs, i = 0; t < toTs; t += bucketMs, i++) {
        const a = vocab[i % vocab.length];
        const b = vocab[(i + 1) % vocab.length];
        const aMs = Math.round(bucketMs * (0.3 + noise(seed, i) * 0.6));
        stateBuckets.push({
          ts: t,
          dominant: 0,
          dominantText: aMs > bucketMs / 2 ? a : b,
          stateMsJson: JSON.stringify({ [a]: aMs, [b]: bucketMs - aMs }),
          transitions: 1 + Math.floor(noise(seed, i + 700) * 3),
        });
      }
      return {
        accessoryId: ref.accessoryId,
        characteristicType: canonical,
        kind,
        unit: null,
        resolution,
        prevValue: 0,
        prevValueText: vocab[0],
        points: [],
        states: [],
        stateBuckets,
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
