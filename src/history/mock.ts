// Deterministic fake history for chart development and screenshots.
//
// `?mockHistory=1` routes the History dialog (and later the Explorer) here
// instead of GraphQL — same trick as the MQTT browser's `?mock=1`: develop
// the UI with realistic shapes, no relay, no recorded data, no waiting a week
// for a chart to fill. Deterministic by (seriesRef, range) so screenshots are
// reproducible.

import { restingState } from './quiet';
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

export type MockVariant = 'small' | 'big';

/**
 * `?mockHistory=1` = the cozy five-room home (widget shots, docs).
 * `?mockHistory=big` = a real-scale home — 9 rooms, ~90 climate series,
 * hundreds of energy-category series, 16 groups — the configuration that
 * exposed the data-overload failures the small mock could never show.
 */
export function mockHistoryVariant(): MockVariant {
  if (typeof window === 'undefined') return 'small';
  return new URLSearchParams(window.location.search).get('mockHistory') === 'big' ? 'big' : 'small';
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
  /** Current values by characteristic — the mock's "live" accessory state. */
  values?: Record<string, number | string>;
  /**
   * Hours of history this accessory has — a recently-added accessory has
   * less than the window you pick, which is the case that showed 16 hours
   * of data stretched across a 30-day chart.
   */
  recordingHours?: number;
}

/**
 * The mock home: five rooms, safety devices with recordable-but-silent
 * characteristics (a quiet smoke alarm must read as monitoring), energy,
 * battery, a virtual accessory, and a service group. Deterministic — this
 * is what the screenshots and every ?mockHistory=1 session see.
 */
export const MOCK_ACCESSORIES: MockAccessoryEntry[] = [
  { accessoryId: 'MOCK-LR-SENSOR', name: 'Living Room Sensor', room: 'Living Room', recordable: ['current_temperature', 'relative_humidity', 'current_ambient_light_level', 'motion_detected', 'battery_level'], recorded: ['current_temperature', 'relative_humidity', 'current_ambient_light_level', 'motion_detected', 'battery_level'], values: { current_temperature: 21.2, relative_humidity: 52, current_ambient_light_level: 64, motion_detected: 0, battery_level: 84 } },
  { accessoryId: 'MOCK-LR-SENSOR2', name: 'Bookshelf Sensor', room: 'Living Room', recordable: ['current_temperature', 'motion_detected', 'battery_level'], recorded: ['current_temperature', 'motion_detected', 'battery_level'], values: { current_temperature: 20.8, motion_detected: 0, battery_level: 91 } },
  { accessoryId: 'MOCK-BED-SENSOR', name: 'Bedroom Sensor', room: 'Bedroom', recordable: ['current_temperature', 'relative_humidity', 'battery_level'], recorded: ['current_temperature', 'relative_humidity', 'battery_level'], values: { current_temperature: 19.4, relative_humidity: 55, battery_level: 66 } },
  { accessoryId: 'MOCK-KITCHEN-TH', name: 'Kitchen Thermostat', room: 'Kitchen', recordable: ['current_temperature', 'target_temperature', 'heating_cooling_current'], recorded: ['current_temperature', 'target_temperature', 'heating_cooling_current'], values: { current_temperature: 22.1, target_temperature: 21.0, heating_cooling_current: 0 } },
  { accessoryId: 'MOCK-STUDY-SENSOR', name: 'Study Sensor', room: 'Study', recordable: ['current_temperature', 'relative_humidity', 'carbon_dioxide_level'], recorded: ['current_temperature', 'relative_humidity', 'carbon_dioxide_level'], values: { current_temperature: 21.7, relative_humidity: 49, carbon_dioxide_level: 720 } },
  { accessoryId: 'MOCK-DOOR', name: 'Front Door', room: 'Hallway', recordable: ['contact_state', 'battery_level'], recorded: ['contact_state', 'battery_level'], values: { contact_state: 0, battery_level: 17 } },
  { accessoryId: 'MOCK-SMOKE', name: 'Hall Smoke Alarm', room: 'Hallway', recordable: ['smoke_detected', 'status_low_battery'], recorded: [], values: { smoke_detected: 0, status_low_battery: 0 } },
  { accessoryId: 'MOCK-CO', name: 'Boiler CO Sensor', room: 'Kitchen', recordable: ['carbon_monoxide_detected', 'carbon_monoxide_level'], recorded: ['carbon_monoxide_level'], values: { carbon_monoxide_detected: 0, carbon_monoxide_level: 2 }, recordingHours: 16 },
  { accessoryId: 'MOCK-OUTLET', name: 'Desk Outlet', room: 'Study', recordable: ['power_state', 'eve_energy_watt'], recorded: ['power_state', 'eve_energy_watt'], values: { power_state: 1, eve_energy_watt: 62 } },
  { accessoryId: 'MOCK-LAMP', name: 'Reading Lamp', room: 'Bedroom', recordable: ['power_state', 'brightness'], recorded: ['power_state', 'brightness'], values: { power_state: 1, brightness: 40 } },
  { accessoryId: 'MOCK-VIRT-COUNT', name: 'Coffee Counter', room: null, isVirtual: true, recordable: ['virtual_count'], recorded: ['virtual_count'], values: { virtual_count: 14 } },
  { accessoryId: 'MOCK-VIRT-MODE', name: 'House Mode', room: null, isVirtual: true, recordable: ['virtual_mode'], recorded: ['virtual_mode'], values: { virtual_mode: 'Home' } },
];

export const MOCK_SERVICE_GROUPS = [
  { id: 'MOCK-GROUP-1', name: 'Kitchen Lights', memberIds: ['MOCK-LAMP', 'MOCK-OUTLET'] },
];

// ── The big home ───────────────────────────────────────────────────────────
//
// Modeled on the production home that exposed the data-overload failures:
// every room has an underfloor-heating thermostat AND a radiator valve (both
// reporting temperature + humidity), most have an air-conditioner and a
// standalone sensor, three lights each (whose colour channels are recordable
// but unrecorded — the "1293 monitoring" wall), 16 mostly-silent groups, a
// battery at 4%. Bedroom 2 deliberately runs ~3° warm so the outlier insight
// has something to find.

/**
 * Characteristics whose real-world answer is almost always "nothing to
 * report". Modelling them as square waves made the mock's activity panel a
 * wall of busy timelines while a real home's is a wall of Clear ones — the
 * exact difference this fixture exists to catch.
 */
const ALWAYS_QUIET = new Set([
  'smoke_detected',
  'carbon_monoxide_detected',
  'carbon_dioxide_detected',
  'leak_detected',
  'obstruction_detected',
  'status_low_battery',
]);

const BIG_ROOMS = [
  'Annex', 'Bedroom 1', 'Bedroom 2', 'Bedroom 3', 'Living',
  'Kitchen', 'Study', 'Garden', 'Hallway',
] as const;

/** Deterministic per-room personality: temp offset, humidity offset. */
function roomProfile(room: string): { temp: number; hum: number } {
  if (room === 'Bedroom 2') return { temp: 3.1, hum: -4 }; // the outlier
  const seed = hash(room);
  return { temp: (noise(seed, 1) - 0.5) * 2.4, hum: (noise(seed, 2) - 0.5) * 14 };
}

function buildBigHome(): { accessories: MockAccessoryEntry[]; groups: Array<{ id: string; name: string; memberIds: string[] }> } {
  const accessories: MockAccessoryEntry[] = [];
  const groups: Array<{ id: string; name: string; memberIds: string[] }> = [];
  const slug = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '-');

  BIG_ROOMS.forEach((room, roomIdx) => {
    const { temp, hum } = roomProfile(room);
    const rs = slug(room);

    // Underfloor heating: temp + humidity + setpoint, all recorded.
    accessories.push({
      accessoryId: `BIG-${rs}-UFH`, name: `${room} Underfloor Heating`, room,
      recordable: ['current_temperature', 'relative_humidity', 'target_temperature', 'heating_cooling_current'],
      recorded: ['current_temperature', 'relative_humidity', 'target_temperature'],
      values: { current_temperature: 20.6 + temp, relative_humidity: 58 + hum, target_temperature: 21, heating_cooling_current: 0 },
    });
    // Ensuite radiator valve: temp + humidity recorded.
    accessories.push({
      accessoryId: `BIG-${rs}-RAD`, name: `${room} Ensuite Radiator`, room,
      recordable: ['current_temperature', 'relative_humidity', 'battery_level'],
      recorded: ['current_temperature', 'relative_humidity'],
      values: { current_temperature: 20.1 + temp, relative_humidity: 60 + hum, battery_level: roomIdx === 3 ? 4 : 40 + Math.round(noise(hash(room), 5) * 55) },
    });
    // Air conditioner in half the rooms.
    if (roomIdx % 2 === 0) {
      accessories.push({
        accessoryId: `BIG-${rs}-AC`, name: `${room} Air Conditioner`, room,
        recordable: ['current_temperature', 'active', 'rotation_speed'],
        recorded: ['current_temperature'],
        values: { current_temperature: 21.0 + temp, active: 0, rotation_speed: 0 },
        // Added recently: less history than a wide window asks for.
        recordingHours: 16,
      });
    }
    // Motion sensor (recorded) — activity data.
    accessories.push({
      accessoryId: `BIG-${rs}-MOTION`, name: `${room} Motion Sensor`, room,
      recordable: ['motion_detected', 'current_ambient_light_level', 'battery_level'],
      recorded: roomIdx < 5 ? ['motion_detected', 'current_ambient_light_level'] : ['motion_detected'],
      values: { motion_detected: 0, current_ambient_light_level: 40 + roomIdx * 9, battery_level: 55 + roomIdx * 4 },
    });
    // Lights: three per room, power/brightness recorded on the first, the
    // colour channels recordable-but-silent everywhere — the monitoring wall.
    //
    // Except one room, which is a ceiling of nine downlights all recording,
    // because that is the shape that broke the old Brightness panel: ten
    // bulbs reporting 100% forever and eight identical timelines beneath.
    const downlightRoom = room === 'Living';
    const lightCount = downlightRoom ? 9 : 3;
    for (let l = 1; l <= lightCount; l++) {
      const records = downlightRoom || l === 1;
      accessories.push({
        accessoryId: `BIG-${rs}-LIGHT${l}`,
        name: downlightRoom ? `Hue ambiance spot ${l}` : `${room} Light ${l}`,
        room,
        recordable: ['power_state', 'brightness', 'hue', 'saturation', 'color_temperature'],
        recorded: records ? ['power_state', 'brightness'] : [],
        values: {
          power_state: records && (downlightRoom ? l % 3 !== 0 : roomIdx % 3 === 0) ? 1 : 0,
          brightness: records ? 55 + ((l * 13) % 45) : 0,
          hue: 30, saturation: 20, color_temperature: 300,
        },
      });
    }
    // Smoke alarm per room. Recording, and — like every real alarm — with
    // nothing to say: these are what the activity panel folds away.
    accessories.push({
      accessoryId: `BIG-${rs}-SMOKE`, name: `${room} Smoke Alarm`, room,
      recordable: ['smoke_detected', 'status_low_battery'],
      recorded: ['smoke_detected', 'status_low_battery'],
      values: { smoke_detected: 0, status_low_battery: 0 },
    });

    // Room light groups (mostly silent) + a couple of zone groups.
    groups.push({
      id: `BIG-GROUP-${rs}`, name: `${room} Lights`,
      memberIds: Array.from({ length: lightCount }, (_, i) => `BIG-${rs}-LIGHT${i + 1}`),
    });
  });

  // Extra groups to reach the real home's 16.
  groups.push(
    { id: 'BIG-GROUP-DOWN', name: 'Downstairs Lights', memberIds: ['BIG-LIVING-LIGHT1', 'BIG-KITCHEN-LIGHT1'] },
    { id: 'BIG-GROUP-UP', name: 'Upstairs Lights', memberIds: ['BIG-BEDROOM-1-LIGHT1', 'BIG-BEDROOM-2-LIGHT1'] },
    { id: 'BIG-GROUP-OUT', name: 'Outdoor', memberIds: ['BIG-GARDEN-LIGHT1'] },
    { id: 'BIG-GROUP-HALL', name: 'Hall & Landing', memberIds: ['BIG-HALLWAY-LIGHT1'] },
    { id: 'BIG-GROUP-EVE', name: 'Evening Scene Lights', memberIds: ['BIG-LIVING-LIGHT2'] },
    { id: 'BIG-GROUP-ALL', name: 'All Lights', memberIds: BIG_ROOMS.map(r => `BIG-${slug(r)}-LIGHT1`) },
    { id: 'BIG-GROUP-ACC', name: 'Accent Lights', memberIds: ['BIG-LIVING-LIGHT3', 'BIG-STUDY-LIGHT3'] },
  );

  // Front door + outdoor sensor + a couple of outlets with power metering.
  accessories.push(
    {
      accessoryId: 'BIG-FRONT-DOOR', name: 'Front Door', room: 'Hallway',
      recordable: ['contact_state', 'battery_level'], recorded: ['contact_state'],
      values: { contact_state: 0, battery_level: 12 },
    },
    {
      accessoryId: 'BIG-GARDEN-SENSOR', name: 'Hue outdoor motion sensor', room: 'Garden',
      recordable: ['current_temperature', 'current_ambient_light_level', 'motion_detected', 'battery_level'],
      recorded: ['current_temperature', 'current_ambient_light_level', 'motion_detected'],
      values: { current_temperature: 17.2, current_ambient_light_level: 2100, motion_detected: 0, battery_level: 74 },
    },
    {
      accessoryId: 'BIG-STUDY-OUTLET', name: 'Study Outlet', room: 'Study',
      recordable: ['power_state', 'eve_energy_watt', 'eve_energy_kwh'],
      recorded: ['power_state', 'eve_energy_watt'],
      values: { power_state: 1, eve_energy_watt: 145 },
    },
    {
      accessoryId: 'BIG-TV-OUTLET', name: 'TV Outlet', room: 'Living',
      recordable: ['power_state', 'eve_energy_watt', 'eve_energy_kwh'],
      recorded: ['power_state', 'eve_energy_watt'],
      values: { power_state: 1, eve_energy_watt: 195 },
    },
  );

  return { accessories, groups };
}

const BIG_HOME = buildBigHome();
export const MOCK_ACCESSORIES_BIG: MockAccessoryEntry[] = BIG_HOME.accessories;
export const MOCK_SERVICE_GROUPS_BIG = BIG_HOME.groups;

/** The active variant's catalogue. */
export function mockAccessories(variant: MockVariant = mockHistoryVariant()): MockAccessoryEntry[] {
  return variant === 'big' ? MOCK_ACCESSORIES_BIG : MOCK_ACCESSORIES;
}

export function mockServiceGroups(variant: MockVariant = mockHistoryVariant()) {
  return variant === 'big' ? MOCK_SERVICE_GROUPS_BIG : MOCK_SERVICE_GROUPS;
}

/** Recorded-series listing shaped like GetHistorySeries responses. */
export function mockRecordedSeries(variant: MockVariant = mockHistoryVariant()): HistorySeriesInfo[] {
  const out: HistorySeriesInfo[] = [];
  for (const acc of mockAccessories(variant)) {
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
  // Group-id series (group writes record under the group id). Most big-home
  // groups are silent — the real home's Groups tile read "monitoring".
  const groupIds = variant === 'big'
    ? ['BIG-GROUP-ALL', 'BIG-GROUP-DOWN']
    : ['MOCK-GROUP-1'];
  for (const id of groupIds) {
    out.push({
      accessoryId: id, characteristicType: 'power_state', kind: 'bool', unit: null,
      enabled: true, minIntervalS: 0, deadband: null, firstTs: null, lastTs: null, sampleCount: 200,
    });
  }
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

    // A recently-added accessory has no history before it existed — the
    // window still shows its full extent, the data just starts late.
    // Anchored to the clock, not to the requested window: measured from the
    // window's own end, every window — including the shifted one a comparison
    // asks for — got its own private 16 hours of history, so "previous week"
    // always had data and the no-comparison-data path could never be seen.
    const recordingHours = mockAccessories().find(a => a.accessoryId === ref.accessoryId)?.recordingHours;
    const seriesStart = recordingHours !== undefined
      ? Math.max(fromTs, Date.now() - recordingHours * HOUR_MS)
      : fromTs;

    if (kind === 'numeric') {
      const n = Math.min(maxPoints, 200);
      const stepMs = span / n;
      // Base level + daily sine + slow random walk: reads like a room sensor.
      // The catalogue's live value anchors the base when present, so per-room
      // personalities (Bedroom 2 runs hot) show in charts AND live headlines;
      // per-type presets fill in for anything uncatalogued.
      const catalogued = mockAccessories().find(a => a.accessoryId === ref.accessoryId)?.values?.[canonical];
      const liveBase = typeof catalogued === 'number' ? catalogued : undefined;
      const base = liveBase ?? (canonical.includes('watt') ? 45
        : canonical === 'battery_level' ? 82
        : canonical === 'carbon_dioxide_level' ? 650
        : canonical === 'carbon_monoxide_level' ? 2
        : canonical === 'virtual_count' ? 12
        : canonical.includes('temp') ? 20 : canonical.includes('humid') ? 52 : 60);
      const amp = canonical.includes('watt') ? 60
        : canonical === 'battery_level' ? 4
        : canonical === 'carbon_dioxide_level' ? 350
        : canonical === 'carbon_monoxide_level' ? 2
        : canonical === 'virtual_count' ? 6
        // Brightness swings hard on purpose: a ceiling of downlights that
        // is full in the evening and dimmed late is the behaviour the
        // lighting line exists to show, and a flat 70% would hide it.
        : canonical === 'brightness' ? 45
        : canonical.includes('temp') ? 3 : canonical.includes('humid') ? 8 : 35;
      let walk = 0;
      const points: HistoryPointData[] = [];
      // A real series records on CHANGE, so its first in-window sample lands
      // somewhere after the window opens — the mock was starting one exactly
      // at fromTs, which is the one shape that never occurs and the reason a
      // whole class of carry-in bugs was invisible here. Deterministic per
      // series, up to ~7% of the window.
      const firstSample = seed % 14;
      for (let i = firstSample; i < n; i++) {
        const ts = fromTs + i * stepMs;
        if (ts < seriesStart) continue;
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
        // prevValue is the reading the window OPENED with — LOCF's seed. An
        // accessory that only started recording partway through the window
        // has none, and handing back its first in-window reading instead made
        // a flat line run back to the start of a 30d view: history the mock
        // was inventing, and the exact thing the real server returns null for.
        prevValue: seriesStart > fromTs ? null : (points[0]?.avg ?? null),
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

    // Alarms and health flags sit at rest for months at a time, and a mock
    // whose every state series flips all day cannot show the thing a real
    // home is full of — twelve smoke detectors each reporting Clear. One in
    // seven gets a real excursion so the other path is exercised too.
    const resting = restingState(canonical);
    if (resting !== undefined && ALWAYS_QUIET.has(canonical) && noise(seed, 41) > 0.15) {
      return {
        accessoryId: ref.accessoryId,
        characteristicType: canonical,
        kind,
        unit: null,
        resolution,
        // Carried in, not sampled: nothing has happened inside the window.
        prevValue: resting,
        points: [],
        states: [],
        stateBuckets: [],
      };
    }

    // bool/enum: square wave with a seeded duty cycle.
    const values = kind === 'bool' ? [0, 1] : [0, 1, 2];
    if (resolution === 'raw') {
      const states: HistoryStateSpanData[] = [];
      let t = seriesStart;
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
    for (let t = seriesStart, i = 0; t < toTs; t += bucketMs, i++) {
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
