// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCameraLive } from '../useCameraLive';
import { cameraSnapshotCacheKey, clearCameraSnapshots, getCameraSnapshot, setCameraHomeEnabled, setCameraSnapshotAccount } from '@/lib/camera-snapshot-cache';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import type { CameraLiveEvent } from '@/lib/camera-live';

const mock = vi.hoisted(() => ({ request: vi.fn(), broadcasts: new Set<(e: unknown) => void>(), stateListeners: new Set<(e: unknown) => void>(), connected: true }));
vi.mock('@/server/connection', () => ({ serverConnection: {
  request: mock.request,
  getState: () => ({ connectionState: mock.connected ? 'connected' : 'disconnected' }),
  subscribe: (cb: (e: unknown) => void) => { mock.stateListeners.add(cb); return () => mock.stateListeners.delete(cb); },
  subscribeToBroadcasts: (cb: (e: unknown) => void) => { mock.broadcasts.add(cb); return () => mock.broadcasts.delete(cb); },
} }));
const camera: HomeKitAccessory = { id: 'camera', homeId: 'home', name: 'Camera', services: [], isReachable: true, camera: { snapshot: true, stream: true } };
const flush = () => act(async () => { await Promise.resolve(); });
const emit = (event: CameraLiveEvent) => act(() => mock.broadcasts.forEach(cb => cb(event)));
const starts = () => mock.request.mock.calls.filter(c => c[0] === 'camera.live.start');
const watch = () => starts().at(-1)![1].watchId as string;
const frame = (seq = 1): CameraLiveEvent => ({ type: 'camera_frame', watchId: watch(), streamId: 'stream', homeId: 'home', accessoryId: 'camera', seq, jpeg: '/9j/AAAA', width: 960, height: 540, capturedAt: new Date(Date.now() + seq).toISOString() });

beforeEach(() => {
  clearCameraSnapshots(); setCameraSnapshotAccount('viewer');
  vi.useFakeTimers();
  mock.connected = true;
  mock.broadcasts.clear(); mock.stateListeners.clear();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  mock.request.mockReset().mockImplementation(async (action, payload) => ({ watchId: payload.watchId, streamId: 'stream', state: action === 'camera.live.stop' ? 'stopped' : 'streaming' }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('live camera lifecycle', () => {
  it('only opens a visible expanded stream-capable camera and labels Live after a frame', async () => {
    const view = renderHook(({ expanded }) => useCameraLive(camera, expanded), { initialProps: { expanded: false } });
    expect(mock.request).not.toHaveBeenCalled();
    view.rerender({ expanded: true }); await flush();
    expect(view.result.current.phase).toBe('connecting');
    emit(frame());
    expect(view.result.current.phase).toBe('live');
    expect(view.result.current.image?.source).toBe('stream');
  });

  it('keeps alive only its watch and releases on close', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush();
    const watchId = watch();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(mock.request).toHaveBeenCalledWith('camera.live.keepalive', { watchId });
    view.unmount();
    expect(mock.request).toHaveBeenLastCalledWith('camera.live.stop', { watchId });
  });

  it('shows the queue without timing out a waiting camera or polling stills', async () => {
    mock.request.mockImplementation(async (_, payload) => ({ watchId: payload.watchId, streamId: 'stream', state: 'queued', queuePosition: 2 }));
    const view = renderHook(() => useCameraLive(camera, true)); await flush();
    expect(view.result.current).toMatchObject({ phase: 'queued', queuePosition: 2, usesLive: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(40_000); });
    expect(view.result.current.phase).toBe('queued');
    emit({ type: 'camera_live_state', watchId: watch(), streamId: 'stream', state: 'streaming' });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(view.result.current.phase).toBe('connecting');
    emit(frame());
    expect(view.result.current.phase).toBe('live');
  });

  it('does not let an old session or out-of-order frame overwrite the picture', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush();
    emit(frame(2));
    const image = view.result.current.image;
    emit({ ...frame(3), streamId: 'old' }); emit(frame(1)); emit({ ...frame(4), watchId: 'someone-else' });
    expect(view.result.current.image).toBe(image);
  });

  it('stops on hide, reconnects when visible, and never calls an old still Live', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush(); emit(frame());
    const old = watch();
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' }); document.dispatchEvent(new Event('visibilitychange')); });
    expect(view.result.current.phase).toBe('idle');
    expect(mock.request).toHaveBeenCalledWith('camera.live.stop', { watchId: old });
    act(() => { Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }); document.dispatchEvent(new Event('visibilitychange')); });
    await flush();
    expect(starts()).toHaveLength(2);
    expect(watch()).not.toBe(old);
    expect(view.result.current.phase).toBe('connecting');
  });

  it('expires honestly and resumes only on an explicit tap', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush(); emit(frame());
    emit({ type: 'camera_live_state', watchId: watch(), streamId: 'stream', state: 'stopped', reason: 'expired' });
    expect(view.result.current).toMatchObject({ phase: 'stopped', usesLive: false });
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(starts()).toHaveLength(1);
    act(() => view.result.current.resume()); await flush();
    expect(starts()).toHaveLength(2);
  });

  it('retains timestamp and image when frames stop, without claiming Live', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush(); emit(frame());
    const image = view.result.current.image;
    await act(async () => { await vi.advanceTimersByTimeAsync(4000); });
    expect(view.result.current.phase).toBe('connecting');
    await act(async () => { await vi.advanceTimersByTimeAsync(7000); });
    expect(view.result.current.phase).toBe('error');
    expect(view.result.current.image).toEqual(image);
  });

  it('drops images and releases the lease on account change or home opt-out', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush(); emit(frame());
    act(() => setCameraHomeEnabled('home', false));
    expect(view.result.current.image).toBeUndefined();
    expect(view.result.current.phase).toBe('error');
    expect(mock.request).toHaveBeenLastCalledWith('camera.live.stop', { watchId: watch() });
    act(() => clearCameraSnapshots());
    expect(view.result.current.image).toBeUndefined();
  });

  it('does not revive images after a server authorization denial', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush(); emit(frame());
    emit({ type: 'camera_live_state', watchId: watch(), streamId: 'stream', state: 'stopped', reason: 'PERMISSION_DENIED' });
    emit(frame(2));
    expect(view.result.current.image).toBeUndefined();
    expect(getCameraSnapshot(cameraSnapshotCacheKey('home', 'camera'))).toBeUndefined();
    expect(starts()).toHaveLength(1);
  });

  it('persists only periodic frames, then flushes the final frame on close', async () => {
    const view = renderHook(() => useCameraLive(camera, true)); await flush();
    const key = cameraSnapshotCacheKey('home', 'camera');
    emit(frame(1)); const first = getCameraSnapshot(key);
    emit(frame(2)); emit(frame(3));
    expect(getCameraSnapshot(key)).toBe(first);
    const final = view.result.current.image;
    view.unmount();
    expect(getCameraSnapshot(key)).toEqual(final);
  });

  it.each(['CAMERA_LIVE_UNSUPPORTED', 'UNKNOWN_ACTION'])('falls back to snapshots on %s', async code => {
    mock.request.mockRejectedValue({ code });
    const view = renderHook(() => useCameraLive(camera, true)); await flush();
    expect(view.result.current).toMatchObject({ phase: 'unavailable', usesLive: false });
  });

  it('releases again if a start response arrives after the viewer closed', async () => {
    let resolve!: (value: unknown) => void;
    mock.request.mockImplementation((action, payload) => action === 'camera.live.start' ? new Promise(r => { resolve = r; }) : Promise.resolve({ watchId: payload.watchId, state: 'stopped' }));
    const view = renderHook(() => useCameraLive(camera, true)); const id = watch();
    view.unmount();
    await act(async () => resolve({ watchId: id, streamId: 'stream', state: 'streaming' }));
    expect(mock.request.mock.calls.filter(c => c[0] === 'camera.live.stop')).toHaveLength(2);
  });
});
