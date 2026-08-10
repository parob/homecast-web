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

/** The one name a characteristic's history is keyed by. */
export function canonicalHistoryType(characteristicType: string): string {
  const lowered = characteristicType.toLowerCase();
  const canonical = canonicalCharacteristic(lowered);
  return HISTORY_TYPE_ALIASES[canonical] ?? canonical;
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
