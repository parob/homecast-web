import { describe, expect, it } from 'vitest';
import {
  SNAPSHOT_REFRESH_MS,
  SNAPSHOT_BACKOFF_MAX_MS,
  describeCameraFailure,
  describeCaptureAge,
  isPermanentCameraFailure,
  nextSnapshotDelayMs,
  shouldPollSnapshots,
  snapshotDataUrl,
} from '../camera-snapshot';

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
    for (const code of ['SCREEN_RECORDING_DENIED', 'CAMERA_UNAVAILABLE', 'CAMERA_NOT_SUPPORTED', 'UNKNOWN_ACTION', 'UNKNOWN_METHOD']) {
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
  it('names the action for the permission case', () => {
    expect(describeCameraFailure({ code: 'SCREEN_RECORDING_DENIED', message: 'x' })).toMatch(/Screen Recording/);
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
