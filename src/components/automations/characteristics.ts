// Shared characteristic metadata for device-action editors (scenes, automations).
//
// HomeKit hands us raw characteristic types (`power_state`, `heating_cooling_target`)
// with loose metadata. These helpers turn that into something a form can render:
// a friendly label, a control kind, and named options for the enum types.

import { charLabel, formatValue } from './format';
import { parseCharacteristicValue } from '@/components/widgets/types';
import { getProfile as getHistoryProfile } from '@/history/policy';
import { canonicalHistoryType } from '@/history/keys';
import type { HvacMode } from '@/history/categories';
import type { HomeKitAccessory, HomeKitCharacteristic } from '@/lib/graphql/types';

/** Internal/metadata characteristics that shouldn't appear in trigger/condition/action pickers */
const HIDDEN_CHAR_TYPES = new Set([
  'name', 'configured_name', 'manufacturer', 'model', 'serial_number', 'firmware_revision',
  'hardware_revision', 'identify', 'label_index', 'label_namespace',
  'thread_status', 'current_transport', 'wifi_capabilities',
  'eve_set_time', 'eve_history_status', 'eve_history_request', 'eve_history_entries',
]);

export function isHiddenChar(type: string): boolean {
  return HIDDEN_CHAR_TYPES.has(type) || type.includes('-0000-1000-8000-0026BB765291');
}

/**
 * Characteristics whose 0/1 values read as on/off. HomeKit often omits
 * `validValues` entirely, so the name is the only signal we get.
 */
const BOOLEAN_CHAR_TYPES = new Set([
  'power_state', 'on', 'active', 'mute', 'night_vision', 'hold_position', 'status_active',
  'in_use', 'outlet_in_use', 'obstruction_detected', 'motion_detected', 'occupancy_detected',
  'smoke_detected', 'carbon_monoxide_detected', 'carbon_dioxide_detected', 'leak_detected',
  'status_fault', 'status_tampered', 'status_low_battery', 'is_configured',
  'homekit_camera_active', 'third_party_camera_active', 'event_snapshots_active',
  'periodic_snapshots_active', 'recording_audio_active', 'manually_disabled',
]);

/**
 * Value labels for HomeKit's enumerated characteristics, keyed by the
 * snake_case type the relay emits (see CharacteristicMapper.swift).
 */
export const ENUM_LABELS: Record<string, Record<number, string>> = {
  lock_target_state: { 0: 'Unlocked', 1: 'Locked' },
  lock_current_state: { 0: 'Unlocked', 1: 'Locked', 2: 'Jammed', 3: 'Unknown' },
  lock_physical_controls: { 0: 'Unlocked', 1: 'Locked' },
  target_door_state: { 0: 'Open', 1: 'Closed' },
  current_door_state: { 0: 'Open', 1: 'Closed', 2: 'Opening', 3: 'Closing', 4: 'Stopped' },
  heating_cooling_target: { 0: 'Off', 1: 'Heat', 2: 'Cool', 3: 'Auto' },
  // A CURRENT state is an activity, so "Heating", not the mode word "Heat";
  // and 0/1 are HAP's "Inactive"/"Idle", which to a person are the same word
  // twice. Must stay in step with ENUM_STATE_LABELS in history/labels.ts —
  // this table dresses an accessory's live characteristics, that one dresses
  // stored history, and the two meet on one screen. Pinned by labels.test.ts.
  heating_cooling_current: { 0: 'Off', 1: 'Heating', 2: 'Cooling' },
  target_heater_cooler_state: { 0: 'Auto', 1: 'Heat', 2: 'Cool' },
  current_heater_cooler_state: { 0: 'Off', 1: 'Standby', 2: 'Heating', 3: 'Cooling' },
  target_fan_state: { 0: 'Manual', 1: 'Auto' },
  current_fan_state: { 0: 'Off', 1: 'Standby', 2: 'Blowing' },
  target_air_purifier_state: { 0: 'Manual', 1: 'Auto' },
  current_air_purifier_state: { 0: 'Off', 1: 'Standby', 2: 'Purifying' },
  target_humidifier_dehumidifier_state: { 0: 'Auto', 1: 'Humidify', 2: 'Dehumidify' },
  current_humidifier_dehumidifier_state: { 0: 'Off', 1: 'Standby', 2: 'Humidifying', 3: 'Dehumidifying' },
  security_system_target_state: { 0: 'Home', 1: 'Away', 2: 'Night', 3: 'Off' },
  security_system_current_state: { 0: 'Home', 1: 'Away', 2: 'Night', 3: 'Off', 4: 'Triggered' },
  swing_mode: { 0: 'Off', 1: 'On' },
  rotation_direction: { 0: 'Clockwise', 1: 'Anticlockwise' },
  temperature_units: { 0: 'Celsius', 1: 'Fahrenheit' },
  position_state: { 0: 'Closing', 1: 'Opening', 2: 'Stopped' },
  charging_state: { 0: 'Not charging', 1: 'Charging', 2: 'Not chargeable' },
  program_mode: { 0: 'No program', 1: 'Scheduled', 2: 'Manual' },
  air_quality: { 0: 'Unknown', 1: 'Excellent', 2: 'Good', 3: 'Fair', 4: 'Inferior', 5: 'Poor' },
};

/** Units shown next to a numeric value */
const CHAR_UNITS: Record<string, string> = {
  brightness: '%', rotation_speed: '%', volume: '%', battery_level: '%', water_level: '%',
  target_humidity: '%', relative_humidity: '%', current_position: '%', target_position: '%',
  saturation: '%',
  current_temperature: '°', target_temperature: '°', heating_threshold: '°', cooling_threshold: '°',
  hue: '°', current_tilt_angle: '°', target_tilt_angle: '°',
  current_horizontal_tilt: '°', target_horizontal_tilt: '°',
  current_vertical_tilt: '°', target_vertical_tilt: '°',
  current_ambient_light_level: 'lux', eve_air_pressure: 'hPa',
  eve_energy_watt: 'W', eve_energy_kwh: 'kWh', eve_voltage: 'V', eve_ampere: 'A',
};

/**
 * Order used to pick a device's headline characteristic — the one pre-filled
 * when it's added to a scene, so "add six lights" needs no further clicks.
 */
const PRIMARY_CHAR_ORDER = [
  'power_state', 'on', 'active', 'target_position', 'lock_target_state', 'target_door_state',
  'security_system_target_state', 'heating_cooling_target', 'target_heater_cooler_state',
  'target_temperature', 'brightness', 'rotation_speed', 'target_humidity', 'volume',
];

export type CharKind = 'boolean' | 'enum' | 'range' | 'number';

export interface CharOption {
  value: number;
  label: string;
}

export interface WritableChar {
  type: string;
  /** Human-readable name, e.g. "Brightness" */
  label: string;
  kind: CharKind;
  /** Present when `kind === 'enum'` */
  options?: CharOption[];
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  /** The device's current value, parsed — used to seed a new action */
  currentValue?: unknown;
}

/**
 * HomeKit UUIDs are case-insensitive. The relay reports uppercase UUIDs while
 * cloud-cached automation data may contain lowercase UUIDs, so never resolve
 * an accessory with a case-sensitive comparison in an editor.
 */
export function findAccessoryById(accessories: HomeKitAccessory[], accessoryId: string | undefined): HomeKitAccessory | undefined {
  if (!accessoryId) return undefined;
  const normalizedId = accessoryId.toLowerCase();
  return accessories.find(accessory => accessory.id.toLowerCase() === normalizedId);
}

function classify(char: HomeKitCharacteristic): CharKind {
  const type = char.characteristicType;
  const valid = char.validValues;

  // Named enums win: a lock's 0/1 means Unlocked/Locked, not off/on.
  if (ENUM_LABELS[type]) return 'enum';
  if (BOOLEAN_CHAR_TYPES.has(type)) return 'boolean';
  if (valid && valid.length === 2 && valid.includes(0) && valid.includes(1)) return 'boolean';
  if (valid && valid.length > 0) return 'enum';
  if (char.minValue != null && char.maxValue != null) return 'range';
  return 'number';
}

function optionsFor(char: HomeKitCharacteristic): CharOption[] {
  const labels = ENUM_LABELS[char.characteristicType];
  // HomeKit only reports validValues for some accessories — fall back to every
  // value we have a name for, rather than showing an empty picker.
  const values = char.validValues?.length
    ? char.validValues
    : labels
      ? Object.keys(labels).map(Number)
      : [];
  return values.map(v => ({ value: v, label: labels?.[v] ?? String(v) }));
}

function toWritableChar(char: HomeKitCharacteristic): WritableChar {
  const kind = classify(char);
  return {
    type: char.characteristicType,
    label: charLabel(char.characteristicType),
    kind,
    options: kind === 'enum' ? optionsFor(char) : undefined,
    min: char.minValue ?? undefined,
    max: char.maxValue ?? undefined,
    step: char.stepValue ?? undefined,
    unit: CHAR_UNITS[char.characteristicType],
    currentValue: parseCharacteristicValue(char.value),
  };
}

/**
 * Every writable characteristic on an accessory, deduped by type (the relay
 * resolves a scene action to the first characteristic of that type) and with
 * internal/metadata entries stripped.
 */
export function getWritableCharacteristics(accessory: HomeKitAccessory | undefined): WritableChar[] {
  if (!accessory) return [];
  const chars: WritableChar[] = [];
  const seen = new Set<string>();
  for (const service of accessory.services ?? []) {
    for (const char of service.characteristics ?? []) {
      if (!char.isWritable || isHiddenChar(char.characteristicType) || seen.has(char.characteristicType)) continue;
      seen.add(char.characteristicType);
      chars.push(toWritableChar(char));
    }
  }
  return chars;
}

/**
 * Every characteristic on an accessory that history can record — the
 * read-only sibling of getWritableCharacteristics. History mostly wants
 * exactly what that function filters out: sensors report, they don't accept
 * writes. "Recordable" means "has a recording profile" (history/profiles.json
 * is an allow-list), deduped by canonical name so `on` and `power_state`
 * present as one entry.
 */
export function getRecordableCharacteristics(accessory: HomeKitAccessory | undefined): WritableChar[] {
  if (!accessory) return [];
  const chars: WritableChar[] = [];
  const seen = new Set<string>();
  for (const service of accessory.services ?? []) {
    for (const char of service.characteristics ?? []) {
      const canonical = canonicalHistoryType(char.characteristicType);
      if (seen.has(canonical) || isHiddenChar(char.characteristicType) || !getHistoryProfile(canonical)) continue;
      seen.add(canonical);
      chars.push({ ...toWritableChar(char), type: canonical });
    }
  }
  return chars;
}

/**
 * Which setpoint a climate accessory is currently aiming at.
 *
 * A heater-cooler carries BOTH a heating and a cooling threshold whatever mode
 * it is in, so the two are only distinguishable by the mode: an air
 * conditioner set to Cool still reports a heating threshold, and charting it
 * draws a flat line that commands nothing. Auto (and anything unreadable)
 * answers 'both' — in Auto both thresholds genuinely govern.
 *
 * Reads the two mode characteristics in HomeKit's own vocabularies, which
 * disagree: HeaterCooler's target_heater_cooler_state is 0 Auto / 1 Heat /
 * 2 Cool, Thermostat's heating_cooling_target is 0 Off / 1 Heat / 2 Cool /
 * 3 Auto. Same numbers, different meanings for 0.
 */
export function hvacModeOf(accessory: HomeKitAccessory | undefined): HvacMode | undefined {
  if (!accessory) return undefined;
  const valueOf = (type: string): number | undefined => {
    for (const service of accessory.services ?? []) {
      for (const char of service.characteristics ?? []) {
        if (canonicalHistoryType(char.characteristicType) !== type) continue;
        const value = Number(char.value);
        if (Number.isFinite(value)) return value;
      }
    }
    return undefined;
  };
  const heaterCooler = valueOf('target_heater_cooler_state');
  if (heaterCooler !== undefined) {
    return heaterCooler === 1 ? 'heat' : heaterCooler === 2 ? 'cool' : 'both';
  }
  const thermostat = valueOf('heating_cooling_target');
  if (thermostat !== undefined) {
    return thermostat === 1 ? 'heat' : thermostat === 2 ? 'cool' : 'both';
  }
  return undefined;
}

/**
 * Importance order for HISTORY display — what a person opens the chart for,
 * first. Environment readings and levels lead, control states follow,
 * battery housekeeping last. Types not listed keep their service order
 * after everything listed.
 */
export const HISTORY_CHAR_ORDER = [
  // Environment readings — the reason most history exists.
  'current_temperature', 'relative_humidity', 'current_ambient_light_level',
  'carbon_dioxide_level', 'carbon_monoxide_level', 'pm2_5_density', 'pm10_density', 'voc_density',
  'air_quality', 'eve_air_pressure', 'water_level',
  // Power and energy levels.
  'eve_energy_watt', 'eve_energy_kwh', 'eve_voltage', 'eve_ampere',
  // Setpoints and HVAC state. Both service shapes: a Thermostat aims at
  // target_temperature, a HeaterCooler has no such characteristic and aims at
  // heating_threshold/cooling_threshold instead. Listing only the Thermostat
  // spellings ranked every air conditioner's setpoints below battery
  // housekeeping — and behind HistoryDialog's "Show more" fold.
  'target_temperature', 'heating_threshold', 'cooling_threshold',
  'heating_cooling_current', 'heating_cooling_target',
  'current_heater_cooler_state', 'target_heater_cooler_state',
  // Activity events.
  'motion_detected', 'occupancy_detected', 'contact_state', 'current_door_state',
  'lock_current_state', 'obstruction_detected',
  // Safety events.
  'smoke_detected', 'carbon_monoxide_detected', 'carbon_dioxide_detected', 'leak_detected',
  // Control states and levels.
  'power_state', 'brightness', 'active', 'in_use', 'outlet_in_use',
  'rotation_speed', 'current_position',
  // Battery housekeeping.
  'battery_level', 'status_low_battery', 'charging_state',
];

/** Stable sort by HISTORY_CHAR_ORDER; unlisted types keep service order after. */
export function sortByHistoryImportance(chars: WritableChar[]): WritableChar[] {
  const rank = new Map(HISTORY_CHAR_ORDER.map((type, i) => [type, i]));
  return [...chars].sort((a, b) =>
    (rank.get(a.type) ?? HISTORY_CHAR_ORDER.length) - (rank.get(b.type) ?? HISTORY_CHAR_ORDER.length));
}

/** The characteristic a device should default to when it joins a scene. */
export function primaryWritableChar(chars: WritableChar[]): WritableChar | undefined {
  for (const type of PRIMARY_CHAR_ORDER) {
    const match = chars.find(c => c.type === type);
    if (match) return match;
  }
  return chars[0];
}

/**
 * Seed value for a newly added action. Devices join a scene switched on, at
 * whatever level they're already set to — the same starting point Apple Home
 * uses, and one tap from the opposite.
 */
export function defaultValueFor(char: WritableChar | undefined): unknown {
  if (!char) return null;
  switch (char.kind) {
    case 'boolean':
      return true;
    case 'enum': {
      const current = Number(char.currentValue);
      if (char.options?.some(o => o.value === current)) return current;
      return char.options?.[0]?.value ?? 0;
    }
    case 'range': {
      const current = Number(char.currentValue);
      if (Number.isFinite(current) && current > (char.min ?? 0)) return current;
      return char.max ?? char.min ?? 0;
    }
    default: {
      const current = Number(char.currentValue);
      return Number.isFinite(current) ? current : (char.min ?? 0);
    }
  }
}

/**
 * Compact "80%" / "Locked" style summary of a configured action's value.
 *
 * `fallbackType` is the characteristic type the action itself names, used when
 * the accessory it belongs to isn't in the list and so `char` is undefined.
 * Without it a power state reads as a bare "0" rather than "Off".
 */
export function describeValue(char: WritableChar | undefined, value: unknown, fallbackType?: string): string {
  if (char?.kind === 'boolean') return value === true || value === 1 ? 'On' : 'Off';
  if (char?.kind === 'enum') {
    const option = char.options?.find(o => o.value === Number(value));
    if (option) return option.label;
  }
  return formatValue(value, char?.type ?? fallbackType) || '—';
}
