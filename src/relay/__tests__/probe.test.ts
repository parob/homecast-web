import { vi, describe, it, expect, beforeEach } from 'vitest';

// The probe reads HomeKit through this bridge — mock it so we control which
// accessories exist and which reads succeed/fail.
vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: {
    listAccessories: vi.fn(),
    getCharacteristic: vi.fn(),
  },
}));

import { HomeKit } from '@/native/homekit-bridge';
import { executeHomeKitAction } from '@/relay/local-handler';

const listAccessories = HomeKit.listAccessories as unknown as ReturnType<typeof vi.fn>;
const getCharacteristic = HomeKit.getCharacteristic as unknown as ReturnType<typeof vi.fn>;

function acc(id: string, name: string, charType = 'On') {
  return {
    id,
    name,
    isReachable: true,
    services: [{ characteristics: [{ characteristicType: charType, isReadable: true }] }],
  };
}

function unreachable() {
  return Object.assign(new Error('unreachable'), { code: 'ACCESSORY_UNREACHABLE' });
}

describe('relay.probe accessory selection', () => {
  beforeEach(() => {
    listAccessories.mockReset();
    getCharacteristic.mockReset();
  });

  it('falls through a dead accessory to a working one (verified, not read_error)', async () => {
    // The real prod bug: "Hue color candle" is unreachable but a healthy
    // accessory exists. The probe must verify via the healthy one.
    listAccessories.mockResolvedValue([acc('dead', 'Hue color candle'), acc('good', 'Kitchen AC')]);
    getCharacteristic.mockImplementation(async (id: string) => {
      if (id === 'dead') throw unreachable();
      return { value: 42 };
    });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'h1' });
    expect(res.error).toBeUndefined();
    expect(res.value).toBe(42);
    expect(res.accessoryId).toBe('good');
  });

  it('reports an error only when every attempted accessory fails', async () => {
    listAccessories.mockResolvedValue([acc('d1', 'a'), acc('d2', 'b')]);
    getCharacteristic.mockImplementation(async () => {
      throw unreachable();
    });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'h2' });
    expect(res.value).toBeUndefined();
    expect(res.error).toBe('unreachable');
  });

  it('verifies immediately when the first accessory reads fine', async () => {
    listAccessories.mockResolvedValue([acc('g', 'g')]);
    getCharacteristic.mockResolvedValue({ value: 'on' });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'h3' });
    expect(res.value).toBe('on');
    expect(getCharacteristic).toHaveBeenCalledTimes(1);
  });

  it('caps attempts at PROBE_MAX_ATTEMPTS distinct accessories', async () => {
    const many = Array.from({ length: 12 }, (_, i) => acc('x' + i, 'acc' + i));
    listAccessories.mockResolvedValue(many);
    getCharacteristic.mockImplementation(async () => {
      throw unreachable();
    });
    await executeHomeKitAction('relay.probe', { homeId: 'h4' });
    expect(getCharacteristic.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
