/**
 * APNs push registration for the Apple apps — Mac Catalyst and iOS alike.
 *
 * This replaces the registration that used to live on the relay WebSocket
 * (`server/websocket.ts`), which only ever ran inside `startRelayDuties()`. That
 * placement meant a Mac that was not the relay — and every iPhone and iPad —
 * silently never registered a token.
 *
 * Both platforms reach APNs through the same `window.homekit` bridge: the three
 * `notification.*` methods live in the branch of `HomeKitBridge.swift` gated on
 * `canImport(HomeKit)`, which covers iOS as well as Catalyst. So there is no
 * iOS-specific transport here, and there should not be one.
 */
import { useEffect, useRef } from 'react';
import { isCommunity } from '@/lib/config';
import { getDeviceFingerprint, getDevicePlatform } from '@/lib/device-identity';
import { HomeKit, isRelayEnabled } from '@/native/homekit-bridge';

/**
 * The OS mints the token asynchronously, so immediately after a permission grant
 * `getAPNsToken` legitimately answers null. Giving up on the first null meant a
 * first launch never registered until the app was restarted.
 */
const TOKEN_POLL_BACKOFF_MS = [0, 1000, 2000, 4000, 8000, 16000, 30000];

/** A human-readable name for this device, shown in the push-token list. */
function resolveDeviceName(platform: 'macos' | 'ios'): string {
  const w = window as { homecastHostName?: string; homecastDeviceModel?: string };
  if (platform === 'macos') {
    const base = w.homecastHostName?.trim() || 'Mac';
    return isRelayEnabled() ? `${base} (Relay)` : base;
  }
  const isIpad = w.homecastDeviceModel?.startsWith('iPad')
    || /iPad/.test(navigator.userAgent);
  return isIpad ? 'iPad' : 'iPhone';
}

export function useApplePush(): void {
  const registeredRef = useRef(false);

  useEffect(() => {
    if (isCommunity) return;

    const platform = getDevicePlatform();
    if (platform !== 'macos' && platform !== 'ios') return;
    if (!HomeKit.isAvailable()) return;

    let cancelled = false;

    const run = async () => {
      if (registeredRef.current) return;

      const granted = (await HomeKit.requestNotificationPermission())?.granted;
      if (cancelled || !granted) return;

      let token: string | null = null;
      for (const delayMs of TOKEN_POLL_BACKOFF_MS) {
        if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
        if (cancelled) return;
        token = (await HomeKit.getAPNsToken())?.token ?? null;
        if (token) break;
      }
      if (cancelled) return;
      if (!token) {
        console.warn('[ApplePush] APNs token still unavailable after retries');
        return;
      }

      const fingerprint = getDeviceFingerprint();
      if (!fingerprint) return;

      const { apolloClient } = await import('@/lib/apollo');
      const { REGISTER_PUSH_TOKEN } = await import('@/lib/graphql/mutations');
      if (cancelled) return;
      await apolloClient.mutate({
        mutation: REGISTER_PUSH_TOKEN,
        variables: {
          token,
          platform,
          deviceFingerprint: fingerprint,
          deviceName: resolveDeviceName(platform),
        },
      });
      registeredRef.current = true;
      console.log(`[ApplePush] Registered APNs token (${platform})`);
    };

    // Non-fatal throughout — push is optional, and a failed attempt leaves the
    // guard unset so a later mount tries again.
    void run().catch((err) => {
      console.warn('[ApplePush] Token registration failed:', err);
    });

    return () => {
      cancelled = true;
    };
  }, []);
}
