import { useEffect, useRef, useState } from 'react';
import { serverConnection } from '@/server/connection';
import {
  SNAPSHOT_MAX_AGE_SEC,
  isPermanentCameraFailure,
  nextSnapshotDelayMs,
  shouldPollSnapshots,
  snapshotDataUrl,
  type CameraFailure,
  type CameraSnapshotResult,
  type SnapshotStatus,
} from '@/lib/camera-snapshot';
import type { HomeKitAccessory } from '@/lib/graphql/types';

/**
 * The last still each camera produced, kept across mounts so a tile that
 * collapses and reopens — or a second tile for the same camera — shows the
 * previous image immediately instead of a blank.
 */
const lastSnapshots = new Map<string, { dataUrl: string; capturedAt: string; width: number; height: number }>();

export function lastCameraSnapshot(accessoryId: string) {
  return lastSnapshots.get(accessoryId);
}

function toFailure(err: unknown): CameraFailure {
  const e = err as { code?: string; message?: string } | undefined;
  return { code: e?.code || 'INTERNAL_ERROR', message: e?.message || String(err) };
}

/**
 * Stills for one camera while its tile is expanded.
 *
 * Requests go through `serverConnection` and the cloud's camera authorization
 * even on a relay Mac, so the home's selected relay captures the image. Pacing and
 * back-off are the pure policy in `lib/camera-snapshot.ts`; this hook only
 * owns the timer and the page-visibility gate.
 */
export function useCameraSnapshot(accessory: HomeKitAccessory, expanded: boolean) {
  const supported = accessory.camera?.snapshot === true;
  const cached = lastSnapshots.get(accessory.id);
  const [status, setStatus] = useState<SnapshotStatus>(
    cached ? { kind: 'ready', ...cached } : { kind: 'idle' }
  );
  const [pageVisible, setPageVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState !== 'hidden'
  );
  const [refreshToken, setRefreshToken] = useState(0);
  const failures = useRef(0);

  useEffect(() => {
    const onVisibility = () => setPageVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    if (!shouldPollSnapshots({ supported, expanded, pageVisible })) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (cancelled) return;
      setStatus((s) => (s.kind === 'ready' ? s : { kind: 'loading' }));
      try {
        const result = await serverConnection.request<CameraSnapshotResult>('camera.snapshot', {
          accessoryId: accessory.id,
          homeId: accessory.homeId,
          maxAgeSec: SNAPSHOT_MAX_AGE_SEC,
        });
        if (cancelled) return;
        const next = {
          dataUrl: snapshotDataUrl(result),
          capturedAt: result.capturedAt,
          width: result.width,
          height: result.height,
        };
        lastSnapshots.set(accessory.id, next);
        failures.current = 0;
        setStatus({ kind: 'ready', ...next });
      } catch (err) {
        if (cancelled) return;
        const failure = toFailure(err);
        failures.current += 1;
        const previous = lastSnapshots.get(accessory.id);
        setStatus({ kind: 'error', failure, dataUrl: previous?.dataUrl, capturedAt: previous?.capturedAt });
        if (isPermanentCameraFailure(failure.code)) return;
      }
      timer = setTimeout(tick, nextSnapshotDelayMs(failures.current));
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessory.id, accessory.homeId, supported, expanded, pageVisible, refreshToken]);

  return {
    status,
    supported,
    /** Ask again now, resetting any back-off. */
    refresh: () => {
      failures.current = 0;
      setRefreshToken((n) => n + 1);
    },
  };
}
