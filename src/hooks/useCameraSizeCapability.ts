import { useEffect, useSyncExternalStore } from 'react';
import {
  cameraSnapshotCacheKey,
  getCameraSnapshot,
  subscribeCameraSnapshots,
} from '@/lib/camera-snapshot-cache';
import { cameraSizeCapability, type WidgetSizeCapability } from '@/lib/widget-sizes';
import type { HomeKitAccessory } from '@/lib/graphql/types';

/**
 * Report which tile sizes this camera can usefully take, from the snapshot it
 * has already produced.
 *
 * **Reads the cache, never requests.** `useCameraSnapshot` owns the timer and
 * the back-off, and a second caller asking it for the same camera would be a
 * second poller — on a battery camera that means waking the doorbell to find
 * out how wide its pictures are. The shape of the last picture is already in
 * the cache, which is all this needs, and the cache is a subscribable store so
 * a first snapshot arriving re-renders the widget and the answer changes from
 * "Large only" to "Large and Tall" on its own.
 *
 * `available` is the gate the caller already computes (cloud mode, the relay
 * reports the capability, the owner switched cameras on). A camera nobody can
 * photograph is offered no sizes at all rather than Large over a grey box.
 */
export function useCameraSizeCapability(
  accessory: HomeKitAccessory,
  available: boolean,
  report: ((capability: WidgetSizeCapability) => void) | undefined,
): void {
  const key = cameraSnapshotCacheKey(accessory.homeId, accessory.id);
  const image = useSyncExternalStore(
    subscribeCameraSnapshots,
    () => getCameraSnapshot(key),
    () => undefined,
  );

  const width = image?.width ?? undefined;
  const height = image?.height ?? undefined;

  useEffect(() => {
    if (!report) return;
    // Depend on the two numbers rather than the image object: the cache hands
    // back a new object on every refreshed still, and reporting on each one
    // would push a new capability through the grid every few seconds for an
    // answer that has not changed.
    report(available ? cameraSizeCapability({ width, height }) : {});
  }, [report, available, width, height]);
}
