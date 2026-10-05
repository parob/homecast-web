// Series identity for characteristic history.
//
// A series is (home, accessory, canonical characteristic type). Two rules,
// both learned the hard way elsewhere in this codebase:
//
//  - Characteristic names must be canonicalised: the bridge accepts `on` but
//    reports `power_state` (see characteristic-aliases.ts) — key on the raw
//    name and the same characteristic lands in two series.
//  - Ids must be case-normalised: HomeKit UUIDs are case-insensitive
//    (RFC 4122) but the relay reports UPPERCASE while cloud caches hold
//    lowercase.

import { canonicalCharacteristic } from '@/lib/characteristic-aliases';
import profilesJson from './profiles.json';

/**
 * Variants seen in the wild that the bridge alias table doesn't cover (it
 * mirrors CharacteristicMapper.swift and must not grow independently). These
 * come from older relays and cloud-cached data — see useSensorAggregation.ts,
 * which matches both forms for the same reason.
 */
const HISTORY_TYPE_ALIASES: Record<string, string> = {
  current_relative_humidity: 'relative_humidity',
  contact_sensor_state: 'contact_state',
};

const PROFILED = (profilesJson as { profiles: Record<string, unknown> }).profiles;
const NON_ALNUM = /[^a-z0-9]/g;

/**
 * Profiled types with the separators taken out. camelCase loses an underscore
 * that sat next to a digit (pm2_5_density → pm25Density), so the last resort
 * compares letters and digits only. Profile keys stay unambiguous under that
 * comparison — pinned in policy.test.ts.
 */
const PROFILE_BY_COMPACT = new Map(
  Object.keys(PROFILED).map((key) => [key.replace(NON_ALNUM, ''), key]),
);

/**
 * Any spelling of a characteristic name → the bridge's snake_case.
 *
 * Everything the bridge reports is snake_case, so a capital or a space can only
 * have come from somewhere that rewrote it: the cloud's MCP descriptions arrive
 * camelCased (`currentTemperature`), and an agent may use HomeKit's own names
 * (`CurrentTemperature`, "Current Temperature",
 * `HMCharacteristicTypeCurrentTemperature`). Lowercasing first — as this used
 * to — erased the humps that say where the words break. Mirrors
 * `canonical_history_type` in homecast-cloud's history/policy.py.
 */
function snakeCaseCharacteristic(name: string): string {
  return name
    .trim()
    .replace(/^HMCharacteristicType/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/** The one name a characteristic's history is keyed by. */
export function canonicalHistoryType(characteristicType: string): string {
  const snake = snakeCaseCharacteristic(characteristicType);
  let canonical = canonicalCharacteristic(snake);
  canonical = HISTORY_TYPE_ALIASES[canonical] ?? canonical;
  if (!Object.prototype.hasOwnProperty.call(PROFILED, canonical)) {
    canonical = PROFILE_BY_COMPACT.get(canonical.replace(NON_ALNUM, '')) ?? canonical;
  }
  return canonical;
}

/** IndexedDB series id. `|` never appears in UUIDs or characteristic names. */
export function seriesKey(homeId: string, accessoryId: string, characteristicType: string): string {
  return `${homeId.toUpperCase()}|${accessoryId.toUpperCase()}|${canonicalHistoryType(characteristicType)}`;
}

export interface SeriesKeyParts {
  homeId: string;
  accessoryId: string;
  characteristicType: string;
}

export function parseSeriesKey(key: string): SeriesKeyParts | null {
  const parts = key.split('|');
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return { homeId: parts[0], accessoryId: parts[1], characteristicType: parts[2] };
}
