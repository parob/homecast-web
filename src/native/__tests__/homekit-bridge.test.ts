// @vitest-environment jsdom
/**
 * The native bridge's call ceiling.
 *
 * `window.homekit.call()` settles when Swift answers it, and if Swift never
 * answers it never settles. The relay has sat in exactly that state in
 * production — socket up, JavaScript healthy, every HomeKit-backed action
 * hanging until the cloud gave up with nothing to say about why. These tests
 * pin the ceilings that turn that into a named failure.
 *
 * The two numbers are boxed in from opposite sides and the ordering is the
 * whole point, so it is asserted here rather than left to a comment: a read
 * must give up before the cloud does (10s) or the relay never gets to report,
 * and a write must give up after Swift's own 10s write bound or it discards
 * the real per-device result.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { HomeKit } from '@/native/homekit-bridge';

/** Matches BRIDGE_READ_TIMEOUT_MS / BRIDGE_WRITE_TIMEOUT_MS. */
const READ_MS = 8_000;
const WRITE_MS = 12_000;
/** `route_request`'s default in homecast-cloud (`routing/router.py`). */
const CLOUD_MS = 10_000;
/** `HomeKitManager.writeTimeoutSeconds` in the Mac app. */
const SWIFT_WRITE_MS = 10_000;

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

  it('gives up on a read before the cloud does, and after Swift on a write', () => {
    // The reason these are 8s and 12s rather than one number.
    expect(READ_MS).toBeLessThan(CLOUD_MS);
    expect(WRITE_MS).toBeGreaterThan(SWIFT_WRITE_MS);
  });

  it('rejects a read as BRIDGE_TIMEOUT when the native side never answers', async () => {
    // The fault itself: a promise that is never settled by Swift.
    installBridge(() => new Promise(() => {}));

    const pending = HomeKit.listAccessories();
    // Assert before advancing: a bare rejection here would be unhandled.
    const settled = expect(pending).rejects.toMatchObject({
      code: 'BRIDGE_TIMEOUT',
      method: 'accessories.list',
    });

    await vi.advanceTimersByTimeAsync(READ_MS);
    await settled;
  });

  it('holds a write past the read ceiling, so Swift can report the real result', async () => {
    installBridge(() => new Promise(() => {}));

    const pending = HomeKit.setCharacteristic('a1', 'power_state', true);
    const settled = expect(pending).rejects.toMatchObject({
      code: 'BRIDGE_TIMEOUT',
      method: 'characteristic.set',
    });

    // Still outstanding where a read would already have been cut off.
    await vi.advanceTimersByTimeAsync(READ_MS);
    let done = false;
    void pending.then(() => { done = true; }, () => { done = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(false);

    await vi.advanceTimersByTimeAsync(WRITE_MS - READ_MS);
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

    await vi.advanceTimersByTimeAsync(WRITE_MS * 3);
    expect(settled).toBe(false);
  });
});
