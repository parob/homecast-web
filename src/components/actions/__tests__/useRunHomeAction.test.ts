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
const toastPlain = vi.fn();
vi.mock('sonner', () => {
  const toast = (...args: unknown[]) => toastPlain(...args);
  toast.error = (...args: unknown[]) => toastError(...args);
  toast.warning = (...args: unknown[]) => toastWarning(...args);
  return { toast };
});

const { useRunHomeAction, __resetWriteQueue, __setBulkWriteSupport } = await import('../useRunHomeAction');
type HomeAction = import('../catalog').HomeAction;

interface Asked { accessoryId: string; characteristicType: string; value: unknown; homeId?: string }

/**
 * A relay that speaks the bulk action, answering per write the way
 * local-handler does.
 */
function bulkRelay(opts: { failing?: string[]; unreachable?: string[] } = {}) {
  const failing = new Set(opts.failing ?? []);
  // Native flags these on the change itself — see BulkWriteResult.unreachable.
  const unreachable = new Set(opts.unreachable ?? []);
  return async (name: string, payload: { writes?: Asked[] }) => {
    if (name !== 'characteristics.set') return {};
    const changes = (payload.writes ?? []).map(w => failing.has(w.accessoryId)
      ? {
          accessoryId: w.accessoryId, characteristicType: w.characteristicType, success: false,
          error: unreachable.has(w.accessoryId) ? 'Not responding.' : 'no response',
          ...(unreachable.has(w.accessoryId) ? { unreachable: true } : {}),
        }
      : { accessoryId: w.accessoryId, characteristicType: w.characteristicType, value: w.value, success: true });
    const ok = changes.filter(c => c.success).length;
    return { success: ok === changes.length, ok, total: changes.length, changes };
  };
}

/**
 * Everything the relay was actually asked to write, in order, whichever
 * protocol carried it.
 *
 * Most of what these tests care about — which accessories, which values, which
 * home — is true of both paths, and saying it once keeps the two from drifting.
 */
function asked(): Asked[] {
  const out: Asked[] = [];
  for (const [name, payload] of request.mock.calls as Array<[string, Record<string, unknown>]>) {
    if (name === 'characteristics.set') {
      for (const w of (payload.writes as Asked[])) out.push({ ...w, homeId: payload.homeId as string });
    } else if (name === 'characteristic.set') {
      out.push(payload as unknown as Asked);
    }
  }
  return out;
}

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
  __resetWriteQueue();
  // Confirmed rather than unknown: the probe has its own tests, and every other
  // test here is about what a current relay does.
  __setBulkWriteSupport(true);
  request.mockReset().mockImplementation(bulkRelay());
  markPendingUpdate.mockReset();
  toastError.mockReset();
  toastWarning.mockReset();
  toastPlain.mockReset();
});

describe('useRunHomeAction', () => {
  it('sends the whole step as one request, with canonical names and the homeId', async () => {
    const { run } = setup();
    await run(action());

    // One request, not one per accessory. That is the round trips saved, and
    // also what lets HomeKit coalesce the writes that share a bridge.
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith('characteristics.set', {
      homeId: 'home-1',
      writes: [
        { accessoryId: 'a', characteristicType: 'power_state', value: false },
        // canonical on the wire even though this accessory reports `on`
        { accessoryId: 'b', characteristicType: 'power_state', value: false },
      ],
    });
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('falls back to one request per accessory on a relay too old to know it', async () => {
    __setBulkWriteSupport(null);
    request.mockImplementation(async (name: string) => {
      if (name === 'characteristics.set') {
        throw Object.assign(new Error('Unknown action: characteristics.set'), { code: 'UNKNOWN_ACTION' });
      }
      return {};
    });
    const { run } = setup();
    await run(action());

    expect(request).toHaveBeenCalledWith('characteristic.set', {
      accessoryId: 'a', characteristicType: 'power_state', value: false, homeId: 'home-1',
    });
    const perAccessory = request.mock.calls.filter(([name]) => name === 'characteristic.set');
    expect(perAccessory.map(([, p]) => (p as { accessoryId: string }).accessoryId)).toEqual(['a', 'b']);
    // the whole point of falling back: it is not reported as a failure
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('probes an old relay once, then stops asking', async () => {
    __setBulkWriteSupport(null);
    request.mockImplementation(async (name: string) => {
      if (name === 'characteristics.set') {
        throw Object.assign(new Error('Unknown method: characteristics.set'), { code: 'UNKNOWN_METHOD' });
      }
      return {};
    });
    const { run } = setup();
    await run(action());
    await run(action());

    // A relay that cannot do this will never be able to mid-session, and a
    // doomed round trip before every press would make the slow case slower.
    const probes = request.mock.calls.filter(([name]) => name === 'characteristics.set');
    expect(probes).toHaveLength(1);
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
    request.mockImplementation(bulkRelay({ failing: ['b'] }));
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

  it('reports progress from zero, and completes the step in one movement', async () => {
    request.mockImplementation(bulkRelay({ failing: ['b'] }));
    const seen: Array<[number, number]> = [];
    const { run } = setup();
    await run(action(), { onProgress: (done, total) => seen.push([done, total]) });

    // Seeded at 0 before anything settles, so the card never shows a blank
    // count. A batch is answered all at once, so there is nothing to count up
    // through — and the failed write still counts, because the number says how
    // many are resolved, not how many worked.
    expect(seen[0]).toEqual([0, 2]);
    expect(seen.map(([d]) => d)).toEqual([0, 2]);
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

  it('fans the fallback out widely enough that a normal home is one wave, but stays bounded', async () => {
    __setBulkWriteSupport(false);
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
    const write = (id: string) => ({
      accessoryId: id, characteristicType: 'power_state', reportedCharacteristicType: 'power_state',
      value: false as const, previousValue: true,
    });
    const { run } = setup();
    await run(action({ steps: [
      { writes: [write('first')], delayAfterMs: 1 },
      { writes: [write('second')] },
    ] }));

    expect(asked().map(w => w.accessoryId)).toEqual(['first', 'second']);
  });
});

describe('useRunHomeAction — per-call overrides', () => {
  it('sends writes to the overriding home, not the one on screen', async () => {
    // What a pinned action needs: it can target a home the user is not in.
    const { run } = setup();

    await run(action(), { homeId: 'home-2' });

    expect(asked()).toHaveLength(2);
    expect(asked().every(w => w.homeId === 'home-2')).toBe(true);
  });

  it('keeps the hook-level home when no override is given', async () => {
    const { run } = setup();

    await run(action());

    expect(asked()).toHaveLength(2);
    expect(asked().every(w => w.homeId === 'home-1')).toBe(true);
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

    expect(asked()).toHaveLength(2);
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
      onStepsEvery: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: true },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: true, previousValue: false },
      ] }],
      offStepsEvery: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: false, previousValue: true },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: false, previousValue: false },
      ] }],
      onRunning: 'Turning on',
      offRunning: 'Turning off',
    },
  });

  it('writes the direction it was given, not the one the catalog chose', async () => {
    const { run } = setup();
    await run(twoWay(), { direction: true });

    expect(asked()).toHaveLength(1);
    expect(asked()[0]).toMatchObject({ accessoryId: 'b', value: true });
  });

  it('takes the other direction just as readily', async () => {
    const { run } = setup();
    await run(twoWay(), { direction: false });

    expect(asked()).toHaveLength(1);
    expect(asked()[0]).toMatchObject({ accessoryId: 'a', value: false });
  });

  it('falls back to the action\'s own steps when no direction is asked for', async () => {
    // What a play button and a tab-bar pin do: neither has a control that can
    // express a direction.
    const { run } = setup();
    await run(twoWay());

    expect(asked().map(w => w.accessoryId).sort()).toEqual(['a', 'b']);
  });

  it('quietly does nothing when asked for the end it is already at', async () => {
    const { run } = setup();
    await run(action({
      toggle: {
        state: 'on', onCount: 2, total: 2,
        onSteps: [{ writes: [] }], offSteps: [{ writes: [] }],
        onStepsEvery: [{ writes: [] }], offStepsEvery: [{ writes: [] }],
        onRunning: 'Turning on', offRunning: 'Turning off',
      },
    }), { direction: true });

    expect(request).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('ignores a direction on a one-way action, which has no other steps to run', async () => {
    const { run } = setup();
    await run(action({ id: 'everything-off' }), { direction: true });
    expect(asked().map(w => w.accessoryId).sort()).toEqual(['a', 'b']);
    expect(asked().every(w => w.value === false)).toBe(true);
  });
});

describe('a run the user can call off', () => {
  const twoWay = () => action({
    toggle: {
      state: 'off', onCount: 0, total: 2,
      onSteps: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: false },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: true, previousValue: false },
      ] }],
      offSteps: [{ writes: [] }],
      onStepsEvery: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: false },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: true, previousValue: false },
      ] }],
      offStepsEvery: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: false, previousValue: false },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: false, previousValue: false },
      ] }],
      onRunning: 'Turning on', offRunning: 'Turning off',
    },
  });

  it('moves each accessory only once its own write has landed', async () => {
    // The opposite of the optimistic pass, and deliberately so: a control the
    // user can still grab must not claim work it has not done, or reversing it
    // would turn off lights that never came on.
    const order: string[] = [];
    const updateCharacteristicInCache = vi.fn((id: string) => { order.push(`cache:${id}`); });
    const relay = bulkRelay();
    request.mockImplementation(async (name: string, payload: { writes?: Asked[] }) => {
      for (const w of payload.writes ?? []) order.push(`request:${w.accessoryId}`);
      return relay(name, payload);
    });
    const { result } = renderHook(() => useRunHomeAction({
      homeId: 'home-1', isViewOnly: false, updateCharacteristicInCache,
    }));

    await result.current(twoWay(), { direction: true, signal: new AbortController().signal });

    // every cache write follows its own request, rather than all preceding them
    expect(order.indexOf('request:a')).toBeLessThan(order.indexOf('cache:a'));
    expect(order.indexOf('request:b')).toBeLessThan(order.indexOf('cache:b'));
  });

  it('issues nothing once it has been called off', async () => {
    const controller = new AbortController();
    controller.abort();
    const { run, updateCharacteristicInCache } = setup();

    await run(twoWay(), { direction: true, signal: controller.signal });

    expect(request).not.toHaveBeenCalled();
    // and nothing moved, so there is nothing to put back
    expect(updateCharacteristicInCache).not.toHaveBeenCalled();
  });

  it('drops the queue mid-flight, keeping what already landed', async () => {
    // A fallback-path property: only there is a step still a queue of separate
    // requests with something left in it to drop. A bulk step is one request —
    // by the time it can be called off it has already gone.
    __setBulkWriteSupport(false);
    const controller = new AbortController();
    // The first write lands, and calls the rest off on its way out — standing in
    // for the user reaching for the toggle while the fan-out is still draining.
    request.mockImplementation(async (_a: string, p: { accessoryId: string }) => {
      if (p.accessoryId === 'a') controller.abort();
    });
    const { run, updateCharacteristicInCache } = setup();

    await run(twoWay(), { direction: true, signal: controller.signal });

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][1]).toMatchObject({ accessoryId: 'a' });
    // 'a' really did turn on, so the cache says so and a reversal will find it
    expect(updateCharacteristicInCache).toHaveBeenCalledWith('a', 'power_state', 'true');
    expect(updateCharacteristicInCache).not.toHaveBeenCalledWith('b', 'power_state', 'true');
  });

  it('says nothing when it is called off — that was the user\'s own decision', async () => {
    const controller = new AbortController();
    request.mockImplementation(async () => { controller.abort(); throw new Error('gone'); });
    const { run } = setup();

    await run(twoWay(), { direction: true, signal: controller.signal });

    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('keeps the optimistic pass for a run with no way to call it off', async () => {
    // A play button is fire-and-forget, and the instant repaint is worth more
    // there than progress nobody can act on.
    const order: string[] = [];
    const updateCharacteristicInCache = vi.fn(() => { order.push('cache'); });
    request.mockImplementation(async () => { order.push('request'); });
    const { result } = renderHook(() => useRunHomeAction({
      homeId: 'home-1', isViewOnly: false, updateCharacteristicInCache,
    }));

    await result.current(action());

    expect(order.indexOf('request')).toBeGreaterThan(order.lastIndexOf('cache'));
  });
});

describe('reversing a run that is still going', () => {
  const twoWay = () => action({
    toggle: {
      state: 'off', onCount: 0, total: 2,
      onSteps: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: false },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: true, previousValue: false },
      ] }],
      // What the cache would produce mid-run: nothing looks on yet, so the
      // minimal reversal is empty — the hole this feature fell into.
      offSteps: [{ writes: [] }],
      onStepsEvery: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: false },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: true, previousValue: false },
      ] }],
      offStepsEvery: [{ writes: [
        { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: false, previousValue: false },
        { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'on', value: false, previousValue: false },
      ] }],
      onRunning: 'Turning on', offRunning: 'Turning off',
    },
  });

  it('writes to every member, not the ones that currently look wrong', async () => {
    // The bug this exists to stop: mid-run the cache still says every light is
    // off, so the minimal "off" set is empty and the reversal does nothing at
    // all — then the in-flight "on" lands and the lights come on.
    const { run } = setup();
    await run(twoWay(), { direction: false, supersedes: true, signal: new AbortController().signal });

    expect(asked().map(w => w.accessoryId).sort()).toEqual(['a', 'b']);
    expect(asked().every(w => w.value === false)).toBe(true);
  });

  it('still writes only what needs changing when nothing is in flight', async () => {
    // The filter is right in the ordinary case, and is what keeps a 40-light
    // home from writing 40 times to change two.
    const { run } = setup();
    await run(twoWay(), { direction: false, signal: new AbortController().signal });
    expect(request).not.toHaveBeenCalled();
  });

  it('sends the reversing batch only after the batch it reverses has landed', async () => {
    // Otherwise reversing is a race: the "on" is already travelling and
    // whichever the relay finishes last is the state the light keeps. An abort
    // cannot recall a request already in flight, so ordering is the only thing
    // that makes last-write-wins true rather than likely.
    const order: string[] = [];
    const gates: Array<() => void> = [];
    const relay = bulkRelay();
    request.mockImplementation(async (name: string, payload: { writes?: Asked[] }) => {
      const value = payload.writes?.[0]?.value;
      order.push(`start:${value}`);
      if (value === true) await new Promise<void>(r => gates.push(r));
      order.push(`done:${value}`);
      return relay(name, payload);
    });
    const { run } = setup();

    const first = run(twoWay(), { direction: true, signal: new AbortController().signal });
    await Promise.resolve();
    const second = run(twoWay(), { direction: false, supersedes: true, signal: new AbortController().signal });

    // the "off" cannot have gone out yet — the batch before it is still busy
    expect(order).not.toContain('start:false');

    gates.forEach(release => release());
    await Promise.all([first, second]);

    expect(order.indexOf('start:false')).toBeGreaterThan(order.indexOf('done:true'));
    expect(order.indexOf('done:true')).toBeGreaterThanOrEqual(0);
  });

  it('sends a device its second write only after its first has landed, on the fallback', async () => {
    // The same guarantee, one layer down: where a step is N requests, the chain
    // has to be per accessory to give it.
    __setBulkWriteSupport(false);
    const order: string[] = [];
    const gates: Array<() => void> = [];
    request.mockImplementation(async (_a: string, p: { accessoryId: string; value: boolean }) => {
      order.push(`start:${p.accessoryId}=${p.value}`);
      if (p.value === true) await new Promise<void>(r => gates.push(r));
      order.push(`done:${p.accessoryId}=${p.value}`);
    });
    const { run } = setup();

    const first = run(twoWay(), { direction: true, signal: new AbortController().signal });
    await Promise.resolve();
    const second = run(twoWay(), { direction: false, supersedes: true, signal: new AbortController().signal });

    // the "off" cannot have gone out yet — its device is still busy
    expect(order).not.toContain('start:a=false');

    gates.forEach(release => release());
    await Promise.all([first, second]);

    // 'a' is written on, that write lands, and only then is it written off
    expect(order.indexOf('start:a=false')).toBeGreaterThan(order.indexOf('done:a=true'));
    expect(order.indexOf('done:a=true')).toBeGreaterThanOrEqual(0);
  });

  it('lets different accessories go at once on the fallback', async () => {
    // The chain is per device, not global — a slow bulb must not hold up the
    // rest of the house. (A bulk step gets this for nothing: one request.)
    __setBulkWriteSupport(false);
    const started: string[] = [];
    const gates: Array<() => void> = [];
    request.mockImplementation(async (_a: string, p: { accessoryId: string }) => {
      started.push(p.accessoryId);
      await new Promise<void>(r => gates.push(r));
    });
    const { run } = setup();
    const pending = run(twoWay(), { direction: true, signal: new AbortController().signal });

    await Promise.resolve();
    await Promise.resolve();
    // both are in flight before either has been allowed to finish
    expect(started).toEqual(['a', 'b']);

    gates.forEach(release => release());
    await pending;
  });
});

describe('a bulb off at the wall is not an error', () => {
  const w = (id: string, reachable: boolean) => ({
    accessoryId: id, characteristicType: 'power_state', reportedCharacteristicType: 'power_state',
    value: true as const, previousValue: false, reachable, name: `Light ${id}`,
  });

  it('says nothing at all about the unreachable ones', async () => {
    request.mockImplementation(bulkRelay({ failing: ['dead1', 'dead2'] }));
    const { run } = setup();
    await run(action({ steps: [{ writes: [w('ok', true), w('dead1', false), w('dead2', false)] }] }));

    // No error, no warning and no notice: the tiles already grey out as No
    // Response, which says the same thing without interrupting. A house with a
    // couple of permanently-dark bulbs would otherwise get a toast every time.
    expect(toastError).not.toHaveBeenCalled();
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastPlain).not.toHaveBeenCalled();
  });

  it('believes the relay over its own cached reachability', async () => {
    // The cache says reachable — it was, when the accessory list was last
    // fetched. The relay is answering from the write itself, minutes later,
    // and it is the one that just tried.
    request.mockImplementation(bulkRelay({ failing: ['gone'], unreachable: ['gone'] }));
    const { run } = setup();
    await run(action({ steps: [{ writes: [w('ok', true), w('gone', true)] }] }));

    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    expect(toastPlain).not.toHaveBeenCalled();
  });

  it('still warns when something reachable refused', async () => {
    request.mockImplementation(bulkRelay({ failing: ['broken', 'dead1'] }));
    const { run } = setup();
    await run(action({ steps: [{ writes: [w('ok', true), w('broken', true), w('dead1', false)] }] }));

    // The reachable failure is the one worth reporting, and it is counted on
    // its own — lumping the unreachable in would inflate the number.
    expect(toastWarning).toHaveBeenCalledWith('2 of 3 changed', expect.objectContaining({
      description: '1 accessory did not respond',
    }));
  });
});
