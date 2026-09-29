import type { HomeKitAccessory, HomeKitCharacteristic, HomeKitService } from '@/lib/graphql/types';

// MQTT payloads are flat JSON published by the bridges (the cloud's
// mqtt/bridge.py and the Mac's MQTTBridge.swift). The simple names map 1:1 to
// the characteristics the relay reports — `_CHAR_TO_SIMPLE` in the cloud,
// `simpleNameMap` in CharacteristicMapper.swift — and this module inverts that
// map, so the Dashboard's AccessoryWidget receives the accessory it would have
// received from the relay and its interactions publish keys the bridge accepts.
//
// A state payload carries values only. What it cannot say — which service each
// key belongs to, its bounds and valid values, who made the accessory — travels
// on the retained `{topic}/info` (see `DeviceInfo`). With it, the accessory is
// built the way the app builds it. Without it (an older bridge, or /info not yet
// received), the service is guessed from the payload's keys.

export type InferredType =
  | 'lightbulb' | 'fan' | 'heater_cooler' | 'thermostat' | 'lock' | 'outlet' | 'switch'
  | 'speaker' | 'motion_sensor' | 'contact_sensor' | 'occupancy_sensor'
  | 'temperature_sensor' | 'humidity_sensor' | 'multi_sensor'
  | 'window_covering' | 'garage_door' | 'security_system'
  | 'virtual_number' | 'virtual_count' | 'virtual_mode'
  | 'virtual_timer' | 'virtual_text' | 'virtual_datetime'
  | 'unknown';

/** The retained `/info` payload. Every field is optional: a key's bounds are
 *  there only when the accessory declares them. */
export interface DeviceInfo {
  category?: string;
  manufacturer?: string;
  model?: string;
  keys?: Record<string, {
    service?: string;
    writable?: boolean;
    min?: number;
    max?: number;
    step?: number;
    valid?: number[];
  }>;
}

/**
 * Virtual accessory types, keyed by the characteristic they carry.
 *
 * A virtual accessory has no HomeKit analogue — no enum, no countdown, no free
 * text — so it publishes under its own key and needs its own widget. Inferring
 * it from the payload key is all MQTT gives us: the definition (a select's
 * options, a timer's duration, a number's bounds) lives in the engine and never
 * reaches the topic. VirtualAccessoryWidget already tolerates all of that being
 * absent, so the control degrades rather than failing to render.
 *
 * A boolean helper is deliberately absent: it publishes plain `on`, which is
 * indistinguishable from a real switch, and renders identically either way.
 */
const VIRTUAL_TYPES: Record<string, { type: InferredType; virtualType: string }> = {
  number:   { type: 'virtual_number',   virtualType: 'input_number' },
  count:    { type: 'virtual_count',    virtualType: 'counter' },
  mode:     { type: 'virtual_mode',     virtualType: 'input_select' },
  timer:    { type: 'virtual_timer',    virtualType: 'timer' },
  text:     { type: 'virtual_text',     virtualType: 'input_text' },
  datetime: { type: 'virtual_datetime', virtualType: 'input_datetime' },
};

interface KeySpec {
  /** Characteristic type the relay reports, which is what the widgets read. */
  characteristicType: string;
  /** Used only without /info — the bridge's /info is the relay's own answer. */
  writable: boolean;
  min?: number;
  max?: number;
  step?: number;
  valid?: number[];
  /** Published MQTT value → value the widget expects. */
  decode?: (v: unknown) => unknown;
  /** Widget callback value → value to publish to MQTT. */
  encode?: (v: unknown) => unknown;
}

// ---- value mappers -----------------------------------------------------

const toBool = (v: unknown) => v === true || v === 1 || v === '1' || v === 'true';
const toInt01 = (v: unknown) => toBool(v) ? 1 : 0;

// Both bridges publish HomeKit's own integers. Words are accepted too because
// the Community bridge has always taken them on /set, so a retained payload
// written by hand can carry them.
const wordsOr = (words: Record<string, number>) => (v: unknown) =>
  typeof v === 'string' && v.toLowerCase() in words ? words[v.toLowerCase()] : v;
const HVAC_MODE_WORDS = { auto: 0, heat: 1, cool: 2 };
const HVAC_STATE_WORDS = { inactive: 0, idle: 1, heating: 2, cooling: 3 };

/** `{ [key]: n }` when v is a real number, `{}` otherwise — so an absent or
 *  malformed field stays absent rather than becoming NaN, which the timer
 *  readout would render as a countdown to nowhere. */
const num = (v: unknown, key: string): Record<string, number> => {
  const n = typeof v === 'number' ? v : Number(v);
  return v === undefined || v === null || !Number.isFinite(n) ? {} : { [key]: n };
};

// ---- the vocabulary ----------------------------------------------------

// Every key either bridge publishes. The defaults are HomeKit's own, for when
// /info has not said otherwise.
const KEYS: Record<string, KeySpec> = {
  on:                 { characteristicType: 'on', writable: true },
  active:             { characteristicType: 'active', writable: true, encode: toInt01 },
  brightness:         { characteristicType: 'brightness', writable: true, min: 0, max: 100, step: 1 },
  color_temp:         { characteristicType: 'color_temperature', writable: true, min: 50, max: 500, step: 1 },
  hue:                { characteristicType: 'hue', writable: true, min: 0, max: 360, step: 1 },
  saturation:         { characteristicType: 'saturation', writable: true, min: 0, max: 100, step: 1 },
  speed:              { characteristicType: 'rotation_speed', writable: true, min: 0, max: 100, step: 1 },
  // Heater/cooler — an air conditioner. Not a thermostat: HomeKit numbers the
  // two services' modes differently, which is why they publish apart.
  current_temp:       { characteristicType: 'current_temperature', writable: false },
  heat_target:        { characteristicType: 'heating_threshold', writable: true, min: 10, max: 38, step: 0.5 },
  cool_target:        { characteristicType: 'cooling_threshold', writable: true, min: 10, max: 38, step: 0.5 },
  hvac_mode:          { characteristicType: 'target_heater_cooler_state', writable: true, min: 0, max: 2, step: 1, valid: [0, 1, 2], decode: wordsOr(HVAC_MODE_WORDS) },
  hvac_state:         { characteristicType: 'current_heater_cooler_state', writable: false, decode: wordsOr(HVAC_STATE_WORDS) },
  swing_mode:         { characteristicType: 'swing_mode', writable: true, valid: [0, 1] },
  // Thermostat
  target_temp:        { characteristicType: 'target_temperature', writable: true, min: 10, max: 38, step: 0.5 },
  thermostat_mode:    { characteristicType: 'heating_cooling_target', writable: true, valid: [0, 1, 2, 3] },
  thermostat_state:   { characteristicType: 'heating_cooling_current', writable: false },
  relative_humidity:  { characteristicType: 'relative_humidity', writable: false },
  // Coverings. `position` is where it is and `target` where it is going — the
  // widget draws from the first and writes the second.
  position:           { characteristicType: 'current_position', writable: false, min: 0, max: 100, step: 1 },
  target:             { characteristicType: 'target_position', writable: true, min: 0, max: 100, step: 1 },
  position_state:     { characteristicType: 'position_state', writable: false },
  obstruction:        { characteristicType: 'obstruction_detected', writable: false },
  // Lock: writes go to lock_target as a boolean, which both bridges accept.
  locked:             { characteristicType: 'lock_current_state', writable: false },
  lock_target:        { characteristicType: 'lock_target_state', writable: true, encode: toBool },
  alarm_state:        { characteristicType: 'security_system_current_state', writable: false },
  alarm_target:       { characteristicType: 'security_system_target_state', writable: true },
  volume:             { characteristicType: 'volume', writable: true, min: 0, max: 100, step: 1 },
  mute:               { characteristicType: 'mute', writable: true },
  motion:             { characteristicType: 'motion_detected', writable: false },
  contact:            { characteristicType: 'contact_state', writable: false },
  occupancy_detected: { characteristicType: 'occupancy_detected', writable: false },
  battery:            { characteristicType: 'battery_level', writable: false, min: 0, max: 100 },
  low_battery:        { characteristicType: 'status_low_battery', writable: false },
  // Each virtual accessory carries exactly one characteristic, named the same
  // as the widget reads it, and every one of them is writable — a helper exists
  // to be set.
  number:             { characteristicType: 'virtual_number', writable: true },
  count:              { characteristicType: 'virtual_count', writable: true, step: 1 },
  mode:               { characteristicType: 'virtual_mode', writable: true },
  timer:              { characteristicType: 'virtual_timer', writable: true },
  text:               { characteristicType: 'virtual_text', writable: true },
  datetime:           { characteristicType: 'virtual_datetime', writable: true },
};

const KEY_FOR_CHARACTERISTIC: Record<string, string> = Object.fromEntries(
  Object.entries(KEYS).map(([key, spec]) => [spec.characteristicType, key]),
);

// ---- public API --------------------------------------------------------

/** The service a payload most likely belongs to, from its keys alone. Only the
 *  fallback when there is no /info — and what the tree's row icon uses. */
export function inferServiceType(payload: Record<string, unknown>, info?: DeviceInfo | null): InferredType {
  const has = (k: string) => k in payload;
  // Virtual accessories first, even over /info. Their keys are unique in the
  // bridge's whole vocabulary, a helper publishes nothing else, and the widget
  // is chosen off a service type starting "virtual" — which is what these are.
  for (const [key, spec] of Object.entries(VIRTUAL_TYPES)) {
    if (has(key)) return spec.type;
  }
  const fromInfo = primaryServiceFromInfo(info);
  if (fromInfo) return fromInfo as InferredType;

  if (has('brightness') || has('color_temp') || has('hue') || has('saturation')) return 'lightbulb';
  // Before `speed`: an air conditioner has a fan speed too, and it is not a fan.
  if (has('hvac_mode') || has('hvac_state') || has('heat_target') || has('cool_target')) return 'heater_cooler';
  if (has('thermostat_mode') || has('thermostat_state') || has('target_temp')) return 'thermostat';
  if (has('speed')) return 'fan';
  if (has('locked') || has('lock_target')) return 'lock';
  if (has('alarm_state') || has('alarm_target')) return 'security_system';
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

// Services that ride along with the one the accessory is for.
const SECONDARY_SERVICES = new Set(['battery', 'accessory_information']);

function primaryServiceFromInfo(info?: DeviceInfo | null): string | null {
  const services = Object.values(info?.keys ?? {}).map(k => k.service).filter((s): s is string => !!s);
  return services.find(s => !SECONDARY_SERVICES.has(s)) ?? services[0] ?? null;
}

/** Parse a retained `/info` message; null for anything that is not one. */
export function parseDeviceInfo(payload: string | undefined | null): DeviceInfo | null {
  if (!payload) return null;
  try {
    const v = JSON.parse(payload);
    return v && typeof v === 'object' && !Array.isArray(v) ? v as DeviceInfo : null;
  } catch { return null; }
}

// Translate a widget callback into an MQTT publish: returns the /set key and
// the encoded value, or null if the characteristic isn't writable here.
export function mqttPublishFor(
  accessory: HomeKitAccessory,
  characteristicType: string,
  value: unknown,
): { key: string; value: unknown } | null {
  const char = accessory.services?.flatMap(s => s.characteristics ?? [])
    .find(c => c.characteristicType === characteristicType);
  if (!char?.isWritable) return null;
  const key = KEY_FOR_CHARACTERISTIC[characteristicType];
  if (!key) return null;
  const encode = KEYS[key].encode;
  return { key, value: encode ? encode(value) : value };
}

// Build a synthetic HomeKitAccessory from an MQTT topic + JSON payload (plus
// its /info, when the bridge published one) so the Dashboard's AccessoryWidget
// can render and control it.
export function mqttToAccessory(
  topic: string,
  payload: string,
  isReachable: boolean,
  info?: DeviceInfo | null,
): { accessory: HomeKitAccessory; type: InferredType } | null {
  let parsed: Record<string, unknown>;
  try { const v = JSON.parse(payload); parsed = (v && typeof v === 'object' && !Array.isArray(v)) ? v : {}; }
  catch { return null; }

  const type = inferServiceType(parsed, info);
  if (type === 'unknown') return null;

  const slug = topic.split('/').pop() || topic;
  const name = slug.replace(/-[a-f0-9]{4,}$/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // One service per service type /info names; without it, everything lands on
  // the guessed one — the widgets look characteristics up across all services,
  // so only the service *types* decide which widget draws it.
  const services = new Map<string, HomeKitService>();
  const serviceFor = (serviceType: string) => {
    let svc = services.get(serviceType);
    if (!svc) {
      svc = { id: `${topic}:${serviceType}`, name, serviceType, characteristics: [] };
      services.set(serviceType, svc);
    }
    return svc;
  };
  serviceFor(type);

  const add = (serviceType: string, char: Omit<HomeKitCharacteristic, 'id' | 'isReadable'>) => {
    serviceFor(serviceType).characteristics.push({
      id: `${topic}:${char.characteristicType}`, isReadable: true, ...char,
    });
  };

  const virtual = Object.values(VIRTUAL_TYPES).find(v => v.type === type);

  for (const [key, raw] of Object.entries(parsed)) {
    const spec = KEYS[key];
    if (!spec) continue;
    const meta = info?.keys?.[key];
    add(virtual ? type : meta?.service || type, {
      characteristicType: spec.characteristicType,
      value: spec.decode ? spec.decode(raw) : raw,
      isWritable: meta ? !!meta.writable : spec.writable,
      minValue: meta?.min ?? spec.min,
      maxValue: meta?.max ?? spec.max,
      stepValue: meta?.step ?? spec.step,
      validValues: meta?.valid ?? spec.valid,
    });
  }

  // Without /info there is no telling what is writable, and an older bridge
  // published only where a covering or lock *is*. Offer the target from it, so
  // the widget still has something to move — /info, where present, is the
  // relay's own answer and needs no guess.
  if (!info) {
    if ('position' in parsed && !('target' in parsed)) {
      add(type, { characteristicType: 'target_position', value: parsed.position, isWritable: true, minValue: 0, maxValue: 100, stepValue: 1 });
    }
    if ('locked' in parsed && !('lock_target' in parsed)) {
      add(type, { characteristicType: 'lock_target_state', value: parsed.locked, isWritable: true });
    }
  }

  // Who made it decides how some widgets read a value — a blind's 0 is closed
  // for Eve and Lutron and open for most others — so it goes where the widget
  // looks for it, exactly as the relay reports it.
  for (const k of ['manufacturer', 'model'] as const) {
    if (info?.[k]) add('accessory_information', { characteristicType: k, value: info[k], isWritable: false });
  }

  const accessory: HomeKitAccessory = {
    id: topic,
    name,
    isReachable,
    ...(info?.category ? { category: info.category } : {}),
    services: [...services.values()],
  };

  if (virtual) {
    Object.assign(accessory, {
      isVirtual: true,
      virtualType: virtual.virtualType,
      // The definition lives in the engine and never reaches MQTT, so options,
      // bounds and duration are unknown here. The widget treats each as
      // optional; what it must not do is decide the helper is read-only.
      isUserEditable: true,
      // A countdown's state IS its value over MQTT, so the widget's running
      // check is fed from it. When it ends is separate: the bridge publishes
      // absolute instants alongside, because a remaining span is only true at
      // the moment it is measured and a retained payload is read long after.
      // Without these the tile can say "active" and nothing more.
      ...(type === 'virtual_timer'
        ? {
          virtualTimerState: String(parsed.timer ?? 'idle'),
          ...num(parsed.timer_started_at, 'virtualStartedAt'),
          ...num(parsed.timer_ends_at, 'virtualEndsAt'),
          ...num(parsed.timer_duration_ms, 'virtualDurationMs'),
          ...num(parsed.timer_finished_at, 'virtualFinishedAt'),
        }
        : {}),
    });
  }

  return { accessory, type };
}
