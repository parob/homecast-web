// @vitest-environment jsdom
/**
 * Local Mode's observation has to survive a bad start.
 *
 * homecast-cloud#107 — "it can control accessories fine it's just not updating
 * anything". Control and observation are separate wirings: control is a bridge
 * call per tap, observation is one `observe.start` at engage. If that one call
 * fails, nothing retries it — native's `observe.reset` is a no-op unless it is
 * already observing, so the 30s keep-alive resets a timeout that was never
 * armed. The device then controls the home perfectly and never hears about a
 * change again, which is exactly the reported shape.
 *
 * And a failure there is not exotic: Local Mode engages *because* the relay
 * stopped answering, which is the same moment the app is retrying a dozen
 * requests and the bridge is at its busiest.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const homekit = vi.hoisted(() => ({
  getStatus: vi.fn(async () => ({
    ready: true, authorized: true, restricted: false, determined: true, homeCount: 1,
  })),
  isAvailable: () => true,
  startObserving: vi.fn(async () => ({ success: true, observing: true })),
  stopObserving: vi.fn(async () => ({ success: true, observing: false })),
  resetObservationTimeout: vi.fn(async () => ({ success: true })),
}));

vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: homekit,
  default: homekit,
  isRelayCapable: () => false,
  isLocalCapable: () => true,
  withCallReason: (_reason: string, fn: () => unknown) => fn(),
}));

vi.mock('../../relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async () => ({ homes: [{ id: 'HOME-1' }] })),
}));

vi.mock('../home-serving', () => ({
  getHomeServing: () => null,
  getThisDevice: () => null,
  servedByThisDevice: () => false,
  setDeviceServing: () => {},
}));

vi.mock('../connection', () => ({
  serverConnection: {
    getState: () => ({ connectionState: 'disconnected' }),
    emitBroadcast: vi.fn(),
  },
  communityRequest: vi.fn(async () => ({})),
  clearCommunityCache: vi.fn(),
  setLocalModeRouter: vi.fn(),
}));

vi.mock('../local-identity', () => ({
  localIdentity: {
    loadLast: () => {},
    hasUser: () => false,
    counts: () => null,
    sync: vi.fn(async () => null),
    stableToLive: () => new Map(),
    toStable: (id: string) => id,
    toLivePayload: (p: Record<string, unknown>) => p,
    toStablePayload: (p: unknown) => p,
  },
}));

/** Let queued promise callbacks run between timer advances. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

describe('Local Mode observation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.setItem('homecast-local-mode', 'on');
    homekit.startObserving.mockClear();
    homekit.resetObservationTimeout.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
    localStorage.clear();
    vi.resetModules();
  });

  it('retries when the first observe.start fails', async () => {
    // One rejection, then a healthy bridge — a transient failure, not a broken
    // device.
    homekit.startObserving.mockRejectedValueOnce(
      Object.assign(new Error('HomeKit bridge did not answer observe.start within 15s'),
        { code: 'BRIDGE_TIMEOUT' }),
    );

    const { controller } = await import('../local-mode-controller');
    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);   // first tick → engage
    await settle();

    expect(homekit.startObserving).toHaveBeenCalledTimes(1);
    expect(controller.isActive()).toBe(true);

    // The keep-alive tick. Observation never took, so the only useful thing to
    // do here is ask again.
    await vi.advanceTimersByTimeAsync(31_000);
    await settle();

    expect(homekit.startObserving).toHaveBeenCalledTimes(2);
  });

  it('resets rather than restarts once it is observing', async () => {
    const { controller } = await import('../local-mode-controller');
    controller.start();
    await settle();
    await vi.advanceTimersByTimeAsync(1_100);
    await settle();

    expect(homekit.startObserving).toHaveBeenCalledTimes(1);

    // Two keep-alive ticks. `observe.start` re-runs native's catch-up refresh —
    // a full re-read of every home — so a keep-alive that called it every 30s
    // would be far worse than the bug it fixes.
    await vi.advanceTimersByTimeAsync(61_000);
    await settle();

    expect(homekit.startObserving).toHaveBeenCalledTimes(1);
    expect(homekit.resetObservationTimeout.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
