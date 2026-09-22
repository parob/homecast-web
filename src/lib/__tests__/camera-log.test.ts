import { describe, expect, it } from 'vitest';
import { cameraLogMetadata } from '../camera-log';

describe('camera diagnostic privacy', () => {
  it.each(['camera.snapshot', 'camera.frame', 'camera_frame', 'response:camera.snapshot', undefined])(
    'keeps only metadata for %s without mutating the actual payload', (action) => {
      const payload = { jpeg: 'PRIVATE_CAMERA_PIXELS', width: 320, height: 180, cached: false,
        source: 'stream', futureImageField: 'PRIVATE_CAMERA_PIXELS', nested: { jpeg: 'PRIVATE_CAMERA_PIXELS' } };
      const logged = cameraLogMetadata(action, payload);
      expect(logged).toEqual({ width: 320, height: 180, cached: false, source: 'stream' });
      expect(payload.jpeg).toBe('PRIVATE_CAMERA_PIXELS');
    },
  );

  it('keeps ordinary diagnostic objects unchanged', () => {
    const payload = { homeId: 'home', value: true };
    expect(cameraLogMetadata('characteristic.get', payload)).toBe(payload);
  });

  it('does not serialise unexpected camera payloads or nested metadata', () => {
    expect(cameraLogMetadata('camera.snapshot', ['PRIVATE_CAMERA_PIXELS'])).toBe('[camera payload omitted]');
    expect(cameraLogMetadata('camera.snapshot', { width: { jpeg: 'PRIVATE_CAMERA_PIXELS' } })).toEqual({});
    expect(cameraLogMetadata('camera.snapshot', null)).toBeNull();
  });

  it('cannot break a response when a diagnostic property throws', () => {
    const payload = { jpeg: 'PRIVATE_CAMERA_PIXELS', get width() { throw new Error('bad getter'); } };
    expect(cameraLogMetadata('camera.snapshot', payload)).toBe('[camera payload omitted]');
  });
});
