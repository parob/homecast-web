// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/server/connection', () => ({ serverConnection: { request }, getDeviceId: () => 'test-device' }));
vi.mock('@/native/homekit-bridge', () => ({ isRelayCapable: () => false }));
vi.mock('@/lib/config', () => ({ isCommunity: false }));
import { useHomes, clearPersistedHomeKitCache, revalidateHomeKitCache } from '../useHomeKitData';
import { getHomeServing, ingestHomeServingPush, invalidateHomeServing, resetHomeServing } from '@/server/home-serving';
const served = { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null };
const waiting = { state: 'waiting', by: null, kind: null, since: null, graceEndsAt: null };
let answer: (value: unknown) => void;
beforeEach(() => {
  vi.useFakeTimers();
  resetHomeServing();
  clearPersistedHomeKitCache();
  request.mockReset();
  request.mockImplementationOnce(() => new Promise(resolve => { answer = resolve; }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('feeds a real homes-list response to the store without overwriting a newer push', async () => {
  renderHook(() => useHomes());
  act(() => ingestHomeServingPush({ homeId: 'A', serving: waiting }));
  await act(async () => { answer({ homes: [{ id: 'a', name: 'A', serving: served }] }); });
  expect(request).toHaveBeenCalledWith('homes.list');
  expect(getHomeServing('A')?.state).toBe('waiting');
});

it('retries when resume joins a list started before the missing-broadcast interval', async () => {
  renderHook(() => useHomes());
  act(() => { invalidateHomeServing(); revalidateHomeKitCache(); });
  request.mockResolvedValue({ homes: [{ id: 'a', name: 'A', serving: waiting }] });
  await act(async () => { answer({ homes: [{ id: 'a', name: 'A', serving: served }] }); });
  expect(getHomeServing('A')).toBeNull();
  await act(async () => { await vi.advanceTimersByTimeAsync(3500); });
  expect(request).toHaveBeenCalledTimes(2);
  expect(getHomeServing('A')?.state).toBe('waiting');
});
