import type { SnapshotImage } from './camera-snapshot';
import { cameraSnapshotStore } from './camera-snapshot-store';

export function cameraSnapshotCacheKey(homeId: string | undefined, accessoryId: string): string {
  return JSON.stringify([homeId?.toLowerCase() ?? null, accessoryId.toLowerCase()]);
}

function validImage(image: SnapshotImage | undefined): image is SnapshotImage {
  return !!image && typeof image.dataUrl === 'string' && image.dataUrl.startsWith('data:image/jpeg;base64,') &&
    image.dataUrl.length > 23 && Number.isFinite(Date.parse(image.capturedAt)) &&
    Number.isFinite(image.width) && image.width > 0 && Number.isFinite(image.height) && image.height > 0 &&
    (image.source === undefined || image.source === 'stream' || image.source === 'snapshot');
}

/** Latest still only, with its ORIGINAL timestamp. Persistence is best-effort:
 * private browsing, full storage, or browser eviction must not break viewing.
 * Auth selects a verified account before disk reads/writes are permitted.
 */
export class CameraSnapshotCache {
  private account: string | null = null;
  private generation = 0;
  private images = new Map<string, SnapshotImage>();
  private revisions = new Map<string, number>();
  private homeRevisions = new Map<string, number>();
  private disabledHomes = new Set<string>();
  private listeners = new Set<() => void>();
  private loading = new Map<string, Promise<void>>();
  private operations: Promise<void> = Promise.resolve();

  constructor(private store = cameraSnapshotStore) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private notify() { this.listeners.forEach(listener => listener()); }
  epoch = (): number => this.generation;
  owner = (): string | null => this.account;
  revision = (key: string): number => (this.revisions.get(key) ?? 0) + (this.homeRevisions.get(JSON.parse(key)[0]) ?? 0);
  get = (key: string): SnapshotImage | undefined => this.images.get(key);

  private permitted(key: string): boolean {
    return !this.disabledHomes.has(JSON.parse(key)[0]);
  }

  private enqueue(operation: () => Promise<unknown>): Promise<void> {
    // Preserve write/delete ordering, including logout while an IDB open or
    // transaction is pending. Never log errors containing private image data.
    this.operations = this.operations.then(operation).then(() => {}, () => {});
    return this.operations;
  }

  setAccount = (account: string): void => {
    if (this.account === account) return;
    const previous = this.account;
    this.account = account;
    this.generation++;
    this.images.clear();
    this.loading.clear();
    this.revisions.clear();
    this.homeRevisions.clear();
    this.disabledHomes.clear();
    if (previous) void this.enqueue(() => this.store.remove(previous));
    this.notify();
  };

  restore = (key: string): Promise<void> => {
    const account = this.account;
    if (!account || !this.permitted(key) || this.images.has(key)) return Promise.resolve();
    const pending = this.loading.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const revision = this.revision(key);
    const task = this.enqueue(async () => {
      const image = await this.store.read(account, key);
      // A fresh capture, revocation, or sign-out may beat this disk read.
      if (generation !== this.generation || revision !== this.revision(key) || !this.permitted(key) || this.images.has(key)) return;
      if (validImage(image)) { this.images.set(key, image); this.notify(); }
    });
    this.loading.set(key, task);
    void task.then(() => { if (this.loading.get(key) === task) this.loading.delete(key); });
    return task;
  };

  set = (key: string, image: SnapshotImage, generation: number, revision = this.revision(key)): void => {
    if (generation !== this.generation || revision !== this.revision(key) || !this.permitted(key) || !validImage(image)) return;
    const previous = this.images.get(key);
    // Two viewers may finish out of order. Never replace a newer still with
    // an older one, or the same capture with a lower-resolution preview.
    if (previous && (Date.parse(previous.capturedAt) > Date.parse(image.capturedAt) ||
      (previous.capturedAt === image.capturedAt && previous.width > image.width))) return;
    this.images.set(key, image);
    this.notify();
    const account = this.account;
    if (account) void this.enqueue(async () => {
      if (generation === this.generation && revision === this.revision(key) && this.permitted(key)) {
        await this.store.write(account, key, image);
      }
    });
  };

  delete = (key: string): void => {
    this.revisions.set(key, (this.revisions.get(key) ?? 0) + 1);
    this.images.delete(key);
    this.loading.delete(key);
    const account = this.account;
    if (account) void this.enqueue(() => this.store.remove(account, key));
    this.notify();
  };

  setHomeEnabled = (homeId: string, enabled: boolean): void => {
    const home = homeId.toLowerCase();
    if (enabled) { this.disabledHomes.delete(home); return; }
    if (this.disabledHomes.has(home)) return;
    this.disabledHomes.add(home);
    this.homeRevisions.set(home, (this.homeRevisions.get(home) ?? 0) + 1);
    for (const key of this.images.keys()) {
      if (JSON.parse(key)[0] === home) this.images.delete(key);
    }
    const account = this.account;
    if (account) void this.enqueue(() => this.store.remove(account, undefined, home));
    this.notify();
  };

  clear = (): void => {
    this.generation++;
    this.account = null;
    this.images.clear();
    this.loading.clear();
    this.revisions.clear();
    this.homeRevisions.clear();
    this.disabledHomes.clear();
    void this.enqueue(() => this.store.clear());
    this.notify();
  };

  /** Await cache IO for tests; rendering never waits for writes. */
  settled = (): Promise<void> => this.operations;
}

const cache = new CameraSnapshotCache();
export const cameraSnapshotCacheGeneration = cache.epoch;
export const cameraSnapshotAccount = cache.owner;
export const cameraSnapshotCacheRevision = cache.revision;
export const subscribeCameraSnapshots = cache.subscribe;
export const setCameraSnapshotAccount = cache.setAccount;
export const getCameraSnapshot = cache.get;
export const restoreCameraSnapshot = cache.restore;
export const setCameraSnapshot = cache.set;
export const deleteCameraSnapshot = cache.delete;
export const setCameraHomeEnabled = cache.setHomeEnabled;
export const clearCameraSnapshots = cache.clear;
