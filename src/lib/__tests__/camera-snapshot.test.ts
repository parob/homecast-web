import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_REFRESH_MS,
  SNAPSHOT_BACKOFF_MAX_MS,
  PREVIEW_REFRESH_MS,
  PREVIEW_BATTERY_REFRESH_MS,
  isBatteryPowered,
  isCloudManagedHome,
  previewMaxAgeSec,
  previewRefreshMs,
  describeCameraFailure,
  describeCaptureAge,
  isPermanentCameraFailure,
  nextSnapshotDelayMs,
  shouldPollSnapshots,
  snapshotDataUrl,
} from '../camera-snapshot';

describe('isCloudManagedHome', () => {
  it("is the member's flag, set by the cloud on the homes it operates", () => {
    expect(isCloudManagedHome({ isCloudManaged: true }, 'cloud')).toBe(true);
    expect(isCloudManagedHome({ isCloudManaged: true }, 'standard')).toBe(true);
  });

  it("is the relay's own account, which owns those homes and sees no flag", () => {
    expect(isCloudManagedHome({}, 'managed')).toBe(true);
    expect(isCloudManagedHome(undefined, 'managed')).toBe(true);
  });

  it('is not a plan: a cloud customer can run a self-hosted relay beside the managed one', () => {
    expect(isCloudManagedHome({ isCloudManaged: false }, 'cloud')).toBe(false);
    expect(isCloudManagedHome({}, 'cloud')).toBe(false);
    expect(isCloudManagedHome(null, 'standard')).toBe(false);
    expect(isCloudManagedHome({}, undefined)).toBe(false);
  });
});

describe('shouldPollSnapshots', () => {
  it('polls only for a supported camera on an expanded tile on a visible page', () => {
    expect(shouldPollSnapshots({ supported: true, expanded: true, pageVisible: true })).toBe(true);
    expect(shouldPollSnapshots({ supported: false, expanded: true, pageVisible: true })).toBe(false);
    expect(shouldPollSnapshots({ supported: true, expanded: false, pageVisible: true })).toBe(false);
    expect(shouldPollSnapshots({ supported: true, expanded: true, pageVisible: false })).toBe(false);
  });
});

describe('nextSnapshotDelayMs', () => {
  it('uses the normal cadence after a success', () => {
    expect(nextSnapshotDelayMs(0)).toBe(SNAPSHOT_REFRESH_MS);
  });

  it('backs off exponentially from 5s and caps', () => {
    expect(nextSnapshotDelayMs(1)).toBe(5_000);
    expect(nextSnapshotDelayMs(2)).toBe(10_000);
    expect(nextSnapshotDelayMs(3)).toBe(20_000);
    expect(nextSnapshotDelayMs(4)).toBe(40_000);
    expect(nextSnapshotDelayMs(5)).toBe(SNAPSHOT_BACKOFF_MAX_MS);
    expect(nextSnapshotDelayMs(50)).toBe(SNAPSHOT_BACKOFF_MAX_MS);
  });
});

describe('isPermanentCameraFailure', () => {
  it('stops polling when only a person can change the answer', () => {
    for (const code of ['SCREEN_RECORDING_DENIED', 'CAMERA_CAPTURE_UNAVAILABLE', 'CAMERA_UNAVAILABLE', 'CAMERA_NOT_SUPPORTED', 'UNKNOWN_ACTION', 'UNKNOWN_METHOD']) {
      expect(isPermanentCameraFailure(code)).toBe(true);
    }
  });

  it('keeps retrying transient failures', () => {
    for (const code of ['SNAPSHOT_TIMEOUT', 'SNAPSHOT_EMPTY', 'CAMERA_BUSY', 'TIMEOUT', 'INTERNAL_ERROR']) {
      expect(isPermanentCameraFailure(code)).toBe(false);
    }
  });
});

describe('describeCameraFailure', () => {
  it('does not mistake a failed own-window capture for missing macOS permission', () => {
    for (const code of ['SCREEN_RECORDING_DENIED', 'CAMERA_CAPTURE_UNAVAILABLE']) {
      expect(describeCameraFailure({ code, message: 'x' })).toMatch(/could not capture/);
      expect(describeCameraFailure({ code, message: 'x' })).not.toMatch(/permission|Screen Recording/);
    }
  });

  it('falls back to the relay message for unknown codes', () => {
    expect(describeCameraFailure({ code: 'WEIRD', message: 'something odd' })).toBe('something odd');
    expect(describeCameraFailure({ code: 'WEIRD', message: '' })).toBe('Snapshot failed.');
  });
});

describe('snapshotDataUrl', () => {
  it('builds a data URL and defaults the mime type', () => {
    expect(snapshotDataUrl({ jpeg: 'AAAA', mimeType: 'image/jpeg' })).toBe('data:image/jpeg;base64,AAAA');
    expect(snapshotDataUrl({ jpeg: 'AAAA', mimeType: '' })).toBe('data:image/jpeg;base64,AAAA');
  });
});

describe('describeCaptureAge', () => {
  const now = Date.parse('2026-09-15T12:00:00Z');
  it('reads naturally across the scales', () => {
    expect(describeCaptureAge('2026-09-15T11:59:58Z', now)).toBe('just now');
    expect(describeCaptureAge('2026-09-15T11:59:30Z', now)).toBe('30s ago');
    expect(describeCaptureAge('2026-09-15T11:55:00Z', now)).toBe('5m ago');
    expect(describeCaptureAge('2026-09-15T09:00:00Z', now)).toBe('3h ago');
    expect(describeCaptureAge('not a date', now)).toBe('');
  });
});

describe('background tile pacing', () => {
  const service = (serviceType: string, characteristicTypes: string[] = []) => ({
    id: serviceType, name: serviceType, serviceType,
    characteristics: characteristicTypes.map((characteristicType, i) => ({
      id: `${serviceType}-${i}`, characteristicType, isReadable: true, isWritable: false,
    })),
  });

  it('reads a battery from the service or either characteristic, however the relay names it', () => {
    expect(isBatteryPowered({ services: [service('battery')] })).toBe(true);
    expect(isBatteryPowered({ services: [service('00000096-0000-1000-8000-0026BB765291')] })).toBe(true);
    expect(isBatteryPowered({ services: [service('camera_rtp_stream_management', ['battery_level'])] })).toBe(true);
    expect(isBatteryPowered({ services: [service('camera_rtp_stream_management', ['status_low_battery'])] })).toBe(true);
    expect(isBatteryPowered({ services: [service('camera_rtp_stream_management', ['on'])] })).toBe(false);
    expect(isBatteryPowered({ services: [] })).toBe(false);
  });

  it('backs a battery camera off, and leaves a mains one alone', () => {
    expect(previewRefreshMs(false)).toBe(PREVIEW_REFRESH_MS);
    expect(previewRefreshMs(true)).toBe(PREVIEW_BATTERY_REFRESH_MS);
    expect(previewRefreshMs(true)).toBeGreaterThan(previewRefreshMs(false));
  });

  it('never accepts a still narrower than its own cadence', () => {
    // #152: maxAgeSec was 55 against a 60s interval, so the relay's cache was
    // unreachable by construction and every poll woke the camera. The window
    // has to be at least the interval, or there is no coalescing at all.
    for (const battery of [false, true]) {
      expect(previewMaxAgeSec(battery) * 1000).toBeGreaterThanOrEqual(previewRefreshMs(battery));
    }
  });

  it('keeps the opened viewer faster than any background tile', () => {
    expect(SNAPSHOT_REFRESH_MS).toBeLessThan(previewRefreshMs(false));
  });
});
