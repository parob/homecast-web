// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const request = vi.fn();
const markPendingUpdate = vi.fn();
const toastError = vi.fn();
const toastWarning = vi.fn();

vi.mock('@/server/connection', () => ({
  serverConnection: { request: (...args: unknown[]) => request(...args) },
}));
vi.mock('@/hooks/useHomeKitData', () => ({
  markPendingUpdate: (...args: unknown[]) => markPendingUpdate(...args),
}));
vi.mock('sonner', () => ({
  toast: {
    error: (...args: unknown[]) => toastError(...args),
    warning: (...args: unknown[]) => toastWarning(...args),
  },
}));

const { useRunHomeAction } = await import('../useRunHomeAction');
type HomeAction = import('../catalog').HomeAction;

function action(overrides: Partial<HomeAction> = {}): HomeAction {
  return {
    id: 'lights',
    label: 'Turn all lights off',
    subtitle: '2 of 2 on',
    icon: 'lightbulb',
    serviceType: 'lightbulb',
    targetCount: 2,
    turningOn: false,
    disabled: false,
    steps: [{
      writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: false, previousValue: true },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: false, previousValue: true },
      ],
    }],
    ...overrides,
  };
}

function setup(opts: { isViewOnly?: boolean } = {}) {
  const updateCharacteristicInCache = vi.fn();
  const { result } = renderHook(() => useRunHomeAction({
    homeId: 'home-1',
    isViewOnly: opts.isViewOnly ?? false,
    updateCharacteristicInCache,
  }));
  return { run: result.current, updateCharacteristicInCache };
}

beforeEach(() => {
  request.mockReset().mockResolvedValue({});
  markPendingUpdate.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
});

describe('useRunHomeAction', () => {
  it('sends one characteristic.set per write, with canonical names and the homeId', async () => {
    const { run } = setup();
    await run(action());

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenCalledWith('characteristic.set', {
      accessoryId: 'a', characteristicType: 'power_state', value: false, homeId: 'home-1',
    });
    expect(request).toHaveBeenCalledWith('characteristic.set', {
      // canonical on the wire even though this accessory reports `on`
      accessoryId: 'b', characteristicType: 'power_state', value: false, homeId: 'home-1',
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('writes the cache under both names when the reported name differs', async () => {
    const { run, updateCharacteristicInCache } = setup();
    await run(action());

    expect(updateCharacteristicInCache).toHaveBeenCalledWith('a', 'power_state', 'false');
    expect(updateCharacteristicInCache).toHaveBeenCalledWith('b', 'power_state', 'false');
    expect(updateCharacteristicInCache).toHaveBeenCalledWith('b', 'on', 'false');
    // 'a' reports the canonical name, so it is written once, not twice
    expect(updateCharacteristicInCache.mock.calls.filter(c => c[0] === 'a')).toHaveLength(1);
  });

  it('updates the cache before any request goes out', async () => {
    const order: string[] = [];
    const updateCharacteristicInCache = vi.fn(() => { order.push('cache'); });
    request.mockImplementation(async () => { order.push('request'); });

    const { result } = renderHook(() => useRunHomeAction({
      homeId: 'home-1', isViewOnly: false, updateCharacteristicInCache,
    }));
    await result.current(action());

    expect(order.indexOf('request')).toBeGreaterThan(order.lastIndexOf('cache'));
  });

  it('marks every optimistic write pending so a stale broadcast cannot undo it', async () => {
    const { run } = setup();
    await run(action());
    expect(markPendingUpdate).toHaveBeenCalledWith('a', 'power_state', false);
    expect(markPendingUpdate).toHaveBeenCalledWith('b', 'on', false);
  });

  it('reverts only the write that failed, and warns rather than errors', async () => {
    request.mockImplementation(async (_action: string, payload: { accessoryId: string }) => {
      if (payload.accessoryId === 'b') throw new Error('no response');
      return {};
    });
    const { run, updateCharacteristicInCache } = setup();
    await run(action());

    // 'b' reverts under both of its names; 'a' is never reverted
    expect(updateCharacteristicInCache).toHaveBeenCalledWith('b', 'power_state', 'true');
    expect(updateCharacteristicInCache).toHaveBeenCalledWith('b', 'on', 'true');
    expect(updateCharacteristicInCache).not.toHaveBeenCalledWith('a', 'power_state', 'true');

    expect(toastWarning).toHaveBeenCalledWith('1 of 2 changed', expect.objectContaining({
      description: '1 accessory did not respond',
    }));
    expect(toastError).not.toHaveBeenCalled();
  });

  it('errors and reverts everything when every write fails', async () => {
    request.mockRejectedValue(new Error('relay offline'));
    const { run, updateCharacteristicInCache } = setup();
    await run(action());

    expect(updateCharacteristicInCache).toHaveBeenCalledWith('a', 'power_state', 'true');
    expect(updateCharacteristicInCache).toHaveBeenCalledWith('b', 'power_state', 'true');
    expect(toastError).toHaveBeenCalledWith('Turn all lights off failed', expect.objectContaining({
      description: expect.stringContaining('relay offline'),
    }));
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('refuses for a view-only member without touching the cache or the network', async () => {
    const { run, updateCharacteristicInCache } = setup({ isViewOnly: true });
    await run(action());

    expect(request).not.toHaveBeenCalled();
    expect(updateCharacteristicInCache).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('View-only access: you cannot control devices in this home');
  });

  it('does nothing for an action with no writes left to make', async () => {
    const { run, updateCharacteristicInCache } = setup();
    await run(action({ disabled: true, steps: [{ writes: [] }] }));

    expect(request).not.toHaveBeenCalled();
    expect(updateCharacteristicInCache).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('fans out widely enough that a normal home is one wave, but stays bounded', async () => {
    let inFlight = 0;
    let peak = 0;
    request.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise(r => setTimeout(r, 0));
      inFlight--;
    });

    const writes = Array.from({ length: 20 }, (_, i) => ({
      accessoryId: `a${i}`,
      characteristicType: 'power_state',
      reportedCharacteristicType: 'power_state',
      value: false,
      previousValue: true,
    }));
    const { run } = setup();
    await run(action({ steps: [{ writes }] }));

    expect(request).toHaveBeenCalledTimes(20);
    // 20 lights go out together rather than in waves — the point of the change
    // from a cap of 6, where one wedged accessory pinned its whole wave for the
    // native 10s write timeout.
    expect(peak).toBe(20);
    expect(peak).toBeLessThanOrEqual(24);
  });

  it('runs steps in order and honours a delay between them', async () => {
    const seen: string[] = [];
    request.mockImplementation(async (_a: string, p: { accessoryId: string }) => { seen.push(p.accessoryId); });

    const write = (id: string) => ({
      accessoryId: id, characteristicType: 'power_state', reportedCharacteristicType: 'power_state',
      value: false as const, previousValue: true,
    });
    const { run } = setup();
    await run(action({ steps: [
      { writes: [write('first')], delayAfterMs: 1 },
      { writes: [write('second')] },
    ] }));

    expect(seen).toEqual(['first', 'second']);
  });
});
