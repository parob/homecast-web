import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CameraSnapshotCache, cameraSnapshotCacheKey } from '../camera-snapshot-cache';
import { cameraSnapshotStore } from '../camera-snapshot-store';
import type { SnapshotImage } from '../camera-snapshot';

const key = cameraSnapshotCacheKey('HOME', 'CAMERA');
const image: SnapshotImage = {
  dataUrl: 'data:image/jpeg;base64,QUJD', capturedAt: '2026-09-16T08:00:00Z',
  width: 720, height: 1280, source: 'stream',
};
const fresh = { ...image, capturedAt: '2026-09-16T09:00:00Z', dataUrl: 'data:image/jpeg;base64,REVG' };
function cache(account = 'alice', store = cameraSnapshotStore) {
  const result = new CameraSnapshotCache(store);
  result.setAccount(account);
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(async () => { await cameraSnapshotStore.clear(); });

describe('persistent last camera image', () => {
  it('restores the image, original timestamp, source and aspect ratio after a reload', async () => {
    const first = cache();
    first.set(key, image, first.epoch());
    await first.settled();
    const reloaded = cache();
    expect(reloaded.get(key)).toBeUndefined();
    await reloaded.restore(key);
    expect(reloaded.get(key)).toEqual(image);
  });

  it('replaces the same camera in place, and never regresses the capture time or same-image resolution', async () => {
    const first = cache();
    first.set(key, image, first.epoch());
    first.set(key, fresh, first.epoch());
    first.set(key, image, first.epoch());
    first.set(key, { ...fresh, width: 320 }, first.epoch());
    await first.settled();
    expect(await cameraSnapshotStore.read('alice', key)).toEqual(fresh);
  });

  it('isolates accounts and homes even when accessory ids are identical', async () => {
    const first = cache();
    first.set(key, image, first.epoch());
    await first.settled();
    const bob = cache('bob');
    await bob.restore(key);
    expect(bob.get(key)).toBeUndefined();
    const anotherHome = cameraSnapshotCacheKey('different-home', 'CAMERA');
    await first.restore(anotherHome);
    expect(first.get(anotherHome)).toBeUndefined();
    expect(cameraSnapshotCacheKey('home', 'camera')).toBe(key);
  });

  it('does not read disk before auth has selected a verified account', async () => {
    const read = vi.fn();
    const unsigned = new CameraSnapshotCache({ ...cameraSnapshotStore, read });
    await unsigned.restore(key);
    expect(read).not.toHaveBeenCalled();
  });

  it('does not let a slow disk read overwrite a fresh capture', async () => {
    const disk = deferred<SnapshotImage>();
    const first = cache('alice', { ...cameraSnapshotStore, read: () => disk.promise });
    const restoring = first.restore(key);
    await Promise.resolve();
    first.set(key, fresh, first.epoch());
    disk.resolve(image);
    await restoring;
    await first.settled();
    expect(first.get(key)).toEqual(fresh);
    expect(await cameraSnapshotStore.read('alice', key)).toEqual(fresh);
  });

  it('forgets both memory and disk on sign-out, including an already-running write', async () => {
    const entered = deferred<void>();
    const finish = deferred<void>();
    const first = cache('alice', { ...cameraSnapshotStore, write: async (...args) => {
      entered.resolve(); await finish.promise; await cameraSnapshotStore.write(...args);
    } });
    const generation = first.epoch();
    first.set(key, image, generation);
    await entered.promise;
    first.clear();
    first.set(key, fresh, generation); // old network response
    finish.resolve();
    await first.settled();
    expect(first.get(key)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', key)).toBeUndefined();
  });

  it('erases the previous account when switching without a reload', async () => {
    const first = cache();
    first.set(key, image, first.epoch());
    await first.settled();
    first.setAccount('bob');
    await first.restore(key);
    expect(first.get(key)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', key)).toBeUndefined();
  });

  it('cannot resurrect a revoked camera from a pending disk read or network response', async () => {
    const disk = deferred<SnapshotImage>();
    const first = cache('alice', { ...cameraSnapshotStore, read: () => disk.promise });
    const revision = first.revision(key);
    const restoring = first.restore(key);
    first.delete(key);
    disk.resolve(image);
    await restoring;
    first.set(key, fresh, first.epoch(), revision);
    await first.settled();
    expect(first.get(key)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', key)).toBeUndefined();
  });

  it('purges every image for an opted-out home but preserves other homes', async () => {
    const first = cache();
    const second = cameraSnapshotCacheKey('home', 'second');
    const other = cameraSnapshotCacheKey('other', 'camera');
    for (const k of [key, second, other]) first.set(k, image, first.epoch());
    await first.settled();
    const revision = first.revision(key);
    first.setHomeEnabled('HOME', false);
    first.setHomeEnabled('HOME', true);
    first.set(key, fresh, first.epoch(), revision);
    await first.settled();
    expect(first.get(key)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', key)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', second)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', other)).toEqual(image);
  });

  it('purges an opted-out home even when its images have not been hydrated', async () => {
    await cameraSnapshotStore.write('alice', key, image);
    const first = cache();
    first.setHomeEnabled('HOME', false);
    await first.restore(key);
    await first.settled();
    expect(first.get(key)).toBeUndefined();
    expect(await cameraSnapshotStore.read('alice', key)).toBeUndefined();
  });

  it('keeps memory viewing functional when browser storage is unavailable or full', async () => {
    const unavailable = vi.fn(async () => { throw new Error('QuotaExceededError'); });
    const first = cache('alice', { read: unavailable, write: unavailable, remove: unavailable, clear: unavailable });
    await first.restore(key);
    first.set(key, image, first.epoch());
    await first.settled();
    expect(first.get(key)).toEqual(image);
    first.clear();
    await first.settled();
    expect(first.get(key)).toBeUndefined();
  });

  it('ignores malformed persisted entries and failed captures', async () => {
    await cameraSnapshotStore.write('alice', key, { ...image, capturedAt: 'invalid' });
    const first = cache();
    await first.restore(key);
    expect(first.get(key)).toBeUndefined();
    first.set(key, image, first.epoch());
    first.set(key, { ...fresh, dataUrl: '' }, first.epoch());
    await first.settled();
    expect(first.get(key)).toEqual(image);
  });

  it('notifies already-mounted previews when another viewer captures or clears the image', async () => {
    const first = cache();
    const changed = vi.fn();
    const stop = first.subscribe(changed);
    first.set(key, image, first.epoch());
    first.delete(key);
    expect(changed).toHaveBeenCalledTimes(2);
    stop();
    first.clear();
    await first.settled();
    expect(changed).toHaveBeenCalledTimes(2);
  });
});
