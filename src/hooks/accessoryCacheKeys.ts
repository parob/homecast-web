/**
 * Case-insensitive helpers for the accessory cache.
 *
 * UUIDs are case-insensitive (RFC 4122) but sources disagree on case: the
 * relay/HomeKit cache uses UPPERCASE ids and keys, while the cloud MQTT
 * optimistic echo emits LOWERCASE ones (Python `str(UUID)`). A case-sensitive
 * lookup silently dropped MQTT-initiated single-accessory updates, leaving the
 * tile (and any group derived from it) stale until a refresh.
 *
 * Kept dependency-free so it can be unit-tested without the full hook module.
 */

/** Case-insensitive HomeKit UUID comparison. */
export function sameAccessoryId(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Resolve which `accessories:{homeId}` cache key actually holds data, tolerating
 * UUID case differences. Falls back to the direct key when nothing is cached yet.
 */
export function resolveAccessoriesCacheKey(homeId: string, hasKey: (key: string) => boolean): string {
  const direct = `accessories:${homeId}`;
  if (hasKey(direct)) return direct;
  for (const k of [homeId.toUpperCase(), homeId.toLowerCase()]) {
    const candidate = `accessories:${k}`;
    if (hasKey(candidate)) return candidate;
  }
  return direct;
}
