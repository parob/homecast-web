// @vitest-environment jsdom
/**
 * A running Action has to show something on the card that was pressed.
 *
 * The two-way cards deliberately have no spinner, on the reasoning that the
 * run writes optimistically and the toggle's thumb therefore moves on its own.
 * That stopped being true when the draggable toggle started supplying an
 * AbortSignal: an interruptible run skips the optimistic pass, so the thumb
 * waits for the relay like everything else. All lights on a large home then
 * showed no thumb, no spinner and no ring for as long as the slowest accessory
 * took — which, with a dead bulb in the set, is the full native write timeout.
 *
 * The fix is the ring the tiles already use, keyed on the action rather than on
 * an accessory. These tests pin the key reaching the registry, because the
 * rendering half is only as good as that.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const request = vi.fn();
vi.mock('@/server/connection', () => ({
  serverConnection: { request: (...a: unknown[]) => request(...a) },
}));
vi.mock('@/hooks/useHomeKitData', () => ({ markPendingUpdate: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }));

const { useRunHomeAction, __resetWriteQueue, __setBulkWriteSupport } = await import('../useRunHomeAction');
const { isWriting, actionKey, accessoryKey, __resetPendingWrites } = await import('@/lib/pending-writes');
type HomeAction = import('../catalog').HomeAction;

const action = (overrides: Partial<HomeAction> = {}): HomeAction => ({
  id: 'lights', label: 'All lights', runningLabel: 'Turning on', subtitle: '0 of 2 on',
  icon: 'lightbulb', serviceType: 'lightbulb', targetCount: 2, turningOn: true, disabled: false,
  steps: [{ writes: [
    { accessoryId: 'a', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: false },
    { accessoryId: 'b', characteristicType: 'power_state', reportedCharacteristicType: 'power_state', value: true, previousValue: false },
  ] }],
  ...overrides,
});

function setup() {
  const { result } = renderHook(() => useRunHomeAction({
    homeId: 'home-1', isViewOnly: false, updateCharacteristicInCache: vi.fn(),
  }));
  return result.current;
}

beforeEach(() => {
  __resetWriteQueue();
  __resetPendingWrites();
  __setBulkWriteSupport(true);
  request.mockReset();
});

describe('an Action registers itself as writing, not only its accessories', () => {
  it('marks the action while the batch is in flight', async () => {
    let release!: () => void;
    request.mockImplementation(() => new Promise(r => { release = () => r({
      success: true, ok: 2, total: 2,
      changes: [
        { accessoryId: 'a', characteristicType: 'power_state', value: true, success: true },
        { accessoryId: 'b', characteristicType: 'power_state', value: true, success: true },
      ],
    }); }));

    const run = setup();
    const pending = run(action(), { signal: new AbortController().signal });
    await Promise.resolve();

    // The card that was pressed, and the tiles it is moving.
    expect(isWriting(actionKey('lights'))).toBe(true);
    expect(isWriting(accessoryKey('a'))).toBe(true);

    release();
    await pending;

    expect(isWriting(actionKey('lights'))).toBe(false);
  });

  it('marks the action on the pre-bulk fallback too', async () => {
    // A relay too old for the batch still runs the action, and the card must
    // not go quiet just because the transport underneath it changed.
    __setBulkWriteSupport(false);
    // Every resolver, not just the last: the fallback issues one request per
    // accessory and they are all in flight at once, so keeping only the most
    // recent leaves the others pending for ever.
    const releases: Array<() => void> = [];
    request.mockImplementation(() => new Promise(r => { releases.push(() => r({})); }));

    const run = setup();
    const pending = run(action(), { signal: new AbortController().signal });
    // More ticks than the batch needs: the fallback reaches the network
    // through runWithConcurrency's worker and then queueWrite's own chain, so
    // the request is a few microtasks further away.
    for (let i = 0; i < 8; i++) await Promise.resolve();

    expect(isWriting(actionKey('lights'))).toBe(true);

    releases.forEach(r => r());
    await pending;

    expect(isWriting(actionKey('lights'))).toBe(false);
  });
});
