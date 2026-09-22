// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraSnapshot } from '../useCameraSnapshot';
import { clearCameraSnapshots, setCameraSnapshotAccount } from '@/lib/camera-snapshot-cache';
import { cameraSnapshotStore } from '@/lib/camera-snapshot-store';
import type { HomeKitAccessory } from '@/lib/graphql/types';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/server/connection', () => ({ serverConnection: { request } }));

let id = 0;
const camera = (): HomeKitAccessory => ({
  id: `freshness-${++id}`, homeId: `home-${id}`, name: 'Camera', isReachable: true,
  services: [], camera: { snapshot: true, stream: true },
});
const batteryCamera = (): HomeKitAccessory => ({
  ...camera(),
  services: [
    { id: 'b1', name: 'Battery', serviceType: 'battery', characteristics: [
      { id: 'b1c1', characteristicType: 'battery_level', value: 87, isReadable: true, isWritable: false },
    ] },
  ],
});
const snapshot = (jpeg = 'QUJD') => ({
  jpeg, mimeType: 'image/jpeg', capturedAt: '2026-09-16T00:00:00Z',
  width: 1280, height: 720, cached: false,
});
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  vi.restoreAllMocks();
  clearCameraSnapshots();
  setCameraSnapshotAccount('test-account');
  vi.useFakeTimers();
  request.mockReset().mockResolvedValue(snapshot());
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('camera freshness', () => {
  it('labels an old relay fallback as a failed refresh without changing its timestamp', async () => {
    request.mockResolvedValue({ ...snapshot(), cached: true, stale: true, refreshError: { code: 'CAMERA_BUSY', message: 'Busy' } });
    const accessory = camera();
    const { result } = renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    expect(request).toHaveBeenCalledWith('camera.snapshot', expect.objectContaining({ allowStaleOnError: true }));
    expect(result.current.status).toMatchObject({ kind: 'error', capturedAt: snapshot().capturedAt, dataUrl: 'data:image/jpeg;base64,QUJD', failure: { code: 'CAMERA_BUSY' } });
  });

  it('restores a persisted image and its original time even when the first refresh fails', async () => {
    const stored = { dataUrl: 'data:image/jpeg;base64,QUJD', capturedAt: '2026-09-15T12:00:00Z', width: 720, height: 1280, source: 'stream' as const };
    vi.spyOn(cameraSnapshotStore, 'read').mockResolvedValue(stored);
    request.mockRejectedValue({ code: 'RELAY_DISCONNECTED', message: 'Offline' });
    const accessory = camera();
    const { result } = renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    expect(result.current.status).toMatchObject({ kind: 'error', ...stored });
  });

  it('updates a mounted paused preview when the opened viewer captures a new image', async () => {
    const accessory = camera();
    const preview = renderHook(() => useCameraSnapshot(accessory, false, true));
    renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    expect(preview.result.current.status).toMatchObject({ kind: 'ready', capturedAt: snapshot().capturedAt, dataUrl: 'data:image/jpeg;base64,QUJD' });
    act(() => clearCameraSnapshots());
    expect(preview.result.current.status.kind).toBe('idle');
  });

  it('uses a smaller still and a one-minute cadence for visible tile previews', async () => {
    const accessory = camera();
    const { rerender } = renderHook(({ visible }) => useCameraSnapshot(accessory, visible, true), { initialProps: { visible: true } });
    await flush();
    // maxAgeSec matches the cadence rather than undercutting it: a window
    // narrower than the interval can never be hit, so every poll became a wake.
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxWidth: 480, maxAgeSec: 60 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(request).toHaveBeenCalledTimes(2);
    rerender({ visible: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('backs a battery camera off to a ten-minute background cadence', async () => {
    // A eufy battery doorbell, as #152 reported it: a camera profile plus
    // HomeKit's Battery service. A capture wakes the camera, so a collapsed
    // tile nobody is looking at asks once every ten minutes, not every minute.
    const accessory = batteryCamera();
    renderHook(() => useCameraSnapshot(accessory, true, true));
    await flush();
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxAgeSec: 600 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000); });
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('leaves an opened battery camera on the ten-second viewer cadence', async () => {
    // The complaint was background stills. Someone with the viewer open is
    // looking at it, and pays for it knowingly.
    const accessory = batteryCamera();
    renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxAgeSec: 0 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not start a queued preview after it leaves the viewport', async () => {
    const accessory = camera();
    let release!: (value: ReturnType<typeof snapshot>) => void;
    request.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    renderHook(() => useCameraSnapshot(accessory, true, true));
    const queued = renderHook(({ visible }) => useCameraSnapshot({ ...accessory, id: 'queued' }, visible, true), { initialProps: { visible: true } });
    expect(request).toHaveBeenCalledTimes(1);
    queued.rerender({ visible: false });
    await act(async () => release(snapshot()));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('requests a fresh image on opening, manual refresh, and each polling tick', async () => {
    const { result } = renderHook(() => useCameraSnapshot(cameraA, true));
    await flush();
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxAgeSec: 0 }));
    act(() => result.current.refresh());
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxAgeSec: 0 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(request).toHaveBeenCalledTimes(3);
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxAgeSec: 0 }));
  });
  const cameraA = camera();

  it('does not retain a different camera image when the accessory changes', async () => {
    const { result, rerender } = renderHook(({ accessory }) => useCameraSnapshot(accessory, true), { initialProps: { accessory: camera() } });
    await flush();
    expect(result.current.status.kind).toBe('ready');
    request.mockReturnValue(new Promise(() => {}));
    rerender({ accessory: camera() });
    expect(result.current.status.kind).not.toBe('ready');
  });

  it('keeps the last image and its dimensions through a transient failure and retry', async () => {
    const { result } = renderHook(() => useCameraSnapshot(cameraB, true));
    await flush();
    request.mockRejectedValueOnce({ code: 'SNAPSHOT_TIMEOUT', message: 'timeout' });
    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toMatchObject({ kind: 'error', dataUrl: 'data:image/jpeg;base64,QUJD', width: 1280, height: 720 });
    request.mockReturnValue(new Promise(() => {}));
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(result.current.status).toMatchObject({ dataUrl: 'data:image/jpeg;base64,QUJD' });
  });
  const cameraB = camera();

  it('removes the previous image when camera access is refused', async () => {
    const { result } = renderHook(() => useCameraSnapshot(cameraC, true));
    await flush();
    request.mockRejectedValue({ code: 'PERMISSION_DENIED', message: 'Access denied' });
    act(() => result.current.refresh());
    await flush();
    expect(result.current.status).toMatchObject({ kind: 'error' });
    expect(result.current.status).not.toHaveProperty('dataUrl');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).toHaveBeenCalledTimes(2);
  });
  const cameraC = camera();

  it('does not show a cached image under another home with the same accessory id', async () => {
    const accessory = camera();
    const first = renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    expect(first.result.current.status.kind).toBe('ready');
    first.unmount();
    const next = renderHook(() => useCameraSnapshot({ ...accessory, homeId: 'another-home' }, false));
    expect(next.result.current.status.kind).toBe('idle');
  });

  it('forgets camera images when the auth session is cleared', async () => {
    const accessory = camera();
    const first = renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    expect(first.result.current.status.kind).toBe('ready');
    act(() => clearCameraSnapshots());
    first.unmount();
    const next = renderHook(() => useCameraSnapshot(accessory, false));
    expect(next.result.current.status.kind).toBe('idle');
  });

  it('does not restore an old session image when an in-flight response arrives after sign-out', async () => {
    const accessory = camera();
    let resolve!: (value: ReturnType<typeof snapshot>) => void;
    request.mockReturnValueOnce(new Promise(r => { resolve = r; }));
    const first = renderHook(() => useCameraSnapshot(accessory, true));
    act(() => clearCameraSnapshots());
    await act(async () => resolve(snapshot()));
    expect(first.result.current.status.kind).not.toBe('ready');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).toHaveBeenCalledTimes(1);
    first.unmount();
    const next = renderHook(() => useCameraSnapshot(accessory, false));
    expect(next.result.current.status.kind).toBe('idle');
  });

  it('pauses hidden-page polling and requests fresh data on return', async () => {
    const accessory = camera();
    renderHook(() => useCameraSnapshot(accessory, true));
    await flush();
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(request).toHaveBeenCalledTimes(1);
    act(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenLastCalledWith('camera.snapshot', expect.objectContaining({ maxAgeSec: 0 }));
  });
});
