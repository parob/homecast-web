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

  // virtual_number / virtual_count / virtual_mode / virtual_timer join here
  // the moment their profiles land — the totality test enforces it.
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

export interface AccessoryInfoEntry {
  name: string;
  room: string | null;
  isVirtual?: boolean;
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
    const room = info?.room ?? null;
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
          room: info?.room ?? null,
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
