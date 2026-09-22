import { test, expect } from '@playwright/test';

// A blank same-origin page keeps unrelated app auth and transport out of this
// storage test. The imported cache/store are the actual Vite-served modules.
test('last camera image survives a real page reload with its original timestamp', async ({ page }) => {
  await page.route('**/camera-cache-check', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Camera cache test</title>' }));
  await page.goto('/camera-cache-check');
  const original = { dataUrl: 'data:image/jpeg;base64,QUJD', capturedAt: '2026-09-15T12:00:00Z', width: 720, height: 1280, source: 'stream' };
  await page.evaluate(async image => {
    const module = await import(new URL('/src/lib/camera-snapshot-cache.ts', location.href).href);
    module.setCameraSnapshotAccount('camera-browser-test');
    module.setCameraSnapshot(module.cameraSnapshotCacheKey('home', 'camera'), image, module.cameraSnapshotCacheGeneration());
  }, original);
  await expect.poll(() => page.evaluate(async () => {
    const { cameraSnapshotStore } = await import(new URL('/src/lib/camera-snapshot-store.ts', location.href).href);
    return cameraSnapshotStore.read('camera-browser-test', JSON.stringify(['home', 'camera']));
  })).toEqual(original);

  await page.reload();
  expect(await page.evaluate(async () => {
    const module = await import(new URL('/src/lib/camera-snapshot-cache.ts', location.href).href);
    const key = module.cameraSnapshotCacheKey('home', 'camera');
    module.setCameraSnapshotAccount('different-account');
    await module.restoreCameraSnapshot(key);
    return module.getCameraSnapshot(key) ?? null;
  })).toBeNull();

  // A new document for the original account can recover its last still even
  // with no camera transport at all; the timestamp is not rewritten to now.
  await page.reload();
  expect(await page.evaluate(async () => {
    const module = await import(new URL('/src/lib/camera-snapshot-cache.ts', location.href).href);
    const key = module.cameraSnapshotCacheKey('home', 'camera');
    module.setCameraSnapshotAccount('camera-browser-test');
    await module.restoreCameraSnapshot(key);
    return module.getCameraSnapshot(key);
  })).toEqual(original);

  await page.evaluate(async () => {
    const module = await import(new URL('/src/lib/camera-snapshot-cache.ts', location.href).href);
    module.clearCameraSnapshots();
  });
  await expect.poll(() => page.evaluate(async () => {
    const { cameraSnapshotStore } = await import(new URL('/src/lib/camera-snapshot-store.ts', location.href).href);
    return (await cameraSnapshotStore.read('camera-browser-test', JSON.stringify(['home', 'camera']))) ?? null;
  })).toBeNull();
  await page.reload();
  expect(await page.evaluate(async () => {
    const module = await import(new URL('/src/lib/camera-snapshot-cache.ts', location.href).href);
    module.setCameraSnapshotAccount('camera-browser-test');
    const key = module.cameraSnapshotCacheKey('home', 'camera');
    await module.restoreCameraSnapshot(key);
    return module.getCameraSnapshot(key) ?? null;
  })).toBeNull();
});
