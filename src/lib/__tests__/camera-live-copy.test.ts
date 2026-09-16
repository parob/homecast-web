import { describe, expect, it } from 'vitest';
import { describeLiveView, type CameraLivePhase } from '../camera-live';

describe('camera status copy', () => {
  it.each<[CameraLivePhase, string | undefined]>([
    ['idle', undefined], ['connecting', 'Connecting…'], ['stopped', 'Paused'],
    ['queued', 'Queued'], ['unavailable', 'Snapshots only'], ['error', 'Connection lost'],
    ['live', 'Live · No audio'],
  ])('keeps %s concise', (phase, label) => expect(describeLiveView(phase)).toBe(label));
  it('keeps the queue position without the scheduling explanation', () => {
    expect(describeLiveView('queued', 2)).toBe('Queued · 2');
  });
  it.each([
    ['CAMERAS_DISABLED', 'Camera access unavailable'], ['PERMISSION_DENIED', 'Camera access unavailable'],
    ['CAMERA_RELAY_CHANGED', 'Relay changed'], ['CAMERA_VIEWER_LIMIT', 'Close another viewer'],
  ])('keeps the useful distinction for %s', (reason, label) => {
    expect(describeLiveView('error', undefined, reason)).toBe(label);
  });
});
