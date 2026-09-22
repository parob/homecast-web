// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../../hooks/useHomeKitData', () => ({ revalidateHomeKitCache: vi.fn() }));

const runtime = vi.hoisted(() => ({ socket: 'connected', relayCapable: false, liveIds: ['LIVE-A', 'LIVE-B', 'LIVE-C'] }));
vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: {
    getStatus: async () => ({ authorized: true, homeCount: 3 }),
    isAvailable: () => true,
    startObserving: async () => ({ observing: true }),
    stopObserving: async () => ({}),
    resetObservationTimeout: async () => ({}),
  },
  isLocalCapable: () => true,
  isRelayCapable: () => runtime.relayCapable,
  withCallReason: (_reason: string, fn: () => unknown) => fn(),
}));
vi.mock('../../relay/local-handler', () => ({
  executeHomeKitAction: async () => ({ homes: runtime.liveIds.map(id => ({ id })) }),
}));
vi.mock('../../automation/service-group-resolver', () => ({
  HomeKitServiceGroupResolver: class { start() {} stop() {} },
}));
vi.mock('../../relay/relay-write', () => ({
  setRelayWritePublisher: vi.fn(), getRelayWritePublisher: () => ({}),
}));
vi.mock('../../lib/browser-logger', () => ({ browserLogger: { logInfo: vi.fn() } }));
vi.mock('../connection', () => ({
  serverConnection: { getState: () => ({ connectionState: runtime.socket }), emitBroadcast: vi.fn() },
  communityRequest: vi.fn(async () => ({})),
  clearCommunityCache: vi.fn(), setLocalModeRouter: vi.fn(),
}));
vi.mock('../local-identity', () => ({
  localIdentity: {
    loadLast() {}, hasUser: () => false,
    counts: () => ({ matched: 3, reported: 3 }), sync: async () => null,
    stableToLive: () => new Map([['HC-A', 'LIVE-A'], ['HC-B', 'LIVE-B'], ['HC-C', 'LIVE-C']]),
    toStable: (id: string) => id.toUpperCase().replace('LIVE-', 'HC-'),
    toLivePayload: (p: unknown) => p, toStablePayload: (p: unknown) => p,
  },
}));

async function setup() {
  const serving = await import('../home-serving');
  serving.setThisDevice('this-phone');
  const setHome = (id: string, state: 'served' | 'offline', by = 'managed-mini') => {
    serving.ingestHomeServingPush({ homeId: id, serving: {
      state, by: state === 'served' ? by : null, kind: state === 'served' ? 'cloud' : null,
      since: null, graceEndsAt: null,
    } });
  };
  for (const id of ['HC-A', 'HC-B', 'HC-C']) setHome(id, 'served');
  const { controller } = await import('../local-mode-controller');
  controller.start();
  await vi.advanceTimersByTimeAsync(1_000);
  return { controller, setHome, ...serving };
}

describe('Local Mode is scoped to the home that needs it', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    runtime.socket = 'connected';
    runtime.relayCapable = false;
    runtime.liveIds = ['LIVE-A', 'LIVE-B', 'LIVE-C'];
    localStorage.setItem('homecast-homekit-cache', JSON.stringify({ homes: {
      data: ['HC-A', 'HC-B', 'HC-C'].map(id => ({ id, isCloudManaged: true })),
    } }));
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); localStorage.clear(); vi.resetModules(); });

  it('routes only the unavailable home locally and leaves the other statuses on the managed relay', async () => {
    const { controller, setHome, effectiveServing } = await setup();
    setHome('HC-A', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(controller.canServe('accessories.list', { homeId: 'hc-a' })).toBe(true);
    expect(effectiveServing('HC-A')).toMatchObject({ state: 'served', kind: 'local' });
    for (const homeId of ['HC-B', 'HC-C']) {
      expect(controller.canServe('accessories.list', { homeId })).toBe(false);
      expect(effectiveServing(homeId)).toMatchObject({ state: 'served', by: 'managed-mini', kind: 'cloud' });
    }
    expect(controller.canServe('accessories.list', { homeId: 'live-b' })).toBe(false);
    expect(controller.canServe('accessories.list', { homeId: 'live-a' })).toBe(true);
    expect(controller.getState('HC-B')).toMatchObject({ active: false, reason: null });
    expect(controller.getState('HC-A')).toMatchObject({ active: true, reason: 'relay-offline' });
  });

  it('lets one home return to its relay while another still needs Local Mode', async () => {
    const { controller, setHome, effectiveServing } = await setup();
    setHome('HC-A', 'offline');
    setHome('HC-B', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);
    setHome('HC-A', 'served');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(effectiveServing('HC-A')?.kind).toBe('local'); // existing recovery debounce
    await vi.advanceTimersByTimeAsync(12_000);
    expect(controller.isActive()).toBe(true); // B still needs the shared observation resources
    expect(effectiveServing('HC-A')?.kind).toBe('cloud');
    expect(effectiveServing('HC-B')?.kind).toBe('local');
  });

  it('starts each home’s engage delay when that home loses its relay', async () => {
    const { controller, setHome } = await setup();
    setHome('HC-A', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);
    setHome('HC-B', 'offline');
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.canServe('state.set', { homeId: 'HC-A' })).toBe(true);
    expect(controller.canServe('state.set', { homeId: 'HC-B' })).toBe(false);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(controller.canServe('state.set', { homeId: 'HC-B' })).toBe(true);
  });

  it('notifies serving subscribers when one home recovers while the other remains local', async () => {
    const { setHome, effectiveServing, subscribeHomeServing } = await setup();
    const seen: Array<[string, string | null | undefined]> = [];
    subscribeHomeServing(id => seen.push([id, effectiveServing(id)?.kind]));
    setHome('HC-A', 'offline');
    setHome('HC-B', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(seen).toContainEqual(['HC-A', 'local']);
    setHome('HC-A', 'served');
    seen.length = 0;
    await vi.advanceTimersByTimeAsync(22_000);
    expect(seen).toContainEqual(['HC-A', 'cloud']);
    expect(seen).toContainEqual(['HC-B', 'local']);
  });

  it.each(['on', 'socket-down'])('preserves whole-device fallback for %s', async (mode) => {
    const { controller, effectiveServing } = await setup();
    if (mode === 'on') localStorage.setItem('homecast-local-mode', 'on');
    else runtime.socket = 'reconnecting';
    await vi.advanceTimersByTimeAsync(10_000);
    for (const homeId of ['HC-A', 'HC-B', 'HC-C']) {
      expect(controller.canServe('state.set', { homeId })).toBe(true);
      expect(effectiveServing(homeId)?.kind).toBe('local');
      expect(controller.getState(homeId).reason).toBe(mode === 'on' ? 'manual' : 'socket-down');
    }
    expect(controller.canServe('homes.list', {})).toBe(mode === 'socket-down');
    expect(controller.canServe('subscribe', { homeId: 'HC-A' })).toBe(false);
  });

  it('preserves the longer wait on a standby Mac, then yields immediately if it becomes the relay', async () => {
    runtime.relayCapable = true;
    const { controller, setHome, effectiveServing } = await setup();
    setHome('HC-A', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.isActive()).toBe(false);
    await vi.advanceTimersByTimeAsync(22_000);
    expect(effectiveServing('HC-A')?.kind).toBe('local');
    setHome('HC-B', 'served', 'this-phone');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(controller.isActive()).toBe(false);
    expect(effectiveServing('HC-A')?.state).toBe('offline');
  });

  it('never claims local availability for an unavailable home absent from this device’s HomeKit', async () => {
    runtime.liveIds = ['LIVE-B', 'LIVE-C'];
    const { controller, setHome, effectiveServing } = await setup();
    setHome('HC-A', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.canServe('state.set', { homeId: 'HC-A' })).toBe(false);
    expect(effectiveServing('HC-A')?.state).toBe('offline');
    expect(effectiveServing('HC-B')?.kind).toBe('cloud');
  });

  it('does not turn missing server facts into a reason to take over another home', async () => {
    const { controller, setHome, invalidateHomeServing } = await setup();
    invalidateHomeServing();
    setHome('HC-A', 'offline');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(controller.canServe('state.set', { homeId: 'HC-A' })).toBe(true);
    expect(controller.canServe('state.set', { homeId: 'HC-B' })).toBe(false);
  });
});
