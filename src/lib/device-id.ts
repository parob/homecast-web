/**
 * Where this device's id lives, and how to read it without minting one.
 *
 * `ServerConnection.getDeviceId()` owns *creating* the id — it picks the
 * `mac_` / `web_` prefix from relay capability and migrates an id whose prefix
 * no longer matches. This module owns only the **key** and a **read-only**
 * accessor, so that something which merely wants to label itself can do so
 * without pulling in `server/connection.ts`.
 *
 * That import direction is the whole reason this file exists: `connection.ts`
 * imports `lib/browser-logger`, so the logger cannot import `connection.ts`
 * back. Before this, the alternative was for the logger to hardcode the same
 * string — which is precisely the silent divergence parob/homecast-web#109 was
 * filed about, where two near-identically-named `getBrowserSessionId()`
 * functions drifted apart on one character of storage key and one whole
 * behaviour.
 */

/** The localStorage key `ServerConnection.getDeviceId()` writes. */
export const DEVICE_ID_STORAGE_KEY = 'homecast-device-id';

/**
 * This device's id, or `null` if one has not been minted yet.
 *
 * **Never mints one.** A caller that only wants to label a log line must not
 * decide this device's identity as a side effect — `getDeviceId()` picks the
 * prefix from relay capability, and running it too early in boot (before the
 * native globals land) would persist a `web_` id for a Mac and leave it there.
 * Returning `null` for the first few log lines of a cold start is the correct
 * trade.
 */
export function readDeviceId(): string | null {
  try {
    return localStorage.getItem(DEVICE_ID_STORAGE_KEY);
  } catch {
    // Private mode, or storage blocked. Not worth a log line from inside the
    // logger.
    return null;
  }
}
