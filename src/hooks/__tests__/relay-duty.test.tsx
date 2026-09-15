// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useRelayDuty } from '../useRelayDuty';
import { ingestHomeServingPush, invalidateHomeServing, resetHomeServing, setThisDevice } from '@/server/home-serving';
import { browserLogger } from '@/lib/browser-logger';

vi.mock('@/hooks/useHomeKitData', () => ({ useHomes: () => ({ data: [
  { id: 'stable-a', name: 'Home A', isCloudManaged: true },
  { id: 'stable-b', name: 'Home B', isCloudManaged: true },
] }) }));
vi.mock('@/server/connection', () => ({ serverConnection: {
  getState: () => ({ connectionState: 'connected', relayStatus: true }), subscribe: () => () => {},
} }));
const serving = { state: 'served', by: 'mini', kind: 'cloud', since: null, graceEndsAt: null };
beforeEach(() => { resetHomeServing(); setThisDevice('mini'); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('both surfaces wait for facts, show only confirmed primary homes, and clear stale duty', () => {
  const { result } = renderHook(() => useRelayDuty());
  expect(result.current.value).toBe('Checking relay role');
  act(() => ingestHomeServingPush({ homeId: 'stable-a', serving }));
  expect(result.current).toMatchObject({ value: 'Active relay', homeNames: ['Home A'] });
  act(() => ingestHomeServingPush({ homeId: 'stable-b', serving: { ...serving, by: 'other' } }));
  expect(result.current.homeNames).toEqual(['Home A']);
  act(() => invalidateHomeServing());
  expect(result.current.value).toBe('Checking relay role');
});

it('ships transition evidence without repeating logs on unchanged renders or facts', () => {
  const log = vi.spyOn(browserLogger, 'logInfo');
  const { rerender } = renderHook(() => useRelayDuty());
  act(() => ingestHomeServingPush({ homeId: 'stable-a', serving }));
  const count = log.mock.calls.length;
  rerender();
  act(() => ingestHomeServingPush({ homeId: 'stable-a', serving }));
  expect(log).toHaveBeenCalledTimes(count);
  expect(log).toHaveBeenCalledWith('home_serving_changed', expect.objectContaining({ source: 'push', homeId: 'STABLE-A', serving }));
  expect(log).toHaveBeenCalledWith('connection_status', expect.objectContaining({ surface: 'relay_duty', state: 'connected_active', servingHomes: ['stable-a'] }));
});
