import { useEffect, useRef, useState } from 'react';
import { serverConnection } from '@/server/connection';
import {
  isPermanentCameraFailure,
  nextSnapshotDelayMs,
  shouldPollSnapshots,
  snapshotDataUrl,
  type CameraFailure,
  type CameraSnapshotResult,
  type SnapshotStatus,
  type SnapshotImage,
} from '@/lib/camera-snapshot';
import type { HomeKitAccessory } from '@/lib/graphql/types';

/**
 * The last still each camera produced, kept across mounts so a tile that
 * collapses and reopens — or a second tile for the same camera — shows the
 * previous image immediately instead of a blank.
 */
const lastSnapshots = new Map<string, SnapshotImage>();

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
  const key = `${accessory.homeId}:${accessory.id}`;
  const [state, setState] = useState<{ key: string; status: SnapshotStatus }>({
    key, status: cached ? { kind: 'ready', ...cached } : { kind: 'idle' },
  });
  // A keyed grid can reuse a mounted hero for another accessory. Never show
  // that other camera's pixels, even for the render before the effect runs.
  const status: SnapshotStatus = state.key === key ? state.status : { kind: 'idle' };
  const [refreshingKey, setRefreshingKey] = useState<string | null>(null);
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
      setRefreshingKey(key);
      setState((s) => ({ key, status: s.key === key &&
        (s.status.kind === 'ready' || (s.status.kind === 'error' && s.status.dataUrl))
        ? s.status : { kind: 'loading' } }));
      try {
        const result = await serverConnection.request<CameraSnapshotResult>('camera.snapshot', {
          accessoryId: accessory.id,
          homeId: accessory.homeId,
          // Opening, returning to the page, and Refresh all ask for a new
          // image. The relay still coalesces requests and paces camera wakes.
          maxAgeSec: 0,
        });
        if (cancelled) return;
        const next = {
          dataUrl: snapshotDataUrl(result),
          capturedAt: result.capturedAt,
          width: result.width,
          height: result.height,
          source: result.source,
        };
        lastSnapshots.set(accessory.id, next);
        failures.current = 0;
        setState({ key, status: { kind: 'ready', ...next } });
      } catch (err) {
        if (cancelled) return;
        const failure = toFailure(err);
        failures.current += 1;
        if (['PERMISSION_DENIED', 'UNAUTHORIZED', 'CAMERAS_DISABLED'].includes(failure.code)) {
          lastSnapshots.delete(accessory.id);
        }
        const previous = lastSnapshots.get(accessory.id);
        setState({ key, status: { kind: 'error', failure, ...previous } });
        if (isPermanentCameraFailure(failure.code)) return;
      } finally {
        if (!cancelled) setRefreshingKey(null);
      }
      timer = setTimeout(tick, nextSnapshotDelayMs(failures.current));
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [accessory.id, accessory.homeId, key, supported, expanded, pageVisible, refreshToken]);

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
