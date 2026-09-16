/** Camera diagnostics describe a capture; they never retain its pixels. */
const METADATA_KEYS = new Set([
  'homeId', 'accessoryId', 'capturedAt', 'mimeType', 'width', 'height', 'cached', 'source',
  'maxWidth', 'maxAgeSec', 'seq', 'state', 'reason', 'started', 'activeStreams', 'fps', 'quality',
  'supported', 'engineWindow', 'captureAvailable', 'screenRecordingAuthorization', 'screenRecording',
  'maxStreamsPerHome',
]);

export function cameraLogMetadata(action: string | undefined, value: unknown): unknown {
  const object = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  if (!/(^|:)camera[._]/.test(action ?? '') && !Object.prototype.hasOwnProperty.call(object ?? {}, 'jpeg')) {
    return value;
  }
  if (value === null || value === undefined) return value;
  if (!object) return '[camera payload omitted]';
  const metadata: Record<string, unknown> = {};
  for (const key of METADATA_KEYS) {
    const item = object[key];
    if (typeof item === 'string') metadata[key] = item.slice(0, 200);
    else if (typeof item === 'number' || typeof item === 'boolean' || item === null) metadata[key] = item;
  }
  return metadata;
}
