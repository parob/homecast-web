// The category system behind Home Analytics.
//
// Every profiled characteristic belongs to exactly one category — the
// totality test in categories.test.ts fails CI the moment a new profile
// forgets to pick one. Categories are what the Analytics overview tiles
// show and what the category views group by; rooms are a filter INSIDE a
// category, never a category themselves (one card per room per category is
// how the old preset list drowned).

import { profiledTypes, getProfile } from './policy';
import { canonicalHistoryType } from './keys';
import type { HistorySeriesInfo } from '@/lib/graphql/types';

export type CategoryId =
  | 'climate'
  | 'activity'
  | 'safety'
  | 'energy'
  | 'battery'
  | 'virtual'
  | 'groups'
  | 'other';

export interface CategoryMeta {
  id: CategoryId;
  title: string;
  /** Overview tile order. */
  order: number;
}

export const CATEGORIES: Record<CategoryId, CategoryMeta> = {
  climate: { id: 'climate', title: 'Climate', order: 0 },
  activity: { id: 'activity', title: 'Activity', order: 1 },
  safety: { id: 'safety', title: 'Safety', order: 2 },
  energy: { id: 'energy', title: 'Energy & Usage', order: 3 },
  battery: { id: 'battery', title: 'Battery', order: 4 },
  groups: { id: 'groups', title: 'Groups', order: 5 },
  virtual: { id: 'virtual', title: 'Virtual', order: 6 },
  other: { id: 'other', title: 'Other', order: 7 },
};

/**
 * TOTAL over profiledTypes() — CI-enforced. Adding a profile without a row
 * here fails categories.test.ts, which is the point: nothing is allowed to
 * exist outside the navigation again (41 of 49 types were unreachable in
 * the preset era).
 */
export const CATEGORY_OF: Record<string, Exclude<CategoryId, 'groups' | 'other'>> = {
  // Climate — the room-comfort picture.
  current_temperature: 'climate',
  target_temperature: 'climate',
  heating_threshold: 'climate',
  cooling_threshold: 'climate',
  relative_humidity: 'climate',
  target_humidity: 'climate',
  current_ambient_light_level: 'climate',
  eve_air_pressure: 'climate',
  water_level: 'climate',
  heating_cooling_current: 'climate',
  heating_cooling_target: 'climate',
  current_heater_cooler_state: 'climate',
  target_heater_cooler_state: 'climate',
  current_humidifier_dehumidifier_state: 'climate',

  // Activity — who/what moved, opened, locked.
  motion_detected: 'activity',
  occupancy_detected: 'activity',
  contact_state: 'activity',
  current_door_state: 'activity',
  lock_current_state: 'activity',
  obstruction_detected: 'activity',

  // Safety — alarms and air.
  smoke_detected: 'safety',
  carbon_monoxide_detected: 'safety',
  carbon_dioxide_detected: 'safety',
  leak_detected: 'safety',
  air_quality: 'safety',
  security_system_current_state: 'safety',
  security_system_target_state: 'safety',
  carbon_monoxide_level: 'safety',
  carbon_monoxide_peak_level: 'safety',
  carbon_dioxide_level: 'safety',
  carbon_dioxide_peak_level: 'safety',
  pm2_5_density: 'safety',
  pm10_density: 'safety',
  voc_density: 'safety',

  // Energy & Usage — what ran, how long, how hard.
  power_state: 'energy',
  active: 'energy',
  in_use: 'energy',
  outlet_in_use: 'energy',
  brightness: 'energy',
  rotation_speed: 'energy',
  current_position: 'energy',
  current_tilt_angle: 'energy',
  hue: 'energy',
  saturation: 'energy',
  color_temperature: 'energy',
  volume: 'energy',
  mute: 'energy',
  current_fan_state: 'energy',
  current_air_purifier_state: 'energy',
  eve_energy_watt: 'energy',
  eve_energy_kwh: 'energy',
  eve_voltage: 'energy',
  eve_ampere: 'energy',

  // Battery.
  battery_level: 'battery',
  status_low_battery: 'battery',
  charging_state: 'battery',

  // Virtual (engine-owned helpers).
  virtual_number: 'virtual',
  virtual_count: 'virtual',
  virtual_mode: 'virtual',
  virtual_timer: 'virtual',
};

// ── Measures ────────────────────────────────────────────────────────────────
//
// A measure is what a chart may mix: one physical quantity, one unit. The
// category views tab by measure ("Temperature | Humidity | Light") instead
// of drawing 89 mixed series on two axes. Registry groups the multi-type
// quantities; anything numeric and unlisted becomes its own singleton
// measure, so the mapping is total by construction (test-enforced).

export interface MeasureMeta {
  id: string;
  title: string;
  unit: string | null;
  types: string[];
}

export const MEASURES: MeasureMeta[] = [
  { id: 'temperature', title: 'Temperature', unit: '°', types: ['current_temperature', 'target_temperature', 'heating_threshold', 'cooling_threshold'] },
  { id: 'humidity', title: 'Humidity', unit: '%', types: ['relative_humidity', 'target_humidity'] },
  { id: 'light', title: 'Light', unit: 'lux', types: ['current_ambient_light_level'] },
  { id: 'co2', title: 'CO₂', unit: 'ppm', types: ['carbon_dioxide_level', 'carbon_dioxide_peak_level'] },
  { id: 'co', title: 'CO', unit: 'ppm', types: ['carbon_monoxide_level', 'carbon_monoxide_peak_level'] },
  { id: 'particulates', title: 'Air particles', unit: 'µg/m³', types: ['pm2_5_density', 'pm10_density', 'voc_density'] },
  { id: 'pressure', title: 'Pressure', unit: 'hPa', types: ['eve_air_pressure'] },
  { id: 'power', title: 'Power', unit: 'W', types: ['eve_energy_watt'] },
  { id: 'energy', title: 'Energy', unit: 'kWh', types: ['eve_energy_kwh'] },
  { id: 'voltage', title: 'Voltage', unit: 'V', types: ['eve_voltage'] },
  { id: 'current', title: 'Current', unit: 'A', types: ['eve_ampere'] },
  { id: 'brightness', title: 'Brightness', unit: '%', types: ['brightness'] },
  { id: 'color', title: 'Color', unit: null, types: ['hue', 'saturation', 'color_temperature'] },
  // "Position" is the HomeKit characteristic's name, not a thing anyone in a
  // house says. What reports it is blinds, shades and sliding doors.
  { id: 'position', title: 'Blinds & doors', unit: '%', types: ['current_position'] },
  { id: 'tilt', title: 'Tilt', unit: '°', types: ['current_tilt_angle'] },
  { id: 'speed', title: 'Speed', unit: '%', types: ['rotation_speed'] },
  { id: 'volume', title: 'Volume', unit: '%', types: ['volume'] },
  { id: 'water', title: 'Water level', unit: '%', types: ['water_level'] },
  { id: 'battery', title: 'Battery', unit: '%', types: ['battery_level'] },
  { id: 'value', title: 'Value', unit: null, types: ['virtual_number'] },
  { id: 'count', title: 'Count', unit: null, types: ['virtual_count'] },
];

const MEASURE_BY_TYPE: Map<string, MeasureMeta> = new Map(
  MEASURES.flatMap(m => m.types.map(t => [t, m] as const)),
);

function prettify(type: string): string {
  return type.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

/** The measure a numeric type charts under — total over numeric profiles. */
export function measureOf(type: string): MeasureMeta {
  const canonical = canonicalHistoryType(type);
  const hit = MEASURE_BY_TYPE.get(canonical);
  if (hit) return hit;
  const profile = getProfile(canonical);
  return { id: canonical, title: prettify(canonical), unit: profile?.unit ?? null, types: [canonical] };
}

/** Distinct measures present among a set of series, registry order first. */
export function measuresIn(series: HistorySeriesInfo[]): MeasureMeta[] {
  const seen = new Map<string, MeasureMeta>();
  for (const s of series) {
    if (s.kind !== 'numeric') continue;
    const m = measureOf(s.characteristicType);
    if (!seen.has(m.id)) seen.set(m.id, m);
  }
  const order = new Map(MEASURES.map((m, i) => [m.id, i]));
  return [...seen.values()].sort((a, b) =>
    (order.get(a.id) ?? MEASURES.length) - (order.get(b.id) ?? MEASURES.length));
}

/**
 * Setpoint/config states — "set to heat mode" — hidden from analytics
 * strips by default: they change when a person changes a setting, so a
 * day's strip is one solid bar saying nothing. What people ask is whether
 * the device WAS heating (heating_cooling_current). Still reachable via
 * Customize → Add series.
 */
export const SETPOINT_STATE_TYPES = new Set([
  'heating_cooling_target',
  'target_heater_cooler_state',
  'security_system_target_state',
]);

/**
 * Numeric setpoints — what the accessory was TOLD to aim for, as opposed to
 * what it measured. They belong on the same axis as the reading (a target of
 * 22° means nothing on a humidity scale) but not with the same weight: they
 * are flat step lines that never move, and drawn as peers they turned a
 * three-sensor Temperature panel into seven competing colours.
 */
export const SETPOINT_NUMERIC_TYPES = new Set([
  'target_temperature',
  'heating_threshold',
  'cooling_threshold',
  'target_relative_humidity',
]);

export function isSetpointType(type: string): boolean {
  return SETPOINT_NUMERIC_TYPES.has(type) || SETPOINT_STATE_TYPES.has(type);
}

/**
 * What a chart may OFFER to draw alongside its own measure.
 *
 * A temperature chart is about temperature; that is why it opens with three
 * lines and not seven. But the question behind a lot of temperature charts is
 * about something else — is the heating chasing a target it can't reach, is
 * the room damp when it's cold, did the lights come on because it got dark.
 * Each of those is one tick, off by default, so the core measure keeps the
 * chart and the context is a decision rather than an ambush.
 */
export interface MeasureComplement {
  id: string;
  label: string;
  /** Canonical characteristic types to overlay. */
  types: string[];
  /** Setpoints draw dashed in their accessory's colour; others go secondary. */
  setpoint?: boolean;
}

export const MEASURE_COMPLEMENTS: Record<string, MeasureComplement[]> = {
  temperature: [
    { id: 'targets', label: 'Targets', types: ['target_temperature', 'heating_threshold', 'cooling_threshold'], setpoint: true },
    { id: 'humidity', label: 'Humidity', types: ['relative_humidity'] },
  ],
  humidity: [
    { id: 'targets', label: 'Targets', types: ['target_humidity'], setpoint: true },
    { id: 'temperature', label: 'Temperature', types: ['current_temperature'] },
  ],
  light: [
    { id: 'lighting', label: 'Lights on', types: ['brightness'] },
  ],
  co2: [
    { id: 'humidity', label: 'Humidity', types: ['relative_humidity'] },
  ],
  power: [
    { id: 'energy', label: 'Energy', types: ['eve_energy_kwh'] },
  ],
  lighting: [
    { id: 'lux', label: 'Lux', types: ['current_ambient_light_level'] },
  ],
};

export type SeriesViz = 'line' | 'strip';

/** How a series draws: numeric kinds as lines, state kinds as strips. */
export function vizFor(type: string): SeriesViz {
  const profile = getProfile(canonicalHistoryType(type));
  return profile?.kind === 'numeric' ? 'line' : 'strip';
}

/**
 * The category a characteristic lands in. A virtual accessory's series is
 * ALWAYS 'virtual' (an input_boolean rides power_state but belongs with its
 * peers, not in Energy).
 */
export function categoryOf(type: string, opts?: { isVirtualAccessory?: boolean }): CategoryId {
  if (opts?.isVirtualAccessory) return 'virtual';
  return CATEGORY_OF[canonicalHistoryType(type)] ?? 'other';
}

/**
 * HomeKit's "Default Room" is where unassigned accessories land — it is a
 * bucket, not a place, and its readings (a boiler cupboard, a spare sensor
 * in a drawer) skew the room picture. Analytics treats it as roomless
 * everywhere: no chip, no room-average line, no entry in the warmest/
 * coolest summary.
 */
export const HIDDEN_ROOM_NAMES = new Set(['default room']);

export function isHiddenRoom(room: string | null | undefined): boolean {
  return !!room && HIDDEN_ROOM_NAMES.has(room.trim().toLowerCase());
}

export interface AccessoryInfoEntry {
  name: string;
  room: string | null;
  isVirtual?: boolean;
  /** resolveWidgetType's answer — what KIND of thing this is, for its icon. */
  widgetType?: string;
}

export interface MonitoringEntry {
  accessoryId: string;
  accessoryName: string;
  room: string | null;
  characteristicType: string;
}

export interface OrganizedGroup {
  id: string;
  name: string;
  memberIds: string[];
  /** The group's own recorded series (group writes record under its id). */
  series: HistorySeriesInfo[];
}

export interface OrganizedCategory {
  id: CategoryId;
  series: HistorySeriesInfo[];
  /** Room name → that room's series; null key = roomless accessories. */
  byRoom: Map<string | null, HistorySeriesInfo[]>;
  accessoryCount: number;
  roomCount: number;
  /** Recordable but nothing recorded yet ("monitoring · no events yet"). */
  monitoring: MonitoringEntry[];
  /** Only on the 'groups' category. */
  groups?: OrganizedGroup[];
}

/**
 * The data spine of the Analytics surface: recorded series (plus recordable-
 * but-silent characteristics) organised into categories and rooms. Pure —
 * inputs come from the host (recorded series query + accessory data the
 * dashboard already holds).
 */
export function organizeRecorded(
  recorded: HistorySeriesInfo[],
  accessoryInfo: Map<string, AccessoryInfoEntry>,
  serviceGroups?: Array<{ id: string; name: string; memberIds: string[] }>,
  recordableByAccessory?: Map<string, string[]>,
): OrganizedCategory[] {
  const groupIds = new Set((serviceGroups ?? []).map(g => g.id.toUpperCase()));
  const categories = new Map<CategoryId, OrganizedCategory>();

  const ensure = (id: CategoryId): OrganizedCategory => {
    let cat = categories.get(id);
    if (!cat) {
      cat = { id, series: [], byRoom: new Map(), accessoryCount: 0, roomCount: 0, monitoring: [] };
      categories.set(id, cat);
    }
    return cat;
  };

  const enabled = recorded.filter(s => s.enabled);
  const recordedKeys = new Set(enabled.map(s => `${s.accessoryId.toUpperCase()}|${s.characteristicType}`));

  for (const s of enabled) {
    const accessoryKey = s.accessoryId.toUpperCase();
    if (groupIds.has(accessoryKey)) continue; // group-id series live under 'groups'
    const info = accessoryInfo.get(accessoryKey);
    const cat = ensure(categoryOf(s.characteristicType, { isVirtualAccessory: info?.isVirtual }));
    cat.series.push(s);
    const room = isHiddenRoom(info?.room) ? null : (info?.room ?? null);
    const list = cat.byRoom.get(room) ?? [];
    list.push(s);
    cat.byRoom.set(room, list);
  }

  // Recordable-but-silent characteristics: real accessories whose profiled
  // characteristics have no series row yet — a quiet smoke alarm must read
  // as "monitoring", not as missing.
  if (recordableByAccessory) {
    for (const [accessoryId, types] of recordableByAccessory) {
      const accessoryKey = accessoryId.toUpperCase();
      if (groupIds.has(accessoryKey)) continue;
      const info = accessoryInfo.get(accessoryKey);
      for (const type of types) {
        const canonical = canonicalHistoryType(type);
        if (recordedKeys.has(`${accessoryKey}|${canonical}`)) continue;
        const cat = ensure(categoryOf(canonical, { isVirtualAccessory: info?.isVirtual }));
        cat.monitoring.push({
          accessoryId,
          accessoryName: info?.name ?? accessoryId,
          room: isHiddenRoom(info?.room) ? null : (info?.room ?? null),
          characteristicType: canonical,
        });
      }
    }
  }

  // Groups category: every service group, with its own recorded series.
  if (serviceGroups && serviceGroups.length > 0) {
    const cat = ensure('groups');
    cat.groups = serviceGroups.map(g => ({
      id: g.id,
      name: g.name,
      memberIds: g.memberIds,
      series: enabled.filter(s => s.accessoryId.toUpperCase() === g.id.toUpperCase()),
    }));
    cat.accessoryCount = serviceGroups.length;
  }

  for (const cat of categories.values()) {
    if (cat.id !== 'groups') {
      cat.accessoryCount = new Set([
        ...cat.series.map(s => s.accessoryId.toUpperCase()),
        ...cat.monitoring.map(m => m.accessoryId.toUpperCase()),
      ]).size;
    }
    cat.roomCount = [...cat.byRoom.keys()].filter(r => r !== null).length;
  }

  return [...categories.values()]
    .filter(cat => cat.series.length > 0 || cat.monitoring.length > 0 || (cat.groups?.length ?? 0) > 0)
    .sort((a, b) => CATEGORIES[a.id].order - CATEGORIES[b.id].order);
}

export { profiledTypes };
