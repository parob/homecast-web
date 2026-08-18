/**
 * `characteristics.set` — one relay request carrying a whole step.
 *
 * It exists because an Action on a large home was one request per accessory:
 * at 223 lights that is 223 round trips, ten sequential waves at the client's
 * concurrency cap, and — the part that costs most — writes that reach HomeKit
 * spread out rather than together, so its daemon has nothing to coalesce into
 * a single HAP request per bridge.
 *
 * What these tests pin is the part a batch can quietly get wrong: reporting.
 * A caller counting "how many of my lights moved" must be told the truth per
 * accessory, and only the writes that actually landed may be announced.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { native, notifyRelayWrite, notifyRelayGroupWrite, getServiceGroupMembers } = vi.hoisted(() => ({
  native: {
    setCharacteristic: vi.fn(),
    setCharacteristics: vi.fn(),
    setServiceGroupCharacteristic: vi.fn(),
    setState: vi.fn(),
    executeScene: vi.fn(),
    onEvent: vi.fn(() => () => {}),
  },
  notifyRelayWrite: vi.fn(),
  getServiceGroupMembers: vi.fn(() => [] as string[]),
  notifyRelayGroupWrite: vi.fn(),
}));

vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: native, default: native,
  getNativeBridge: () => null, isRelayCapable: () => true, isRelayEnabled: () => true,
}));

vi.mock('@/automation', () => ({
  notifyRelayWrite, notifyRelayGroupWrite, getServiceGroupMembers,
  getAutomationEngine: () => null,
}));

import { executeHomeKitAction } from '../local-handler';
import { setRelayWritePublisher } from '../relay-write';

/** What the relay answers when every write lands. */
function allLanded(writes: Array<{ accessoryId: string; characteristicType: string; value: unknown }>) {
  return {
    success: true, ok: writes.length, total: writes.length,
    changes: writes.map(w => ({ ...w, success: true })),
  };
}

const LIGHTS = [
  { accessoryId: 'bulb-1', characteristicType: 'power_state', value: true },
  { accessoryId: 'bulb-2', characteristicType: 'power_state', value: true },
];

let publisher: { characteristic: ReturnType<typeof vi.fn>; serviceGroup: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  native.setCharacteristics.mockImplementation(async (writes: typeof LIGHTS) => allLanded(writes));
  publisher = { characteristic: vi.fn(), serviceGroup: vi.fn() };
  setRelayWritePublisher(publisher);
});

afterEach(() => setRelayWritePublisher(null));

describe('characteristics.set', () => {
  it('hands native the whole batch as one call', async () => {
    await executeHomeKitAction('characteristics.set', { writes: LIGHTS, homeId: 'home-1' });

    expect(native.setCharacteristics).toHaveBeenCalledTimes(1);
    expect(native.setCharacteristics).toHaveBeenCalledWith(LIGHTS);
  });

  it('canonicalises every name at the door', async () => {
    // The bridge accepts `on` and only ever reports `power_state`. A write
    // announced under a name nothing else uses is a write nothing else sees.
    await executeHomeKitAction('characteristics.set', {
      writes: [{ accessoryId: 'bulb-1', characteristicType: 'on', value: true }],
      homeId: 'home-1',
    });

    expect(native.setCharacteristics).toHaveBeenCalledWith([
      { accessoryId: 'bulb-1', characteristicType: 'power_state', value: true },
    ]);
    expect(publisher.characteristic).toHaveBeenCalledWith(
      expect.objectContaining({ characteristicType: 'power_state' }),
    );
  });

  it('announces the batch, and announces it once', async () => {
    await executeHomeKitAction('characteristics.set', { writes: LIGHTS, homeId: 'home-1' });

    expect(publisher.characteristic).toHaveBeenCalledTimes(2);
    expect(notifyRelayWrite).toHaveBeenCalledTimes(2);
    expect(publisher.characteristic).toHaveBeenCalledWith({
      accessoryId: 'bulb-1', characteristicType: 'power_state', value: true, homeId: 'home-1',
    });
  });

  it('announces only what landed', async () => {
    // Telling every client a light came on when it did not leaves the whole
    // house displaying a state it is not in, and nothing later corrects it.
    native.setCharacteristics.mockResolvedValue({
      success: false, ok: 1, total: 2,
      changes: [
        { accessoryId: 'bulb-1', characteristicType: 'power_state', value: true, success: true },
        { accessoryId: 'bulb-2', characteristicType: 'power_state', success: false, error: 'unreachable' },
      ],
    });

    const result = await executeHomeKitAction('characteristics.set', { writes: LIGHTS, homeId: 'home-1' }) as {
      success: boolean; ok: number; total: number;
      changes: Array<{ accessoryId: string; success: boolean }>;
    };

    expect(publisher.characteristic).toHaveBeenCalledTimes(1);
    expect(publisher.characteristic).toHaveBeenCalledWith(expect.objectContaining({ accessoryId: 'bulb-1' }));
    // and the caller is told which one, not merely that something failed
    expect(result.success).toBe(false);
    expect(result.ok).toBe(1);
    expect(result.changes.find(c => c.accessoryId === 'bulb-2')?.success).toBe(false);
  });

  it('reports a value HomeKit confirmed rather than the one asked for', async () => {
    // HomeKit caps some writes (brightness clamps), and every client would
    // otherwise display the number we sent instead of the one that stuck.
    native.setCharacteristics.mockResolvedValue({
      success: true, ok: 1, total: 1,
      changes: [{ accessoryId: 'bulb-1', characteristicType: 'brightness', value: 100, success: true }],
    });

    await executeHomeKitAction('characteristics.set', {
      writes: [{ accessoryId: 'bulb-1', characteristicType: 'brightness', value: 120 }],
      homeId: 'home-1',
    });

    expect(publisher.characteristic).toHaveBeenCalledWith(
      expect.objectContaining({ value: 100 }),
    );
  });

  it('does not trouble native with an empty batch', async () => {
    const result = await executeHomeKitAction('characteristics.set', { writes: [], homeId: 'home-1' });

    expect(native.setCharacteristics).not.toHaveBeenCalled();
    expect(publisher.characteristic).not.toHaveBeenCalled();
    expect(result).toMatchObject({ success: true, ok: 0, total: 0 });
  });
});
