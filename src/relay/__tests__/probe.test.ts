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

// Characteristic names are the relay's canonical snake_case. This fixture used
// to default to 'On' — HomeKit's PascalCase spelling — which is why the probe's
// PascalCase preference list looked like it worked in tests and matched nothing
// in production.
function acc(id: string, name: string, ...charTypes: string[]) {
  const types = charTypes.length ? charTypes : ['power_state'];
  return {
    id,
    name,
    isReachable: true,
    services: [{
      characteristics: types.map((characteristicType) => ({
        characteristicType, isReadable: true,
      })),
    }],
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

describe('relay.probe during a power cut', () => {
  beforeEach(() => {
    listAccessories.mockReset();
    getCharacteristic.mockReset();
  });

  it('does not fall back to cached metadata when a live read fails', async () => {
    // George Street, 4 Sep 2026: every device unreachable, but HomeKit still
    // answers manufacturer/model from its cache. Reading one of those after
    // the live read failed reported the dark house as verified for six hours.
    listAccessories.mockResolvedValue([
      acc('dead', 'Hue bridge', 'power_state'),
      acc('meta', 'Hue bridge info', 'manufacturer'),
    ]);
    getCharacteristic.mockImplementation(async (id: string) => {
      if (id === 'dead') throw unreachable();
      return { value: 'Signify Netherlands B.V.' };
    });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'pc1' });
    expect(res.error).toBe('unreachable');
    expect(res.value).toBeUndefined();
    expect(getCharacteristic).not.toHaveBeenCalledWith('meta', 'manufacturer');
  });
});

describe('relay.probe characteristic preference', () => {
  beforeEach(() => {
    listAccessories.mockReset();
    getCharacteristic.mockReset();
  });

  it('prefers a real device read over cached metadata', async () => {
    // `manufacturer` and friends are answered from HomeKit's own cache without
    // touching the accessory, so probing with one proves nothing about the
    // home. A home whose every device was unreachable still reported
    // `verified` because the probe read one of these.
    listAccessories.mockResolvedValue([
      acc('meta', 'Hue color candle', 'manufacturer', 'serial_number'),
      acc('real', 'Kitchen sensor', 'current_temperature'),
    ]);
    getCharacteristic.mockResolvedValue({ value: 19.5 });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'p1' });
    expect(res.accessoryId).toBe('real');
    expect(res.characteristicType).toBe('current_temperature');
  });

  it('ranks cached metadata below an unrecognised characteristic', async () => {
    // An unknown name is at least probably a real read; a known-cached one is
    // definitely not.
    listAccessories.mockResolvedValue([
      acc('meta', 'a', 'model'),
      acc('unknown', 'b', 'eve_blinds_movement'),
    ]);
    getCharacteristic.mockResolvedValue({ value: 1 });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'p2' });
    expect(res.accessoryId).toBe('unknown');
  });

  it('still uses cached metadata rather than giving up when it is all there is', async () => {
    listAccessories.mockResolvedValue([acc('only', 'a', 'name')]);
    getCharacteristic.mockResolvedValue({ value: 'Lamp' });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'p3' });
    expect(res.noProbeTarget).toBeUndefined();
    expect(res.value).toBe('Lamp');
  });

  it('falls past a dead top-tier accessory into the next tier', async () => {
    // The top tier can legitimately hold ONE accessory (a home with a single
    // thermometer). Restricting attempts to the tier would report the whole
    // home unverified whenever that one device was unplugged.
    listAccessories.mockResolvedValue([
      acc('probe-me-first', 'Thermostat', 'current_temperature'),
      acc('fallback', 'Lamp', 'power_state'),
    ]);
    getCharacteristic.mockImplementation(async (id: string) => {
      if (id === 'probe-me-first') throw unreachable();
      return { value: true };
    });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'p4' });
    expect(res.error).toBeUndefined();
    expect(res.accessoryId).toBe('fallback');
  });

  it('does not treat HomeKit PascalCase spellings as preferred', async () => {
    // Guards the regression directly: if the list ever goes back to PascalCase,
    // 'On' would outrank a genuine snake_case sensor read.
    listAccessories.mockResolvedValue([
      acc('pascal', 'a', 'On'),
      acc('canonical', 'b', 'current_temperature'),
    ]);
    getCharacteristic.mockResolvedValue({ value: 20 });
    const res: any = await executeHomeKitAction('relay.probe', { homeId: 'p5' });
    expect(res.accessoryId).toBe('canonical');
  });
});
