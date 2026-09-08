/**
 * The Self-Hosted Relay preference, and what a storage wipe must leave alone.
 *
 * The switch in Settings → Device → Relay is stored as one localStorage key on
 * this origin. Absent means ON: a Mac relays unless it has been told not to.
 * Three places wiped the whole store — switching install type, the reset on
 * the login page, and "reset and uninstall" — and each of them silently turned
 * the relay back on. On 2026-09-08 that was the state of Rob's MacBook Pro:
 * no key at all, relaying beside the cloud relay for a month.
 *
 * Everything that reads or writes the preference goes through here, and the
 * wipes call `clearStorageKeeping` so the one decision the user made about
 * this machine survives them.
 */

export const RELAY_DISABLED_KEY = 'homecast-relay-disabled';

/** Keys a full storage wipe keeps. Per-device decisions, not session state. */
export const PRESERVED_ON_CLEAR: readonly string[] = [RELAY_DISABLED_KEY];

function storageOrNull(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // Some contexts throw on the accessor itself (private windows, blocked
    // site data). No storage means no preference: the default, relay on.
    return null;
  }
}

/** Has this Mac been told not to relay? */
export function readRelayDisabled(storage?: Storage): boolean {
  const s = storageOrNull(storage);
  if (!s) return false;
  try {
    return s.getItem(RELAY_DISABLED_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeRelayDisabled(disabled: boolean, storage?: Storage): void {
  const s = storageOrNull(storage);
  if (!s) return;
  try {
    if (disabled) s.setItem(RELAY_DISABLED_KEY, 'true');
    else s.removeItem(RELAY_DISABLED_KEY);
  } catch {
    // Nothing to do: the preference simply does not persist here.
  }
}

/**
 * `storage.clear()` that keeps `keys` (by default the relay preference).
 *
 * Read first, clear, write back: `clear()` is the only way to be sure every
 * other key is gone, and there is no per-key clear.
 */
export function clearStorageKeeping(storage?: Storage, keys: readonly string[] = PRESERVED_ON_CLEAR): void {
  const s = storageOrNull(storage);
  if (!s) return;
  const kept: Array<[string, string]> = [];
  for (const key of keys) {
    try {
      const value = s.getItem(key);
      if (value !== null) kept.push([key, value]);
    } catch {
      // unreadable: nothing to keep
    }
  }
  s.clear();
  for (const [key, value] of kept) {
    try {
      s.setItem(key, value);
    } catch {
      // the wipe still happened, which is the part that must not fail
    }
  }
}
