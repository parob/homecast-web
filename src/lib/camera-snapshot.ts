/**
 * Camera snapshot policy — pure, so it can be unit-tested without a relay.
 *
 * A camera tile asks the relay for a still on a cadence while it is expanded.
 * The relay answers from its own cache when the last capture is recent enough,
 * and refuses to wake a battery camera more than once every few seconds, so
 * the client's job is to pace politely and to say something useful when the
 * answer is "no": the relay has no engine window (Community mode, iOS), the
 * relay cannot capture its own camera window, or the cloud in front of it predates
 * the feature.
 */

/** How often an expanded tile refreshes its still. */
export const SNAPSHOT_REFRESH_MS = 10_000;

/**
 * The relay serves its cached still if it is younger than this. A little under
 * the refresh so a tile that just opened gets a fresh capture rather than the
 * one from the previous viewer's last tick.
 */
export const SNAPSHOT_MAX_AGE_SEC = 8;

/** Ceiling on the back-off after repeated failures. */
export const SNAPSHOT_BACKOFF_MAX_MS = 60_000;

export interface CameraCapability {
  snapshot: boolean;
  stream: boolean;
}

export interface CameraSnapshotResult {
  accessoryId: string;
  mimeType: string;
  /** base64 JPEG */
  jpeg: string;
  capturedAt: string;
  width: number;
  height: number;
  cached: boolean;
}

export interface CameraFailure {
  code: string;
  message: string;
}

export type SnapshotStatus =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; dataUrl: string; capturedAt: string; width: number; height: number }
  | { kind: 'error'; failure: CameraFailure; dataUrl?: string; capturedAt?: string };

/** Whether a tile should be asking for stills at all right now. */
export function shouldPollSnapshots(input: {
  supported: boolean;
  expanded: boolean;
  pageVisible: boolean;
}): boolean {
  return input.supported && input.expanded && input.pageVisible;
}

/**
 * Delay before the next request. Success returns the normal cadence; a
 * failure backs off exponentially from 5s, capped, so a relay that cannot
 * capture is not asked four hundred times an hour.
 */
export function nextSnapshotDelayMs(consecutiveFailures: number): number {
  if (consecutiveFailures <= 0) return SNAPSHOT_REFRESH_MS;
  return Math.min(SNAPSHOT_BACKOFF_MAX_MS, 5_000 * 2 ** (consecutiveFailures - 1));
}

/**
 * Failures the tile should stop retrying on its own: nothing changes until a
 * person acts (restarts the relay, updates the cloud) so polling is noise.
 */
export function isPermanentCameraFailure(code: string): boolean {
  return (
    code === 'CAMERA_NOT_SUPPORTED' ||
    code === 'CAMERAS_DISABLED' ||
    code === 'CAMERA_UNAVAILABLE' ||
    code === 'SCREEN_RECORDING_DENIED' ||
    code === 'CAMERA_CAPTURE_UNAVAILABLE' ||
    code === 'UNKNOWN_ACTION' ||
    code === 'UNKNOWN_METHOD'
  );
}

/** One line a person can act on, for each way a still can fail. */
export function describeCameraFailure(failure: CameraFailure): string {
  switch (failure.code) {
    case 'CAMERAS_DISABLED':
      return 'Camera images are turned off for this home.';
    case 'SCREEN_RECORDING_DENIED':
    case 'CAMERA_CAPTURE_UNAVAILABLE':
      // Build 70 used SCREEN_RECORDING_DENIED for a failed own-window capture.
      // Neither error proves that macOS permission is missing.
      return 'Camera capture is unavailable. Restart Homecast on the relay Mac, then try again.';
    case 'CAMERA_UNAVAILABLE':
      return 'Camera images need the Homecast cloud relay running on a Mac.';
    case 'CAMERA_NOT_SUPPORTED':
      return 'This camera does not offer snapshots to HomeKit.';
    case 'UNKNOWN_ACTION':
      return 'Camera images are not available on this Homecast server yet.';
    case 'UNKNOWN_METHOD':
      return 'Camera images need a newer Homecast relay.';
    case 'CAMERA_BUSY':
      return 'The camera is busy. HomeKit allows two live streams per home.';
    case 'SNAPSHOT_TIMEOUT':
      return 'The camera did not answer in time.';
    case 'SNAPSHOT_EMPTY':
      return 'The relay could not capture the image.';
    default:
      return failure.message || 'Snapshot failed.';
  }
}

export function snapshotDataUrl(result: Pick<CameraSnapshotResult, 'jpeg' | 'mimeType'>): string {
  return `data:${result.mimeType || 'image/jpeg'};base64,${result.jpeg}`;
}

/** "12s ago" for a capture timestamp; `now` injectable for tests. */
export function describeCaptureAge(capturedAt: string, now: number = Date.now()): string {
  const t = Date.parse(capturedAt);
  if (Number.isNaN(t)) return '';
  const seconds = Math.max(0, Math.round((now - t) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}
