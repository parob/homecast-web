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
 *   - iOS app (WKWebView): `ios-<uuid>` — only once the app is new enough to
 *     expose the native push bridge (see below)
 *   - Android (Tauri shell): `android-<uuid>` — keeps the pre-existing key
 *     and format so devices registered before this helper keep their identity
 *   - Plain browser, Tauri desktop shells: none → null
 */
import { useEffect, useRef, useState } from 'react';

const MACOS_FINGERPRINT_KEY = 'homecast-device-fingerprint';
// Legacy key name — renaming would orphan existing Android registrations.
const ANDROID_FINGERPRINT_KEY = 'homecast-android-fingerprint';
const IOS_FINGERPRINT_KEY = 'homecast-ios-fingerprint';

export type DevicePlatform = 'macos' | 'ios' | 'android';

const FINGERPRINT_KEYS: Record<DevicePlatform, string> = {
  macos: MACOS_FINGERPRINT_KEY,
  ios: IOS_FINGERPRINT_KEY,
  android: ANDROID_FINGERPRINT_KEY,
};

interface DeviceWindow {
  isHomecastMacApp?: boolean;
  isHomecastIOSApp?: boolean;
  isHomecastAndroidApp?: boolean;
  homekit?: unknown;
  HomecastAndroidPush?: unknown;
  HomecastAndroid?: unknown;
  webkit?: { messageHandlers?: { homecast?: unknown } };
}

/** Which push-capable platform this WebView runs in, if any. */
export function getDevicePlatform(): DevicePlatform | null {
  const w = window as DeviceWindow;

  // Android first, and keyed on the JavaScript interfaces rather than the flag.
  // `HomecastAndroidPush` is an addJavascriptInterface registered at WebView
  // creation (MainActivity.kt), so it exists at first render — whereas Tauri
  // injects `isHomecastAndroidApp` on PageLoadEvent::Started, which lands after
  // React mounts. AppHeader.tsx and MainLayout.tsx already lean on the same trick.
  if (w.isHomecastAndroidApp || !!w.HomecastAndroidPush || !!w.HomecastAndroid) return 'android';

  // iOS needs the native bridge present, not merely "is the iOS app". The three
  // notification.* methods live on `window.homekit`, which iOS builds only gained
  // alongside Local Mode; an older build has nothing to register through, and
  // minting a fingerprint for it would let the settings screen write mutes and
  // send tests against a device that can never receive one. This also correctly
  // excludes the Tauri iOS shell, which sets isHomecastIOSApp but has no bridge.
  if (w.isHomecastIOSApp && !!w.homekit) return 'ios';

  // macOS must NOT require that flag — every shipped Mac build is already
  // push-capable through window.homekit, and gating on it would orphan them all
  // until they updated. Older Mac builds may not inject the flag but always
  // expose the message handler.
  if (w.isHomecastMacApp || (w.webkit?.messageHandlers?.homecast && !w.isHomecastIOSApp)) {
    return 'macos';
  }

  return null;
}

/**
 * The stable fingerprint identifying this device, or null when this platform
 * has no push path (plain browser, Tauri desktop). Created on first use.
 */
export function getDeviceFingerprint(): string | null {
  const platform = getDevicePlatform();
  if (!platform) return null;
  const key = FINGERPRINT_KEYS[platform];
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

/**
 * Drop this device's push registration on sign-out, so the previous account
 * stops receiving notifications here. Best-effort and time-boxed — a slow or
 * failed network must never hold up signing out.
 *
 * The localStorage fingerprint is deliberately left in place: it is stable
 * device identity, and signing back in should reuse it. The server deletes the
 * device's mutes alongside the token.
 */
export async function unregisterThisDevice(): Promise<void> {
  if (typeof window === 'undefined') return;
  const fingerprint = getDeviceFingerprint();
  if (!fingerprint) return;
  try {
    const [{ apolloClient }, { UNREGISTER_PUSH_TOKEN }] = await Promise.all([
      import('@/lib/apollo'),
      import('@/lib/graphql/mutations'),
    ]);
    await Promise.race([
      apolloClient.mutate({ mutation: UNREGISTER_PUSH_TOKEN, variables: { deviceFingerprint: fingerprint } }),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (err) {
    console.warn('[device-identity] Failed to unregister push token:', err);
  }
}

export interface DeviceIdentity {
  platform: DevicePlatform | null;
  fingerprint: string | null;
}

/**
 * Reactive form of the two functions above.
 *
 * Both read `window` flags, and calling them straight from a render body means a
 * flag that arrives late — a native host that injects after React mounts — never
 * re-renders the screen, leaving it permanently stuck on "push isn't available".
 * Every signal used by `getDevicePlatform` is available before React runs, so
 * this poll is belt-and-braces; it stops as soon as a platform is found and gives
 * up after a couple of seconds so a plain browser costs nothing.
 */
export function useDeviceIdentity(): DeviceIdentity {
  const [identity, setIdentity] = useState<DeviceIdentity>(() => ({
    platform: getDevicePlatform(),
    fingerprint: getDeviceFingerprint(),
  }));
  const settledRef = useRef(identity.platform !== null);

  useEffect(() => {
    if (settledRef.current) return;
    let attempts = 0;
    const timer = setInterval(() => {
      attempts += 1;
      const platform = getDevicePlatform();
      if (platform) {
        settledRef.current = true;
        clearInterval(timer);
        setIdentity({ platform, fingerprint: getDeviceFingerprint() });
      } else if (attempts >= 20) {
        clearInterval(timer);
      }
    }, 100);
    return () => clearInterval(timer);
  }, []);

  return identity;
}
