import { useEffect, useState, useSyncExternalStore } from 'react';
import { serverConnection } from '@/server/connection';
import {
  cameraSnapshotAccount, cameraSnapshotCacheGeneration, cameraSnapshotCacheKey, cameraSnapshotCacheRevision,
  deleteCameraSnapshot, setCameraSnapshot, subscribeCameraSnapshots,
} from '@/lib/camera-snapshot-cache';
import { isLiveFrame, type CameraLivePhase, type CameraLiveStatus } from '@/lib/camera-live';
import type { SnapshotImage } from '@/lib/camera-snapshot';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { randomUUID } from '@/lib/uuid';

interface LiveState {
  key: string;
  generation: number;
  phase: CameraLivePhase;
  image?: SnapshotImage;
  reason?: string;
  queuePosition?: number;
}

/** A mounted, visible camera owns one subscription, released on close/hide.
 * Same-camera viewers share the physical stream on the relay, not in this hook.
 */
export function useCameraLive(accessory: HomeKitAccessory, expanded: boolean) {
  const key = cameraSnapshotCacheKey(accessory.homeId, accessory.id);
  const generation = useSyncExternalStore(subscribeCameraSnapshots, cameraSnapshotCacheGeneration);
  const revision = useSyncExternalStore(subscribeCameraSnapshots, () => cameraSnapshotCacheRevision(key));
  const supported = accessory.camera?.stream === true;
  const [state, setState] = useState<LiveState>({ key, generation, phase: 'idle' });
  const [resume, setResume] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [connected, setConnected] = useState(() => serverConnection.getState().connectionState === 'connected');
  const current = state.key === key && state.generation === generation ? state : { key, generation, phase: 'idle' as const };

  useEffect(() => {
    const visibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', visibility);
    const unsubscribe = serverConnection.subscribe(s => setConnected(s.connectionState === 'connected'));
    return () => { document.removeEventListener('visibilitychange', visibility); unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!expanded || !supported || !visible || !connected || !cameraSnapshotAccount()) return;
    const watchId = randomUUID();
    const payload = { watchId, homeId: accessory.homeId, accessoryId: accessory.id };
    let closed = false;
    let streamId: string | undefined;
    let phase: CameraLivePhase = 'connecting';
    let lastImage: SnapshotImage | undefined;
    let seq = 0;
    let lastFrame = Date.now();
    let lastPersisted = 0;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let watchdog: ReturnType<typeof setInterval> | undefined;
    let keepingAlive = false;
    const valid = () => !closed && generation === cameraSnapshotCacheGeneration() && revision === cameraSnapshotCacheRevision(key);
    const persist = () => {
      if (lastImage && valid()) setCameraSnapshot(key, lastImage, generation, revision);
    };
    const release = () => { void serverConnection.request('camera.live.stop', { watchId }).catch(() => {}); };
    const update = (next: CameraLivePhase, extra: Partial<LiveState> = {}) => {
      if (!valid()) return;
      phase = next;
      setState({ key, generation, phase, image: lastImage, ...extra });
    };
    const finish = (next: CameraLivePhase, reason?: string) => {
      if (!valid()) return;
      if (['CAMERAS_DISABLED', 'PERMISSION_DENIED', 'UNAUTHORIZED'].includes(reason ?? '')) {
        lastImage = undefined;
        // Publish the pixel-free state before revocation increments revision.
        update(next, { reason });
        closed = true;
        deleteCameraSnapshot(key);
      } else {
        persist();
        update(next, { reason });
        closed = true;
      }
      if (keepalive) clearInterval(keepalive);
      if (watchdog) clearInterval(watchdog);
      release();
    };
    const acceptStatus = (result: CameraLiveStatus) => {
      if (!valid() || result.watchId !== watchId) return;
      if (streamId && result.streamId && result.streamId !== streamId) return;
      streamId = result.streamId ?? streamId;
      if (result.state === 'stopped') {
        const reason = result.reason;
        finish(reason && !['expired', 'idle', 'stopped', 'CAMERA_SESSION_EXPIRED'].includes(reason) ? 'error' : 'stopped', reason);
      } else if (result.state === 'queued' && !lastImage) {
        update('queued', { queuePosition: result.queuePosition });
      } else if (phase !== 'live') {
        // Waiting for capacity is not a failed first frame. Start the frame
        // deadline when promoted, not when the viewer joined the queue.
        if (phase === 'queued') lastFrame = Date.now();
        update('connecting');
      }
    };
    update('connecting');
    // Subscribe BEFORE acquire: a very fast relay may send state before the
    // response; frames are accepted only once a matching stream id is known.
    const unsubscribe = serverConnection.subscribeToBroadcasts(message => {
      if (!valid() || (message.type !== 'camera_frame' && message.type !== 'camera_live_state') || message.watchId !== watchId) return;
      if (message.type === 'camera_live_state') { acceptStatus(message); return; }
      if (!streamId || message.streamId !== streamId || message.seq <= seq || !isLiveFrame(message)) return;
      seq = message.seq;
      lastFrame = Date.now();
      lastImage = { dataUrl: `data:image/jpeg;base64,${message.jpeg}`, capturedAt: message.capturedAt,
        width: message.width, height: message.height, source: 'stream' };
      update('live');
      // Display every frame, persist at most once every five seconds, plus
      // the last frame on close. Never write IndexedDB at video frame rate.
      if (lastFrame - lastPersisted >= 5000) { persist(); lastPersisted = lastFrame; }
    });
    const unsubscribeCache = subscribeCameraSnapshots(() => {
      if (closed || (generation === cameraSnapshotCacheGeneration() && revision === cameraSnapshotCacheRevision(key))) return;
      lastImage = undefined;
      closed = true;
      setState({ key, generation, phase: 'error', reason: 'PERMISSION_DENIED' });
      if (keepalive) clearInterval(keepalive);
      if (watchdog) clearInterval(watchdog);
      release();
    });
    void serverConnection.request<CameraLiveStatus>('camera.live.start', payload).then(result => {
      if (!valid()) { release(); return; }
      if (!lastImage) lastFrame = Date.now();
      acceptStatus(result);
      if (!valid()) return;
      keepalive = setInterval(() => {
        if (!valid() || keepingAlive) return;
        keepingAlive = true;
        void serverConnection.request<CameraLiveStatus>('camera.live.keepalive', { watchId }).then(acceptStatus).catch(error => {
          finish('error', error?.code);
        }).finally(() => { keepingAlive = false; });
      }, 10_000);
      watchdog = setInterval(() => {
        if (!valid() || phase === 'queued') return;
        const gap = Date.now() - lastFrame;
        if (gap > (lastImage ? 10_000 : 30_000)) finish('error', 'CAMERA_FRAMES_STALLED');
        else if (lastImage && gap > 3000 && phase === 'live') update('connecting');
      }, 1000);
    }).catch(error => {
      finish(['UNKNOWN_ACTION', 'CAMERA_LIVE_UNSUPPORTED', 'UNSUPPORTED_PLATFORM'].includes(error?.code) ? 'unavailable' : 'error', error?.code);
    });
    return () => {
      persist();
      closed = true;
      if (keepalive) clearInterval(keepalive);
      if (watchdog) clearInterval(watchdog);
      unsubscribe();
      unsubscribeCache();
      release();
    };
  }, [key, accessory.id, accessory.homeId, supported, expanded, visible, connected, generation, resume]);

  // A hidden tab / dropped socket is never labelled Live using its last frame.
  const phase: CameraLivePhase = !expanded || !visible ? 'idle' : !connected && supported ? 'connecting' : current.phase;
  return {
    ...current, phase,
    image: current.image,
    usesLive: expanded && supported && !['unavailable', 'error', 'stopped'].includes(phase),
    resume: () => setResume(n => n + 1),
  };
}
