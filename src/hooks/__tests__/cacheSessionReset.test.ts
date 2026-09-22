// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('../../server/connection', () => ({ serverConnection: { request } }));

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  request.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('ending a HomeKit cache session', () => {
  it('does not persist an old account response after sign-out', async () => {
    const old = deferred();
    request.mockReturnValue(old.promise);
    const { useRooms, clearPersistedHomeKitCache, getCachedListLength } = await import('../useHomeKitData');
    const hook = renderHook(() => useRooms('H1'));
    hook.unmount();
    clearPersistedHomeKitCache();
    await act(async () => { old.resolve({ rooms: [{ id: 'OLD', name: 'Previous account' }] }); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    expect(getCachedListLength('rooms:H1')).toBeNull();
    expect(localStorage.getItem('homecast-homekit-cache')).toBeNull();
  });

  it.each(['resolve', 'reject'])('starts a new read when an old account request will later %s', async (outcome) => {
    const old = deferred();
    request.mockReturnValueOnce(old.promise).mockResolvedValue({ rooms: [{ id: 'NEW' }] });
    const { useRooms, clearPersistedHomeKitCache } = await import('../useHomeKitData');
    const previous = renderHook(() => useRooms('H1'));
    previous.unmount();
    clearPersistedHomeKitCache();
    const current = renderHook(() => useRooms('H1'));
    await act(async () => {});
    expect(request).toHaveBeenCalledTimes(2);
    expect(current.result.current.data?.[0].id).toBe('NEW');
    await act(async () => {
      if (outcome === 'resolve') old.resolve({ rooms: [{ id: 'OLD' }] });
      else old.reject(new Error('Previous connection closed'));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(current.result.current.data?.[0].id).toBe('NEW');
    expect(current.result.current.error).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it.each(['rooms', 'accessories', 'serviceGroups'] as const)('clears visible %s without refetching until the new session revalidates', async (key) => {
    request.mockResolvedValue({ [key]: [{ id: 'OLD', services: [] }] });
    const { useRooms, useAccessoriesForHomes, useAllServiceGroups, clearPersistedHomeKitCache, revalidateHomeKitCache } = await import('../useHomeKitData');
    const hooks = {
      rooms: () => useRooms('H1'),
      accessories: () => useAccessoriesForHomes(['H1']),
      serviceGroups: () => useAllServiceGroups(['H1']),
    };
    const { result } = renderHook(() => hooks[key]());
    await act(async () => {});
    expect(result.current.data?.[0].id).toBe('OLD');
    request.mockClear();
    await act(async () => { clearPersistedHomeKitCache(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.data).toBeNull();
    expect(request).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);

    request.mockResolvedValue({ [key]: [{ id: 'NEW', services: [] }] });
    await act(async () => { revalidateHomeKitCache(); });
    expect(result.current.data?.[0].id).toBe('NEW');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending retry when the account signs out', async () => {
    request.mockRejectedValue(new Error('Relay is offline'));
    const { useRooms, clearPersistedHomeKitCache } = await import('../useHomeKitData');
    const { result } = renderHook(() => useRooms('H1'));
    await act(async () => {});
    expect(result.current.error).not.toBeNull();
    request.mockClear();
    await act(async () => { clearPersistedHomeKitCache(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(request).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
