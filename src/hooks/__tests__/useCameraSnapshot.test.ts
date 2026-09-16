// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraSnapshot } from '../useCameraSnapshot';
import { clearCameraSnapshots } from '@/lib/camera-snapshot-cache';
import type { HomeKitAccessory } from '@/lib/graphql/types';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/server/connection', () => ({ serverConnection: { request } }));

let id = 0;
const camera = (): HomeKitAccessory => ({
  id: `freshness-${++id}`, homeId: 'home', name: 'Camera', isReachable: true,
  services: [], camera: { snapshot: true, stream: true },
});
const snapshot = (jpeg = 'QUJD') => ({
  jpeg, mimeType: 'image/jpeg', capturedAt: '2026-09-16T00:00:00Z',
  width: 1280, height: 720, cached: false,
});
const flush = () => act(async () => { await Promise.resolve(); });

beforeEach(() => {
  clearCameraSnapshots();
  vi.useFakeTimers();
  request.mockReset().mockResolvedValue(snapshot());
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('camera freshness', () => {
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
