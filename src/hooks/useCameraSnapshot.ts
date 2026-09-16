import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { serverConnection } from '@/server/connection';
import {
  isPermanentCameraFailure,
  nextSnapshotDelayMs,
  shouldPollSnapshots,
  snapshotDataUrl,
  type CameraFailure,
  type CameraSnapshotResult,
  type SnapshotStatus,
} from '@/lib/camera-snapshot';
import {
  cameraSnapshotCacheGeneration,
  cameraSnapshotAccount,
  cameraSnapshotCacheRevision,
  cameraSnapshotCacheKey,
  deleteCameraSnapshot,
  getCameraSnapshot,
  setCameraSnapshot,
  restoreCameraSnapshot,
  subscribeCameraSnapshots,
} from '@/lib/camera-snapshot-cache';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { queueCameraRequest } from '@/lib/camera-request-queue';

function toFailure(err: unknown): CameraFailure {
  const e = err as { code?: string; message?: string } | undefined;
  return { code: e?.code || 'INTERNAL_ERROR', message: e?.message || String(err) };
}

/**
 * Stills for an opened camera, or a slower visible-tile preview.
 *
 * Requests go through `serverConnection` and the cloud's camera authorization
 * even on a relay Mac, so the home's selected relay captures the image. Pacing and
 * back-off are the pure policy in `lib/camera-snapshot.ts`; this hook only
 * owns the timer and the page-visibility gate.
 */
export function useCameraSnapshot(accessory: HomeKitAccessory, expanded: boolean, preview = false) {
  const supported = accessory.camera?.snapshot === true;
  const key = cameraSnapshotCacheKey(accessory.homeId, accessory.id);
  const generation = useSyncExternalStore(subscribeCameraSnapshots, cameraSnapshotCacheGeneration);
  const cached = useSyncExternalStore(subscribeCameraSnapshots, () => getCameraSnapshot(key));
  const [state, setState] = useState<{ key: string; generation: number; status: SnapshotStatus }>({
    key, generation, status: { kind: 'idle' },
  });
  // A keyed grid can reuse a mounted hero for another accessory. Never show
  // that other camera's pixels, even for the render before the effect runs.
  const current = state.key === key && state.generation === generation ? state.status : { kind: 'idle' as const };
  const status: SnapshotStatus = current.kind === 'error'
    ? { kind: 'error', failure: current.failure, ...cached }
    : cached ? { kind: 'ready', ...cached } : current;
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
  const [pageVisible, setPageVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const failures = useRef(0);

  useEffect(() => {
    // Restore even while offscreen or closed; this does not wake the camera.
    // Disk reads never block a fresh request and cannot overwrite its result.
    if (supported) void restoreCameraSnapshot(key);
  }, [key, supported, generation]);

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!cameraSnapshotAccount() || !shouldPollSnapshots({ supported, expanded, pageVisible })) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stale = () => cancelled || generation !== cameraSnapshotCacheGeneration();

    const tick = async () => {
      if (stale()) return;
      const revision = cameraSnapshotCacheRevision(key);
      setRefreshingKey(key);
      setState({ key, generation, status: { kind: 'loading' } });
      try {
        const result = await queueCameraRequest(accessory.homeId, preview ? 0 : 1, () => {
          // The tile may leave the viewport or sign out while queued.
          if (stale()) throw new Error('Camera request cancelled');
          return serverConnection.request<CameraSnapshotResult>('camera.snapshot', {
            accessoryId: accessory.id,
            homeId: accessory.homeId,
            // Opened viewers always ask for fresh pixels. A small tile can reuse
            // a recent still; the relay still coalesces and paces camera wakes.
            maxAgeSec: preview ? 55 : 0,
            ...(preview ? { maxWidth: 480 } : {}),
          });
        });
        if (stale()) return;
        const next = {
          dataUrl: snapshotDataUrl(result),
          capturedAt: result.capturedAt,
          width: result.width,
          height: result.height,
          source: result.source,
        };
        setCameraSnapshot(key, next, generation, revision);
        failures.current = 0;
        setState({ key, generation, status: { kind: 'idle' } });
      } catch (err) {
        if (stale()) return;
        const failure = toFailure(err);
        failures.current += 1;
        if (['PERMISSION_DENIED', 'UNAUTHORIZED', 'CAMERAS_DISABLED'].includes(failure.code)) {
          deleteCameraSnapshot(key);
        }
        setState({ key, generation, status: { kind: 'error', failure } });
        if (isPermanentCameraFailure(failure.code)) return;
      } finally {
        if (!stale()) setRefreshingKey(null);
      }
      timer = setTimeout(tick, preview ? Math.max(60_000, nextSnapshotDelayMs(failures.current)) : nextSnapshotDelayMs(failures.current));
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessory.id, accessory.homeId, key, supported, expanded, pageVisible, refreshToken, preview, generation]);

  return {
    status,
    supported,
    refreshing: expanded && pageVisible && refreshingKey === key,
    /** Ask again now, resetting any back-off. */
    refresh: () => {
      failures.current = 0;
      setRefreshToken((n) => n + 1);
    },
  };
}
