// @vitest-environment jsdom
/**
 * The native bridge's call ceiling.
 *
 * `window.homekit.call()` settles when Swift answers it, and if Swift never
 * answers it never settles. The relay has sat in exactly that state in
 * production — socket up, JavaScript healthy, every HomeKit-backed action
 * hanging until the cloud gave up 30s later with nothing to say about why.
 * These tests pin the ceiling that turns that into a named failure.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { HomeKit } from '@/native/homekit-bridge';

/** Matches BRIDGE_CALL_TIMEOUT_MS in homekit-bridge.ts. */
const CEILING_MS = 20_000;

type BridgeCall = (method: string, payload?: Record<string, unknown>) => Promise<unknown>;

function installBridge(call: BridgeCall) {
  (window as unknown as { homekit: unknown }).homekit = {
    call,
    onEvent: () => () => {},
  };
}

describe('native bridge call ceiling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (window as unknown as { homekit?: unknown }).homekit;
  });

  it('rejects as BRIDGE_TIMEOUT when the native side never answers', async () => {
    // The fault itself: a promise that is never settled by Swift.
    installBridge(() => new Promise(() => {}));

    const pending = HomeKit.listAccessories();
    // Assert before advancing: a bare rejection here would be unhandled.
    const settled = expect(pending).rejects.toMatchObject({
      code: 'BRIDGE_TIMEOUT',
      method: 'accessories.list',
    });

    await vi.advanceTimersByTimeAsync(CEILING_MS);
    await settled;
  });

  it('leaves a call that answers in time alone', async () => {
    installBridge(() => Promise.resolve([{ id: 'a1' }]));

    await expect(HomeKit.listAccessories()).resolves.toEqual([{ id: 'a1' }]);
  });

  it('clears its timer once the call has answered', async () => {
    installBridge(() => Promise.resolve([]));

    await expect(HomeKit.listRooms('h1')).resolves.toEqual([]);
    // An uncleared timer per call would leak one pending timeout for every
    // HomeKit call the relay ever makes.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('propagates a real native error rather than masking it as a timeout', async () => {
    installBridge(() => Promise.reject(Object.assign(new Error('nope'), { code: 'HOMEKIT_ERROR' })));

    await expect(HomeKit.listAccessories()).rejects.toMatchObject({ code: 'HOMEKIT_ERROR' });
  });

  it('exempts the permission prompt, which waits on a person', async () => {
    // A system prompt has no deadline; taking longer than the ceiling to click
    // it is not a fault, and rejecting would strand the caller.
    installBridge(() => new Promise(() => {}));

    let settled = false;
    void HomeKit.requestNotificationPermission().then(
      () => { settled = true; },
      () => { settled = true; },
    );

    await vi.advanceTimersByTimeAsync(CEILING_MS * 3);
    expect(settled).toBe(false);
  });
});
