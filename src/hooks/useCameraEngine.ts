/**
 * Tells the Mac app whether this Mac is a cloud-managed relay.
 *
 * Cameras are a managed-relay feature: the engine window that camera stills
 * and live streams are captured from exists only on a Mac Homecast operates.
 * The Swift side opens that window at launch — but it cannot tell a managed
 * relay from a customer's own Mac, because the only difference between them
 * is the account signed in. That is ours: the relay signs in as a `managed`
 * account, a self-hosted relay as the customer's.
 *
 * So every Mac reports, once it knows who it is signed in as. The Mac keeps
 * the answer across launches (so the managed relay's window is up before the
 * page loads, as before), and an "off" closes the window and refuses every
 * other `camera.*` bridge method. Sign-out clears it natively.
 *
 * Reported whenever the account changes, never while signed out: a null user
 * during startup is not a verdict, and treating it as one would close and
 * reopen the managed relay's window on every launch.
 */
import { useEffect } from 'react';
import { isCommunity } from '@/lib/config';
import { HomeKit, isRelayCapable } from '@/native/homekit-bridge';

/** The one account type that runs the camera engine. */
export const CAMERA_ENGINE_ACCOUNT_TYPE = 'managed';

export function wantsCameraEngine(accountType: string | undefined | null): boolean {
  return accountType === CAMERA_ENGINE_ACCOUNT_TYPE;
}

export function useCameraEngine(accountType: string | undefined | null): void {
  useEffect(() => {
    if (isCommunity || !accountType) return;
    // Only a Mac can be a relay; iPhones and iPads have no engine to switch.
    if (!isRelayCapable() || !HomeKit.isAvailable()) return;
    const enabled = wantsCameraEngine(accountType);
    HomeKit.setCameraEngine(enabled).then((result) => {
      // The Mac injects `homecastCameraEngine` at page load from the answer it
      // remembered last time. Bring it up to date now, so a page that reads it
      // — the managed-relay dashboard's camera panel, connect telemetry —
      // sees the new verdict without a reload.
      (window as Window & { homecastCameraEngine?: boolean }).homecastCameraEngine = result?.enabled === true;
    }).catch((err: unknown) => {
      // An older app has no such method: it opens the window as it always
      // did. Nothing to do here but say so.
      console.warn('[CameraEngine] could not report to the Mac app', err);
    });
  }, [accountType]);
}
