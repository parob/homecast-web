// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const request = vi.hoisted(() => vi.fn());
vi.mock('@/server/connection', () => ({ serverConnection: { request }, getDeviceId: () => 'test-device' }));
vi.mock('@/native/homekit-bridge', () => ({ isRelayCapable: () => false }));
vi.mock('@/lib/config', () => ({ isCommunity: false }));
const served = { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null };
const waiting = { state: 'waiting', by: null, kind: null, since: null, graceEndsAt: null };

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  localStorage.clear();
  request.mockReset();
});
afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); });

async function setup() {
  // Use the real data-layer wiring, including the registered refetch callback.
  const data = await import('../useHomeKitData');
  data.clearPersistedHomeKitCache();
  const store = await import('@/server/home-serving');
  return { ...data, ...store };
}

it('stops claiming a home is served when routing contradicts it and the refresh fails', async () => {
  const { useHomes, noteRefused, getHomeServing, ingestHomeServingPush } = await setup();
  request.mockResolvedValueOnce({ homes: [{ id: 'A', serving: served }, { id: 'B', serving: served }] });
  await act(async () => { renderHook(() => useHomes()); });
  request.mockRejectedValue(new Error('temporary homes-list failure'));
  await act(async () => { noteRefused('A'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
  expect(getHomeServing('A')).toBeNull(); // checking, not an invented offline state
  expect(getHomeServing('B')?.state).toBe('served');
  act(() => ingestHomeServingPush({ homeId: 'A', serving: waiting }));
  expect(getHomeServing('A')?.state).toBe('waiting');
});

it('can revalidate after a previous refusal’s refresh exhausted its retries', async () => {
  const { useHomes, noteRefused, getHomeServing } = await setup();
  request.mockResolvedValueOnce({ homes: [{ id: 'A', serving: served }] });
  await act(async () => { renderHook(() => useHomes()); });
  request.mockRejectedValue(new Error('temporary homes-list failure'));
  await act(async () => { noteRefused('A'); });
  await act(async () => { await vi.advanceTimersByTimeAsync(7_000); });
  const before = request.mock.calls.length;
  request.mockResolvedValue({ homes: [{ id: 'A', serving: waiting }] });
  await act(async () => { noteRefused('A'); });
  expect(request.mock.calls.length).toBeGreaterThan(before);
  expect(getHomeServing('A')?.state).toBe('waiting');
});

it('asks the cloud for a new fact even when no homes hook is mounted', async () => {
  const { noteRefused, ingestHomeServingPush, getHomeServing } = await setup();
  ingestHomeServingPush({ homeId: 'A', serving: served });
  request.mockResolvedValue({ homes: [{ id: 'A', serving: waiting }] });
  await act(async () => { noteRefused('A'); });
  expect(request).toHaveBeenCalledWith('homes.list');
  expect(getHomeServing('A')?.state).toBe('waiting');
});
