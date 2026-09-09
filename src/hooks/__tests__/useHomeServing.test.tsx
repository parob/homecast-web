// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useHomeServing } from '../useHomeServing';
import { ingestHomeServingPush, resetHomeServing, setDeviceServing, setThisDevice } from '@/server/home-serving';

const HOME = 'D08CB174';
const served = { state: 'served' as const, by: 'mac_mini', kind: 'self_hosted' as const, since: null, graceEndsAt: null };
const offline = { state: 'offline' as const, by: null, kind: null, since: null, graceEndsAt: null };

beforeEach(() => { resetHomeServing(); setThisDevice('mac_me'); });

describe('useHomeServing', () => {
  it('reads the composed fact and follows a push', () => {
    ingestHomeServingPush({ homeId: HOME, serving: served });
    const { result } = renderHook(() => useHomeServing('d08cb174'));
    expect(result.current?.state).toBe('served');
    act(() => { ingestHomeServingPush({ homeId: HOME, serving: offline }); });
    expect(result.current?.state).toBe('offline');
  });

  it('composes this device over the server', () => {
    ingestHomeServingPush({ homeId: HOME, serving: offline });
    setDeviceServing((id) => ({ active: id === HOME }));
    const { result } = renderHook(() => useHomeServing(HOME));
    expect(result.current).toMatchObject({ state: 'served', by: 'mac_me', kind: 'local' });
  });

  it('is null with no home, and ignores other homes', () => {
    const { result } = renderHook(() => useHomeServing(null));
    expect(result.current).toBeNull();
    ingestHomeServingPush({ homeId: HOME, serving: served });
    const other = renderHook(() => useHomeServing('OTHER'));
    expect(other.result.current).toBeNull();
  });
});
