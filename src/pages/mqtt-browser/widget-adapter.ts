import type { HomeKitAccessory, HomeKitCharacteristic, HomeKitService } from '@/lib/graphql/types';

// MQTT payloads are flat JSON published by the Swift relay's MQTTBridge.
// Canonical mappings live in app-ios-macos/Sources/Server/MQTTBridge.swift,
// CharacteristicMapper.swift, and MQTTDiscovery.swift. This module mirrors
// those mappings 1:1 so the Dashboard's AccessoryWidget can render the data
// and so widget interactions publish payloads the relay actually accepts.

export type InferredType =
  | 'lightbulb' | 'fan' | 'thermostat' | 'lock' | 'outlet' | 'switch'
  | 'speaker' | 'motion_sensor' | 'contact_sensor' | 'occupancy_sensor'
  | 'temperature_sensor' | 'humidity_sensor' | 'multi_sensor'
  | 'window_covering' | 'garage_door' | 'unknown';

interface CharSpec {
  /** Key in the published MQTT JSON payload this spec reads from. */
  mqttKey: string;
  /** HomeKit characteristic type the widget reads (e.g. 'on', 'brightness'). */
  characteristicType: string;
  isWritable: boolean;
  minValue?: number;
  maxValue?: number;
  stepValue?: number;
  /** MQTT key to publish under /set. Defaults to `mqttKey`. */
  writeKey?: string;
  /** Convert published MQTT value → value the widget expects. */
  decode?: (v: unknown) => unknown;
  /** Convert widget callback value → value to publish to MQTT. */
  encode?: (v: unknown) => unknown;
}

// ---- enum mappers ------------------------------------------------------

// Thermostat hvac_mode: relay publishes/accepts strings. The thermostat path
// of ThermostatWidget reads/writes `heating_cooling_target` as a numeric enum
// in THERMOSTAT_MODES order: 0=off, 1=heat, 2=cool, 3=auto.
const HVAC_STR_TO_INT: Record<string, number> = { off: 0, heat: 1, cool: 2, auto: 3 };
const HVAC_INT_TO_STR = ['off', 'heat', 'cool', 'auto'] as const;
const decodeHvacMode = (v: unknown) => typeof v === 'string' ? HVAC_STR_TO_INT[v.toLowerCase()] ?? 0 : Number(v);
const encodeHvacMode = (v: unknown) => HVAC_INT_TO_STR[Number(v)] ?? 'off';

const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const toInt01 = (v: unknown) => toBool(v) ? 1 : 0;

// ---- per-type characteristic specs ------------------------------------

const PER_TYPE: Record<InferredType, CharSpec[]> = {
  lightbulb: [
    { mqttKey: 'on',         characteristicType: 'on', isWritable: true },
    { mqttKey: 'brightness', characteristicType: 'brightness', isWritable: true, minValue: 0, maxValue: 100, stepValue: 1 },
    { mqttKey: 'color_temp', characteristicType: 'color_temperature', isWritable: true, minValue: 50, maxValue: 500, stepValue: 1 },
    { mqttKey: 'hue',        characteristicType: 'hue', isWritable: true, minValue: 0, maxValue: 360, stepValue: 1 },
    { mqttKey: 'saturation', characteristicType: 'saturation', isWritable: true, minValue: 0, maxValue: 100, stepValue: 1 },
  ],
  switch: [
    { mqttKey: 'on', characteristicType: 'on', isWritable: true },
  ],
  outlet: [
    { mqttKey: 'on', characteristicType: 'on', isWritable: true },
  ],
  fan: [
    // Relay publishes `active` as int 0/1. Widget toggles bool — encode back.
    { mqttKey: 'active', characteristicType: 'active', isWritable: true, encode: toInt01 },
    { mqttKey: 'speed',  characteristicType: 'rotation_speed', isWritable: true, minValue: 0, maxValue: 100, stepValue: 1 },
  ],
  thermostat: [
    { mqttKey: 'hvac_mode',         characteristicType: 'heating_cooling_target', isWritable: true, decode: decodeHvacMode, encode: encodeHvacMode },
    { mqttKey: 'active',            characteristicType: 'active', isWritable: true, encode: toInt01 },
    { mqttKey: 'current_temp',      characteristicType: 'current_temperature', isWritable: false },
    { mqttKey: 'heat_target',       characteristicType: 'heating_threshold', isWritable: true, minValue: 10, maxValue: 38, stepValue: 0.5 },
    { mqttKey: 'cool_target',       characteristicType: 'cooling_threshold', isWritable: true, minValue: 10, maxValue: 38, stepValue: 0.5 },
    { mqttKey: 'relative_humidity', characteristicType: 'relative_humidity', isWritable: false },
  ],
  lock: [
    // Relay publishes `locked` (int 0/1) for both read and target — but the
    // widget reads via lock_current_state and writes via lock_target_state.
    // Expose the same payload value under both characteristics so the widget
    // sees writability; writes go back to MQTT key `lock_target` (boolean).
    { mqttKey: 'locked', characteristicType: 'lock_current_state', isWritable: false },
    { mqttKey: 'locked', characteristicType: 'lock_target_state',  isWritable: true, writeKey: 'lock_target', encode: toBool },
  ],
  speaker: [
    { mqttKey: 'on',     characteristicType: 'on', isWritable: true },
    { mqttKey: 'volume', characteristicType: 'volume', isWritable: true, minValue: 0, maxValue: 100, stepValue: 1 },
    { mqttKey: 'mute',   characteristicType: 'mute', isWritable: true },
  ],
  motion_sensor: [
    { mqttKey: 'motion',        characteristicType: 'motion_detected', isWritable: false },
    { mqttKey: 'battery_level', characteristicType: 'battery_level', isWritable: false, minValue: 0, maxValue: 100 },
  ],
  contact_sensor: [
    { mqttKey: 'contact',       characteristicType: 'contact_sensor_state', isWritable: false },
    { mqttKey: 'battery_level', characteristicType: 'battery_level', isWritable: false, minValue: 0, maxValue: 100 },
  ],
  occupancy_sensor: [
    { mqttKey: 'occupancy_detected', characteristicType: 'occupancy_detected', isWritable: false },
  ],
  temperature_sensor: [
    { mqttKey: 'current_temp', characteristicType: 'current_temperature', isWritable: false },
  ],
  humidity_sensor: [
    { mqttKey: 'relative_humidity', characteristicType: 'current_relative_humidity', isWritable: false },
  ],
  multi_sensor: [
    { mqttKey: 'current_temp',      characteristicType: 'current_temperature', isWritable: false },
    { mqttKey: 'relative_humidity', characteristicType: 'current_relative_humidity', isWritable: false },
    { mqttKey: 'battery_level',     characteristicType: 'battery_level', isWritable: false, minValue: 0, maxValue: 100 },
    { mqttKey: 'motion',            characteristicType: 'motion_detected', isWritable: false },
  ],
  window_covering: [
    { mqttKey: 'position', characteristicType: 'current_position', isWritable: true, minValue: 0, maxValue: 100, stepValue: 1, writeKey: 'target' },
  ],
  garage_door: [
    { mqttKey: 'position', characteristicType: 'current_position', isWritable: true, minValue: 0, maxValue: 100, stepValue: 1, writeKey: 'target' },
  ],
  unknown: [],
};

// ---- public API --------------------------------------------------------

export function inferServiceType(payload: Record<string, unknown>): InferredType {
  const has = (k: string) => k in payload;
  if (has('brightness') || has('color_temp') || has('hue') || has('saturation')) return 'lightbulb';
  if (has('speed')) return 'fan';
  if (has('hvac_mode') || has('heat_target') || has('cool_target')) return 'thermostat';
  if (has('locked') || has('lock_target')) return 'lock';
  if (has('volume') || has('mute')) return 'speaker';
  if (has('position') || has('target')) return 'window_covering';
  if (has('motion')) {
    if (has('current_temp') || has('relative_humidity')) return 'multi_sensor';
    return 'motion_sensor';
  }
  if (has('contact')) return 'contact_sensor';
  if (has('occupancy_detected')) return 'occupancy_sensor';
  if (has('current_temp') && has('relative_humidity')) return 'multi_sensor';
  if (has('current_temp')) return 'temperature_sensor';
  if (has('relative_humidity')) return 'humidity_sensor';
  if (has('on') || has('active')) return 'switch';
  return 'unknown';
}

// Translate a widget callback into an MQTT publish: returns the /set key and
// the encoded value, or null if the characteristic isn't writable in this type.
export function mqttPublishFor(
  type: InferredType,
  characteristicType: string,
  value: unknown,
): { key: string; value: unknown } | null {
  const specs = PER_TYPE[type] || [];
  for (const spec of specs) {
    if (spec.characteristicType !== characteristicType) continue;
    if (!spec.isWritable) continue;
    const out = spec.encode ? spec.encode(value) : value;
    return { key: spec.writeKey || spec.mqttKey, value: out };
  }
  return null;
}

// Build a synthetic HomeKitAccessory from an MQTT topic + JSON payload so the
// Dashboard's AccessoryWidget can render and control it.
export function mqttToAccessory(
  topic: string,
  payload: string,
  isReachable: boolean,
): { accessory: HomeKitAccessory; type: InferredType } | null {
  let parsed: Record<string, unknown>;
  try { const v = JSON.parse(payload); parsed = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
  catch { return null; }

  const type = inferServiceType(parsed);
  if (type === 'unknown') return null;
  const specs = PER_TYPE[type];

  const characteristics: HomeKitCharacteristic[] = specs
    .filter(spec => spec.mqttKey in parsed)
    .map(spec => ({
      id: `${topic}:${spec.characteristicType}`,
      characteristicType: spec.characteristicType,
      value: spec.decode ? spec.decode(parsed[spec.mqttKey]) : parsed[spec.mqttKey],
      isReadable: true,
      isWritable: spec.isWritable,
      minValue: spec.minValue,
      maxValue: spec.maxValue,
      stepValue: spec.stepValue,
    }));

  const slug = topic.split('/').pop() || topic;
  const name = slug.replace(/-[a-f0-9]{4,}$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const service: HomeKitService = {
    id: `${topic}:svc`,
    name,
    serviceType: type === 'unknown' ? 'switch' : type,
    characteristics,
  };

  const accessory: HomeKitAccessory = {
    id: topic,
    name,
    isReachable,
    services: [service],
  };

  return { accessory, type };
}
