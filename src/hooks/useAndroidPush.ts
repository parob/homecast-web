/**
 * Android FCM push registration for the Tauri Android shell.
 *
 * Runs only when the WebView reports `window.isHomecastAndroidApp` and the
 * Kotlin side has injected the `HomecastAndroidPush` JavaScript interface.
 * On a regular browser this hook is a no-op.
 *
 * Flow:
 *   1. Request POST_NOTIFICATIONS permission (no-op on Android <13).
 *   2. Ask the Kotlin bridge to fetch an FCM token.
 *   3. Register the token with the cloud server via GraphQL.
 */
import { useEffect, useRef } from 'react';
import { isCommunity } from '@/lib/config';
import { getDeviceFingerprint, getDevicePlatform } from '@/lib/device-identity';

interface AndroidPushBridge {
  getCachedFcmToken: () => string | null;
  fetchFcmToken: () => void;
  hasNotificationPermission: () => boolean;
  requestNotificationPermission: () => void;
  deviceModel: () => string;
  /** Payload of the notification this launch came from. Read-and-clear.
   *  Optional — an APK older than the tap-routing release lacks it. */
  consumePendingPushOpen?: () => string | null;
}

/** The `data` block of a push, as forwarded by the Kotlin side. */
type PushPayload = Record<string, string>;

declare global {
  interface Window {
    HomecastAndroidPush?: AndroidPushBridge;
    isHomecastAndroidApp?: boolean;
    __homecastOnFcmToken?: (token: string | null) => void;
    __homecastOnPushPermission?: (granted: boolean) => void;
    __homecastOnPush?: (payload: { title: string | null; body: string | null; data: PushPayload }) => void;
    __homecastOnPushOpen?: (payload: PushPayload) => void;
  }
}

/**
 * Act on a notification the user tapped.
 *
 * Selecting the home the alert came from is the part that matters — landing in
 * the wrong household is the difference between a useful alert and a confusing
 * one. Deep-linking to the specific automation is not wired up yet; the payload
 * carries `automationId`, so it is there when someone builds it.
 */
function handlePushOpen(payload: PushPayload): void {
  const homeId = payload.homeId;
  if (homeId) {
    try {
      localStorage.setItem('homecast-selected-home', homeId);
    } catch { /* private mode — not worth failing the navigation over */ }
  }
  if (!window.location.pathname.startsWith('/portal')) {
    window.location.href = '/portal';
  }
}

export function useAndroidPush(): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (isCommunity) return;
    const bridge = window.HomecastAndroidPush;
    // Keyed on getDevicePlatform() rather than window.isHomecastAndroidApp
    // directly: Tauri injects that flag on PageLoadEvent::Started, which can
    // land after React mounts, and this effect has [] deps — so a late flag used
    // to mean the hook bailed permanently and the device never registered.
    if (getDevicePlatform() !== 'android' || !bridge) return;

    let cancelled = false;

    const registerToken = async (token: string) => {
      if (cancelled || registeredRef.current) return;
      const fingerprint = getDeviceFingerprint();
      if (!fingerprint) return;
      try {
        const { apolloClient } = await import('@/lib/apollo');
        const { REGISTER_PUSH_TOKEN } = await import('@/lib/graphql/mutations');
        await apolloClient.mutate({
          mutation: REGISTER_PUSH_TOKEN,
          variables: {
            token,
            platform: 'android',
            deviceFingerprint: fingerprint,
            deviceName: bridge.deviceModel?.() || 'Android device',
          },
        });
        registeredRef.current = true;
        console.log('[AndroidPush] Registered FCM token');
      } catch (err) {
        console.warn('[AndroidPush] Token registration failed:', err);
      }
    };

    window.__homecastOnFcmToken = (token) => {
      if (token) void registerToken(token);
    };

    window.__homecastOnPushPermission = (granted) => {
      if (granted) bridge.fetchFcmToken();
    };

    // A tap while the app is already running.
    window.__homecastOnPushOpen = (payload) => handlePushOpen(payload);

    // Foreground push. The Kotlin side draws the tray notification itself (FCM
    // draws nothing while the app is foregrounded), so there is nothing to
    // display here — but the history list should catch up.
    window.__homecastOnPush = () => {
      void import('@/lib/apollo').then(({ apolloClient }) =>
        apolloClient.refetchQueries({ include: ['GetNotificationHistory'] }),
      ).catch(() => { /* history refresh is cosmetic */ });
    };

    // A tap that cold-started the app: the payload was stashed natively before
    // this hook — or React itself — existed.
    try {
      const pending = bridge.consumePendingPushOpen?.();
      if (pending) handlePushOpen(JSON.parse(pending) as PushPayload);
    } catch (err) {
      console.warn('[AndroidPush] Could not read pending push:', err);
    }

    if (bridge.hasNotificationPermission()) {
      const cached = bridge.getCachedFcmToken();
      if (cached) {
        void registerToken(cached);
      } else {
        bridge.fetchFcmToken();
      }
    } else {
      bridge.requestNotificationPermission();
    }

    return () => {
      cancelled = true;
      delete window.__homecastOnFcmToken;
      delete window.__homecastOnPushPermission;
      delete window.__homecastOnPushOpen;
      delete window.__homecastOnPush;
    };
  }, []);
}
