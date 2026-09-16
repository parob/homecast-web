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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('cached read lifecycle', () => {
  describe.each([
    ['useAccessoriesForHomes', 'accessories'],
    ['useAllServiceGroups', 'serviceGroups'],
  ] as const)('%s', (hookName, dataKey) => {
    it.each([false, true])('ignores a previous home selection finishing late (manual refresh=%s)', async (manual) => {
      const old = deferred();
      const current = deferred();
      const data = (id: string) => ({ [dataKey]: [{ id, name: id, services: [] }] });
      request.mockImplementation((_action, payload) => payload.homeId === 'H2'
        ? current.promise
        : manual ? Promise.resolve(data('A1')) : old.promise);
      const useData = (await import('../useHomeKitData'))[hookName];
      const { result, rerender } = renderHook(({ homes }) => useData(homes), { initialProps: { homes: ['H1'] } });
      await act(async () => {});
      let refreshed: Promise<void> | undefined;
      if (manual) {
        request.mockImplementation((_action, payload) => payload.homeId === 'H2' ? current.promise : old.promise);
        act(() => { refreshed = result.current.refetch(); });
      }
      rerender({ homes: ['H2'] });
      await act(async () => { old.resolve(data('A1')); await refreshed; });
      expect(result.current.data).toBeNull();
      expect(result.current.loading).toBe(true);
      await act(async () => { current.resolve(data('A2')); });
      expect(result.current.loading).toBe(false);
      expect(result.current.data?.[0].id).toBe('A2');
    });
  });

  it('settles every consumer of one shared request', async () => {
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    const { useRooms } = await import('../useHomeKitData');
    const first = renderHook(() => useRooms('H1'));
    const second = renderHook(() => useRooms('H1'));
    expect(request).toHaveBeenCalledTimes(1);
    expect(first.result.current.loading).toBe(true);
    expect(second.result.current.loading).toBe(true);

    await act(async () => { pending.resolve({ rooms: [{ id: 'R1', name: 'Kitchen' }] }); });

    expect(first.result.current.data).toEqual(second.result.current.data);
    expect(first.result.current.loading).toBe(false);
    expect(second.result.current.loading).toBe(false);
  });

  it('does not replace the current home with an old request error or retry', async () => {
    const old = deferred();
    request.mockReturnValueOnce(old.promise).mockResolvedValue({ rooms: [{ id: 'R2', name: 'Bedroom' }] });
    const { useRooms } = await import('../useHomeKitData');
    const { result, rerender } = renderHook(({ home }) => useRooms(home), { initialProps: { home: 'H1' } });
    await act(async () => { rerender({ home: 'H2' }); });
    expect(result.current.data?.[0].id).toBe('R2');

    await act(async () => { old.reject(new Error('Previous home is offline')); });
    expect(result.current.error).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('keeps the current home loading when the previous home finishes first', async () => {
    const old = deferred();
    const current = deferred();
    request.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
    const { useRooms } = await import('../useHomeKitData');
    const { result, rerender } = renderHook(({ home }) => useRooms(home), { initialProps: { home: 'H1' } });
    rerender({ home: 'H2' });

    await act(async () => { old.resolve({ rooms: [] }); });
    expect(result.current.data).toBeNull();
    expect(result.current.loading).toBe(true);

    await act(async () => { current.resolve({ rooms: [{ id: 'R2' }] }); });
    expect(result.current.loading).toBe(false);
    expect(result.current.data?.[0].id).toBe('R2');
  });

  it('settles all consumers after the shared read exhausts its bounded retries', async () => {
    const attempts: ReturnType<typeof deferred>[] = [];
    request.mockImplementation(() => {
      const pending = deferred();
      attempts.push(pending);
      return pending.promise;
    });
    const { useRooms } = await import('../useHomeKitData');
    const first = renderHook(() => useRooms('H1'));
    const second = renderHook(() => useRooms('H1'));

    for (let i = 0; i < 3; i++) {
      expect(attempts).toHaveLength(i + 1);
      await act(async () => { attempts[i].reject(new Error('Relay is offline')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    }
    expect(request).toHaveBeenCalledTimes(3);
    for (const hook of [first, second]) {
      expect(hook.result.current.error?.message).toBe('Relay is offline');
      expect(hook.result.current.loading).toBe(false);
    }
  });

  it('clears the previous home error when navigating to a cached home', async () => {
    request.mockResolvedValueOnce({ rooms: [{ id: 'R2' }] });
    const { useRooms } = await import('../useHomeKitData');
    const cached = renderHook(() => useRooms('H2'));
    await act(async () => {});
    cached.unmount();

    request.mockRejectedValue(new Error('Previous home is offline'));
    const { result, rerender } = renderHook(({ home }) => useRooms(home), { initialProps: { home: 'H1' } });
    await act(async () => {});
    expect(result.current.error).not.toBeNull();
    rerender({ home: 'H2' });
    expect(result.current.data?.[0].id).toBe('R2');
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });

  it('stops showing loading and ignores late failures after the read is skipped', async () => {
    const pending = deferred();
    request.mockReturnValue(pending.promise);
    const { useRooms } = await import('../useHomeKitData');
    const { result, rerender } = renderHook(({ skip }) => useRooms('H1', { skip }), { initialProps: { skip: false } });
    rerender({ skip: true });
    expect(result.current.loading).toBe(false);
    await act(async () => { pending.reject(new Error('Read is no longer needed')); });
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(result.current.error).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
  });
});
