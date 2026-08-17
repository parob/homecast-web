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
    label: 'All lights',
    runningLabel: 'Turning the lights off',
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
    expect(toastError).toHaveBeenCalledWith('All lights failed', expect.objectContaining({
      description: expect.stringContaining('relay offline'),
    }));
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('reports progress from zero, once per write, including failures', async () => {
    request.mockImplementation(async (_a: string, payload: { accessoryId: string }) => {
      if (payload.accessoryId === 'b') throw new Error('no response');
      return {};
    });
    const seen: Array<[number, number]> = [];
    const { run } = setup();
    await run(action(), { onProgress: (done, total) => seen.push([done, total]) });

    // Seeded at 0 before anything settles, so the card never shows a blank
    // count; then one tick per write, the failed one included — the count says
    // how many are resolved, not how many worked.
    expect(seen[0]).toEqual([0, 2]);
    expect(seen.map(([d]) => d)).toEqual([0, 1, 2]);
    expect(seen.every(([, total]) => total === 2)).toBe(true);
  });

  it('refuses for a view-only member without touching the cache or the network', async () => {
    const { run, updateCharacteristicInCache } = setup({ isViewOnly: true });
    await run(action());

    expect(request).not.toHaveBeenCalled();
    expect(updateCharacteristicInCache).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('View-only access: you cannot control accessories in this home');
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

describe('useRunHomeAction — per-call overrides', () => {
  it('sends writes to the overriding home, not the one on screen', async () => {
    // What a pinned action needs: it can target a home the user is not in.
    const { run } = setup();

    await run(action(), { homeId: 'home-2' });

    expect(request).toHaveBeenCalledTimes(2);
    for (const [, payload] of request.mock.calls) {
      expect((payload as { homeId: string }).homeId).toBe('home-2');
    }
  });

  it('keeps the hook-level home when no override is given', async () => {
    const { run } = setup();

    await run(action());

    expect(request).toHaveBeenCalledTimes(2);
    for (const [, payload] of request.mock.calls) {
      expect((payload as { homeId: string }).homeId).toBe('home-1');
    }
  });

  it('blocks on the target home being view-only even when the current one is not', async () => {
    const { run, updateCharacteristicInCache } = setup({ isViewOnly: false });

    await run(action(), { homeId: 'home-2', isViewOnly: true });

    expect(request).not.toHaveBeenCalled();
    expect(updateCharacteristicInCache).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith('View-only access: you cannot control accessories in this home');
  });

  it('allows a writable target home while the current one is view-only', async () => {
    const { run } = setup({ isViewOnly: true });

    await run(action(), { homeId: 'home-2', isViewOnly: false });

    expect(request).toHaveBeenCalledTimes(2);
    expect(toastError).not.toHaveBeenCalled();
  });
});

describe('running a chosen direction', () => {
  const twoWay = () => action({
    toggle: {
      state: 'mixed',
      onCount: 1,
      total: 2,
      onSteps: [{ writes: [
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: true, previousValue: false },
      ] }],
      offSteps: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: false, previousValue: true },
      ] }],
      onRunning: 'Turning the lights on',
      offRunning: 'Turning the lights off',
    },
  });

  it('writes the direction it was given, not the one the catalog chose', async () => {
    const { run } = setup();
    await run(twoWay(), { direction: true });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ accessoryId: 'b', value: true });
  });

  it('takes the other direction just as readily', async () => {
    const { run } = setup();
    await run(twoWay(), { direction: false });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ accessoryId: 'a', value: false });
  });

  it('falls back to the action\'s own steps when no direction is asked for', async () => {
    // What a play button and a tab-bar pin do: neither has a control that can
    // express a direction.
    const { run } = setup();
    await run(twoWay());

    expect(request.mock.calls.map(c => c[1].accessoryId).sort()).toEqual(['a', 'b']);
  });

  it('quietly does nothing when asked for the end it is already at', async () => {
    const { run } = setup();
    await run(action({
      toggle: {
        state: 'on', onCount: 2, total: 2,
        onSteps: [{ writes: [] }], offSteps: [{ writes: [] }],
        onRunning: 'Turning the lights on', offRunning: 'Turning the lights off',
      },
    }), { direction: true });

    expect(request).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('ignores a direction on a one-way action, which has no other steps to run', async () => {
    const { run } = setup();
    await run(action({ id: 'everything-off' }), { direction: true });
    expect(request.mock.calls.map(c => c[1].accessoryId).sort()).toEqual(['a', 'b']);
    expect(request.mock.calls.every(c => c[1].value === false)).toBe(true);
  });
});
