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
 *   4. Forward foreground push messages to the same custom event the
 *      automation engine already listens for (`homecast-notification-action`).
 */
import { useEffect, useRef } from 'react';
import { isCommunity } from '@/lib/config';

interface AndroidPushBridge {
  getCachedFcmToken: () => string | null;
  fetchFcmToken: () => void;
  hasNotificationPermission: () => boolean;
  requestNotificationPermission: () => void;
  deviceModel: () => string;
}

interface ForegroundPushPayload {
  title?: string | null;
  body?: string | null;
  data?: Record<string, string>;
}

declare global {
  interface Window {
    HomecastAndroidPush?: AndroidPushBridge;
    isHomecastAndroidApp?: boolean;
    __homecastOnFcmToken?: (token: string | null) => void;
    __homecastOnPushPermission?: (granted: boolean) => void;
    __homecastOnPush?: (payload: ForegroundPushPayload) => void;
  }
}

const FINGERPRINT_KEY = 'homecast-android-fingerprint';

function getOrCreateFingerprint(): string {
  let fp = localStorage.getItem(FINGERPRINT_KEY);
  if (!fp) {
    fp = `android-${crypto.randomUUID()}`;
    localStorage.setItem(FINGERPRINT_KEY, fp);
  }
  return fp;
}

export function useAndroidPush(): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (isCommunity) return;
    const bridge = window.HomecastAndroidPush;
    if (!window.isHomecastAndroidApp || !bridge) return;

    let cancelled = false;

    const registerToken = async (token: string) => {
      if (cancelled || registeredRef.current) return;
      try {
        const { apolloClient } = await import('@/lib/apollo');
        const { REGISTER_PUSH_TOKEN } = await import('@/lib/graphql/mutations');
        await apolloClient.mutate({
          mutation: REGISTER_PUSH_TOKEN,
          variables: {
            token,
            platform: 'android',
            deviceFingerprint: getOrCreateFingerprint(),
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

    window.__homecastOnPush = (payload) => {
      window.dispatchEvent(
        new CustomEvent('homecast-notification-action', {
          detail: {
            action: payload?.data?.action ?? null,
            data: payload?.data ?? {},
          },
        }),
      );
    };

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
      delete window.__homecastOnPush;
    };
  }, []);
}
