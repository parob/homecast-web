import type { SnapshotImage } from './camera-snapshot';

// Memory only: private camera images are never persisted to browser storage.
const snapshots = new Map<string, SnapshotImage>();
let generation = 0;

export function cameraSnapshotCacheKey(homeId: string | undefined, accessoryId: string): string {
  return JSON.stringify([homeId ?? null, accessoryId]);
}

export function cameraSnapshotCacheGeneration(): number {
  return generation;
}

export function getCameraSnapshot(key: string): SnapshotImage | undefined {
  return snapshots.get(key);
}

export function setCameraSnapshot(key: string, image: SnapshotImage, requestGeneration: number): void {
  if (requestGeneration === generation) snapshots.set(key, image);
}

export function deleteCameraSnapshot(key: string): void {
  snapshots.delete(key);
}

export function clearCameraSnapshots(): void {
  // A response already on its way when sign-out occurs must not repopulate
  // the next account's cache. The hook also rejects its stale UI update.
  generation++;
  snapshots.clear();
}
