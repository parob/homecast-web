/**
 * Stable identity for "this device" in the push notification system.
 *
 * The fingerprint is the key the server stores push tokens and per-device
 * notification mutes under, so it must survive APNs/FCM token rotation —
 * the old Mac fingerprint was derived from the APNs token itself, so every
 * rotation minted a "new device" and left a stale row receiving duplicates.
 *
 * Platforms that can register for push:
 *   - Mac app (WKWebView): `macos-<uuid>` persisted in localStorage
 *   - Android (Tauri shell): `android-<uuid>` — keeps the pre-existing key
 *     and format so devices registered before this helper keep their identity
 *   - Browser / iOS app: none today (no push path) → null
 */

const MACOS_FINGERPRINT_KEY = 'homecast-device-fingerprint';
// Legacy key name — renaming would orphan existing Android registrations.
const ANDROID_FINGERPRINT_KEY = 'homecast-android-fingerprint';

export type DevicePlatform = 'macos' | 'android';

interface DeviceWindow {
  isHomecastMacApp?: boolean;
  isHomecastIOSApp?: boolean;
  isHomecastAndroidApp?: boolean;
  webkit?: { messageHandlers?: { homecast?: unknown } };
}

/** Which push-capable platform this WebView runs in, if any. */
export function getDevicePlatform(): DevicePlatform | null {
  const w = window as DeviceWindow;
  if (w.isHomecastAndroidApp) return 'android';
  // Same detection main.tsx uses for native styling: older Mac app builds may
  // not inject the flag but always expose the message handler.
  if (w.isHomecastMacApp || (w.webkit?.messageHandlers?.homecast && !w.isHomecastIOSApp)) {
    return 'macos';
  }
  return null;
}

/**
 * The stable fingerprint identifying this device, or null when this platform
 * has no push path (plain browser, iOS app today). Created on first use.
 */
export function getDeviceFingerprint(): string | null {
  const platform = getDevicePlatform();
  if (!platform) return null;
  const key = platform === 'android' ? ANDROID_FINGERPRINT_KEY : MACOS_FINGERPRINT_KEY;
  try {
    let fingerprint = localStorage.getItem(key);
    if (!fingerprint) {
      fingerprint = `${platform}-${crypto.randomUUID()}`;
      localStorage.setItem(key, fingerprint);
    }
    return fingerprint;
  } catch {
    return null;
  }
}
