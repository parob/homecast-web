// Helper accessories, expressed as accessories.
//
// A helper accessory is a value the automation engine owns. It is still an
// accessory: it lives in a room, it has a name and a current value, you point a
// scene or a share or a collection at it. So rather than teaching every surface
// about a second kind of thing — the dashboard, sharing, collections, search,
// REST, MQTT, MCP, the widgets — it is published through `accessories.list`
// like everything else, and every one of those gets it for free.
//
// That is the whole design. Anything here that looks like a shim is a bug: the
// only legitimate difference between a helper accessory and a HomeKit one is
// where the read and the write are serviced.

import type { HomeKitAccessory, HomeKitService } from '../native/homekit-bridge';
import type { VirtualAccessoryDefinition } from '../automation/types/automation';
import { getAutomationEngine } from '../automation';

/**
 * The characteristic each helper type carries.
 *
 * Switch and Number reuse names the rest of the stack already understands, so
 * they render, publish and script exactly like the real thing.
 *
 * The other types have no HomeKit analogue — HomeKit has no enum, no countdown
 * and no free text — so they carry their own names. Those are real
 * characteristics on a real accessory, not a side channel: a client that
 * understands `helper_mode` controls it, and one that doesn't still sees a
 * named value it can display, which is what it would do for any characteristic
 * it hasn't been taught.
 */
export const VIRTUAL_CHARACTERISTIC: Record<string, string> = {
  input_boolean: 'power_state',
  input_number: 'helper_number',
  counter: 'helper_count',
  input_select: 'helper_mode',
  timer: 'helper_timer',
  input_text: 'helper_text',
  input_datetime: 'helper_datetime',
};

/** HomeKit-ish category, so category-based sorting and icons have something. */
const VIRTUAL_CATEGORY: Record<string, string> = {
  input_boolean: 'Switch',
  input_number: 'Sensor',
  counter: 'Sensor',
  input_select: 'Other',
  timer: 'Other',
  input_text: 'Other',
  input_datetime: 'Other',
};

const VIRTUAL_SERVICE_TYPE: Record<string, string> = {
  input_boolean: 'switch',
  input_number: 'helper_number',
  counter: 'helper_count',
  input_select: 'helper_mode',
  timer: 'helper_timer',
  input_text: 'helper_text',
  input_datetime: 'helper_datetime',
};

/** Marks an accessory as engine-owned. Clients use it to offer the right UI. */
export const VIRTUAL_ACCESSORY_FLAG = 'isVirtual';

export interface VirtualAccessory extends HomeKitAccessory {
  /** Always true. Absent on HomeKit accessories. */
  isVirtual?: boolean;
  /** The helper's type, so a client can render the right control. */
  helperType?: string;
  /** False when the helper is read-only from the dashboard. */
  isUserEditable?: boolean;
}

/** Build the accessory representation of one helper. */
export function toVirtualAccessory(helper: VirtualAccessoryDefinition, value: unknown): VirtualAccessory {
  const characteristicType = VIRTUAL_CHARACTERISTIC[helper.type] ?? 'helper_value';
  const writable = helper.controllable !== false;

  const service: HomeKitService = {
    id: `${helper.id}:service`,
    name: helper.name,
    serviceType: VIRTUAL_SERVICE_TYPE[helper.type] ?? 'helper',
    characteristics: [
      {
        id: `${helper.id}:${characteristicType}`,
        characteristicType,
        value,
        isReadable: true,
        // Read-only means read-only to *people*. Automations write through the
        // engine, not through this characteristic, so marking it unwritable
        // here does not restrict them — it tells clients not to offer a
        // control, which is exactly what the setting means.
        isWritable: writable,
        ...(helper.type === 'input_select' ? { validValues: undefined } : {}),
        ...(helper.type === 'input_number'
          ? { minValue: helper.min, maxValue: helper.max, stepValue: helper.step }
          : {}),
        ...(helper.type === 'counter'
          ? { minValue: helper.min, maxValue: helper.max, stepValue: helper.step ?? 1 }
          : {}),
      },
    ],
  };

  return {
    id: helper.id,
    name: helper.name,
    homeId: helper.homeId,
    roomId: helper.roomId,
    category: VIRTUAL_CATEGORY[helper.type] ?? 'Other',
    // Engine-owned, so it is reachable exactly when the engine is running —
    // and if the engine weren't running we would not be answering at all.
    isReachable: true,
    services: [service],
    isVirtual: true,
    helperType: helper.type,
    isUserEditable: writable,
    // Options travel on the service name for input_select clients that want
    // them; the canonical list stays in the helper definition.
    ...(helper.type === 'input_select' ? { helperOptions: helper.options } : {}),
  } as VirtualAccessory;
}

/**
 * Every helper accessory the engine currently holds, optionally filtered.
 *
 * `roomNames` supplies the room name for each id, because grouping downstream
 * is by name rather than by id — a real accessory arrives from HomeKit with its
 * `roomName` already filled in, so one built here has to carry it too or it
 * lands in "Unknown Room". A helper with no room deliberately has no roomName:
 * it belongs to the home, not to any part of it.
 */
export function listVirtualAccessories(
  opts: { homeId?: string; roomId?: string; roomNames?: Map<string, string> } = {},
): VirtualAccessory[] {
  const engine = getAutomationEngine();
  if (!engine) return [];

  const states = engine.getVirtualStates();
  const out: VirtualAccessory[] = [];
  for (const helper of engine.virtualManager.getAllVirtualAccessories()) {
    if (opts.homeId && helper.homeId?.toUpperCase() !== opts.homeId.toUpperCase()) continue;
    if (opts.roomId && helper.roomId !== opts.roomId) continue;
    const accessory = toVirtualAccessory(helper, states[helper.id]);
    if (helper.roomId) accessory.roomName = opts.roomNames?.get(helper.roomId);
    out.push(accessory);
  }
  return out;
}

/** The helper behind an accessory id, or undefined if it isn't one. */
export function getVirtualAccessoryDefinition(accessoryId: string): VirtualAccessoryDefinition | undefined {
  return getAutomationEngine()?.getVirtualAccessory(accessoryId);
}

/**
 * The operation that writing `value` to this characteristic means.
 *
 * Everything a client can do to a helper accessory arrives as a characteristic
 * write, because that is the only verb accessories have. Turning that into a
 * helper operation here keeps the whole write path identical to a real
 * accessory's, right up to the point where HomeKit would have been asked.
 */
export function writeToOperation(
  helper: VirtualAccessoryDefinition,
  value: unknown,
): { operation: 'set' | 'turn_on' | 'turn_off' | 'start' | 'cancel'; value?: unknown } {
  if (helper.type === 'input_boolean') {
    return value ? { operation: 'turn_on' } : { operation: 'turn_off' };
  }
  if (helper.type === 'timer') {
    // A timer has no value to set; a client writing to it is starting or
    // stopping the countdown.
    const wantsRun = value === 'active' || value === true || value === 'start';
    return wantsRun ? { operation: 'start' } : { operation: 'cancel' };
  }
  return { operation: 'set', value };
}

/**
 * Service a characteristic write against a helper accessory.
 *
 * Returns the applied value, or `null` when the id isn't a helper — so the
 * caller falls through to HomeKit exactly as before. Kept here rather than in
 * the handler so the handler needs no direct knowledge of the engine: the only
 * thing it has to know is "is this mine, and if so what did it become".
 */
export function applyVirtualWrite(accessoryId: string, value: unknown): { value: unknown } | null {
  const engine = getAutomationEngine();
  const helper = engine?.getVirtualAccessory(accessoryId);
  if (!engine || !helper) return null;

  if (helper.controllable === false) {
    throw Object.assign(new Error(`${helper.name} is read-only`), {
      code: 'CHARACTERISTIC_NOT_WRITABLE',
    });
  }
  const { operation, value: opValue } = writeToOperation(helper, value);
  engine.operateVirtualAccessory(helper.id, operation, { value: opValue });
  return { value: engine.getVirtualStates()[helper.id] };
}

/** Current value of a helper accessory, or null when the id isn't one. */
export function readVirtualValue(accessoryId: string): { value: unknown } | null {
  const engine = getAutomationEngine();
  if (!engine?.getVirtualAccessory(accessoryId)) return null;
  return { value: engine.getVirtualStates()[accessoryId] };
}
