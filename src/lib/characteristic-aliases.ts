// The two names HomeKit answers to, and which one everything else should use.
//
// The native bridge accepts several names for the same characteristic but only
// ever *reports* one of them. `CharacteristicMapper.swift` writes this down
// explicitly: the forward map prefers the shorter name ("on" over
// "power_state"), while the reverse map is pinned to "power_state" so events
// don't come back named differently between launches.
//
// That asymmetry is fine until something compares the two. It cost us the
// automation engine: a client turning on a light announced `on`, HomeKit's
// observer reported `power_state`, and a trigger watching one never saw the
// other — so automations fired from Apple Home and silently did nothing when
// driven from Homecast.
//
// One table, so the write side and the read side cannot drift apart again.

/**
 * Simple/short property name → the canonical name HomeKit events carry.
 *
 * Mirrors `CharacteristicMapper.characteristicMap` on the native side and the
 * cloud server's automation SIMPLE_TO_CHAR. Keep all three in step.
 */
export const SIMPLE_TO_CHAR: Record<string, string> = {
  on: 'power_state',
  active: 'active',
  status_active: 'status_active',
  brightness: 'brightness',
  hue: 'hue',
  saturation: 'saturation',
  color_temp: 'color_temperature',
  current_temp: 'current_temperature',
  heat_target: 'heating_threshold',
  cool_target: 'cooling_threshold',
  target_temp: 'target_temperature',
  locked: 'lock_current_state',
  lock_target: 'lock_target_state',
  alarm_state: 'security_system_current_state',
  alarm_target: 'security_system_target_state',
  motion: 'motion_detected',
  contact: 'contact_state',
  battery: 'battery_level',
  low_battery: 'status_low_battery',
  volume: 'volume',
  mute: 'mute',
  speed: 'rotation_speed',
  target: 'target_position',
  hvac_mode: 'target_heater_cooler_state',
  hvac_state: 'current_heater_cooler_state',
};

/**
 * Every characteristic name the bridge reports is snake_case — all 130 keys of
 * `CharacteristicMapper.characteristicMap`, and every virtual_* name — so a
 * camelCase spelling can only have come from somewhere that camelCases on the
 * way out. The cloud GraphQL layer does exactly that: its MCP surface advertises
 * `virtualMode` and `filterByHome`, so an agent reading it reasonably writes
 * `relativeHumidity`, which then matches no event and no profile.
 *
 * A name already in snake_case has no capitals, so this leaves it alone.
 */
export function snakeCaseProp(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * The name a HomeKit event would use for this characteristic.
 *
 * Anything already canonical passes through untouched, so this is safe to apply
 * to a name of unknown provenance — which is the point, since the caller
 * usually cannot tell which side of the bridge a name came from.
 */
export function canonicalCharacteristic(characteristicType: string): string {
  const alias = SIMPLE_TO_CHAR[characteristicType];
  if (alias) return alias;
  const snake = snakeCaseProp(characteristicType);
  return SIMPLE_TO_CHAR[snake] ?? snake;
}
