/** Cloud-owned viewing subscription; never a native HomeKit viewer lease. */
export interface CameraLiveStatus {
  watchId: string;
  streamId?: string;
  homeId?: string;
  accessoryId?: string;
  state: 'queued' | 'starting' | 'streaming' | 'stopped';
  reason?: string;
  queuePosition?: number;
  maxStreamsPerHome?: number;
}

export interface CameraLiveFrame {
  type: 'camera_frame';
  watchId: string;
  streamId: string;
  homeId: string;
  accessoryId: string;
  seq: number;
  jpeg: string;
  width: number;
  height: number;
  capturedAt: string;
}

export type CameraLiveEvent = CameraLiveFrame | ({ type: 'camera_live_state' } & CameraLiveStatus);
export type CameraLivePhase = 'idle' | 'connecting' | 'queued' | 'live' | 'stopped' | 'unavailable' | 'error';

export function describeLiveView(phase: CameraLivePhase, position?: number, reason?: string): string | undefined {
  if (phase === 'live') return 'Live · No audio';
  if (phase === 'connecting') return 'Connecting to camera…';
  if (phase === 'queued') return `Waiting for a camera slot${position ? ` · Queue ${position}` : ''}. Up to two cameras can stream per home.`;
  if (phase === 'unavailable') return 'Live view needs an updated Homecast relay. Showing snapshots.';
  if (phase === 'stopped') return 'Live view paused. Resume when you’re ready.';
  if (phase === 'error') {
    if (reason === 'CAMERAS_DISABLED' || reason === 'PERMISSION_DENIED') return 'Camera access is no longer available.';
    if (reason === 'CAMERA_RELAY_CHANGED') return 'The relay changed. Resume to reconnect.';
    if (reason === 'CAMERA_VIEWER_LIMIT') return 'Close another camera viewer, then resume.';
    return 'Live view interrupted. Showing the last image.';
  }
  return undefined;
}

export function isLiveFrame(value: CameraLiveFrame): boolean {
  return typeof value.jpeg === 'string' && value.jpeg.length <= 1_500_000 && value.jpeg.startsWith('/9j/') &&
    Number.isInteger(value.seq) && value.seq > 0 && Number.isInteger(value.width) && value.width > 0 && value.width <= 4096 &&
    Number.isInteger(value.height) && value.height > 0 && value.height <= 4096 && Number.isFinite(Date.parse(value.capturedAt));
}
