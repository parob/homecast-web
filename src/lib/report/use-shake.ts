/**
 * Shake-to-report.
 *
 * Two sources, because no single one covers the platforms this app runs on:
 *
 * - The native shell, where there is one. iOS already detects a shake
 *   (motionEnded) and it needs no permission, so when the shell offers it we
 *   use it and never touch devicemotion.
 * - `devicemotion` otherwise. On iOS Safari 13+ this needs an explicit
 *   permission grant that can only be requested from a user gesture, so it
 *   cannot be armed on load — see `requestShakePermission`.
 *
 * Desktop has no accelerometer at all, which is why the report sheet is always
 * reachable from Settings as well. A gesture nobody can perform is not a
 * feature.
 */

import { useEffect, useRef } from 'react';

import { onNativeShake } from '@/native/report-bridge';

/** Total g-force change that counts as a shake. Tuned to need intent. */
const SHAKE_THRESHOLD = 25;
/** Ignore samples closer together than this — the sensor is noisy. */
const SAMPLE_INTERVAL_MS = 120;
/** Do not fire twice for one continuous shake, or on an accidental re-shake. */
const COOLDOWN_MS = 3_000;

type PermissionState = 'unsupported' | 'granted' | 'prompt' | 'denied';

interface DeviceMotionEventStatic {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

function motionPermissionApi(): DeviceMotionEventStatic | null {
  const api = (window as unknown as { DeviceMotionEvent?: DeviceMotionEventStatic })
    .DeviceMotionEvent;
  return api ?? null;
}

/** Whether devicemotion needs an explicit grant here (iOS Safari 13+). */
export function shakeNeedsPermission(): boolean {
  return typeof motionPermissionApi()?.requestPermission === 'function';
}

/**
 * Ask for motion access. MUST be called from a user gesture — iOS rejects it
 * otherwise, and the rejection is indistinguishable from a refusal.
 */
export async function requestShakePermission(): Promise<PermissionState> {
  const api = motionPermissionApi();
  if (!api) return 'unsupported';
  if (typeof api.requestPermission !== 'function') return 'granted';
  try {
    return (await api.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch {
    // Thrown when called outside a gesture, which is a caller bug rather than
    // a refusal — but from here the two look the same.
    return 'denied';
  }
}

/**
 * Call `onShake` when the device is shaken.
 *
 * `enabled` exists so the caller can hold the gesture off while a report sheet
 * is already open — shaking a phone to dismiss a dialog is a natural reflex,
 * and re-triggering on top of it would be maddening.
 */
export function useShake(onShake: () => void, enabled = true): void {
  const handler = useRef(onShake);
  handler.current = onShake;

  useEffect(() => {
    if (!enabled) return;

    // Prefer the shell's own gesture; skip devicemotion entirely when present.
    const unsubscribeNative = onNativeShake(() => handler.current());
    if (unsubscribeNative !== undefined) {
      const probe = (window as Window & { homecastReport?: { onShake?: unknown } })
        .homecastReport;
      if (probe?.onShake) return unsubscribeNative;
    }

    if (typeof window.DeviceMotionEvent === 'undefined') return;

    let lastSample = 0;
    let lastFired = 0;
    let lastX: number | null = null;
    let lastY: number | null = null;
    let lastZ: number | null = null;

    const onMotion = (event: DeviceMotionEvent) => {
      const acceleration = event.accelerationIncludingGravity;
      if (!acceleration) return;

      const now = Date.now();
      if (now - lastSample < SAMPLE_INTERVAL_MS) return;
      lastSample = now;

      const { x, y, z } = acceleration;
      if (x == null || y == null || z == null) return;

      if (lastX !== null && lastY !== null && lastZ !== null) {
        const delta =
          Math.abs(x - lastX) + Math.abs(y - lastY) + Math.abs(z - lastZ);
        if (delta > SHAKE_THRESHOLD && now - lastFired > COOLDOWN_MS) {
          lastFired = now;
          handler.current();
        }
      }

      lastX = x;
      lastY = y;
      lastZ = z;
    };

    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      unsubscribeNative();
    };
  }, [enabled]);
}
