// A change made by an automation has to reach the apps.
//
// Reported as "it takes a while to reflect the changes in the client from
// automations", against changes made in Apple Home appearing instantly.
//
// HomeKit fires no observer for a write the relay itself made, and engine
// actions deliberately bypass the relay's action handler so an automation
// cannot feed itself its own output. A client-initiated write compensates by
// sending `characteristic.updated` to the server; the engine's bridge sent
// nothing at all. So an automation-driven change was announced to nobody — no
// broadcast to web/iOS clients, no MQTT publish — and apps only caught up when
// a device happened to report independently or a cache expired.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@/native/homekit-bridge', () => {
  const HomeKit = {
    setCharacteristic: vi.fn().mockResolvedValue(undefined),
    setServiceGroupCharacteristic: vi.fn().mockResolvedValue(undefined),
    executeScene: vi.fn().mockResolvedValue(undefined),
    onEvent: vi.fn(() => () => {}),
  };
  return { HomeKit, default: HomeKit, getNativeBridge: () => null, isRelayCapable: () => true, isRelayEnabled: () => true };
});

import { createHomeKitBridgeAdapter } from '../relay-adapter';
import { HomeKit } from '@/native/homekit-bridge';

function publisher() {
  return { characteristic: vi.fn(), serviceGroup: vi.fn() };
}

describe('the engine announces its own writes', () => {
  it('announces a characteristic write', async () => {
    const publish = publisher();
    const bridge = createHomeKitBridgeAdapter(publish);

    await bridge.setCharacteristic('bulb-1', 'power_state', 1);

    expect(HomeKit.setCharacteristic).toHaveBeenCalledWith('bulb-1', 'power_state', 1);
    expect(publish.characteristic).toHaveBeenCalledWith('bulb-1', 'power_state', 1);
  });

  it('announces a service group write, keeping the home for subscription filtering', async () => {
    const publish = publisher();
    const bridge = createHomeKitBridgeAdapter(publish);

    await bridge.setServiceGroup('group-1', 'power_state', 0, 'home-1');

    expect(publish.serviceGroup).toHaveBeenCalledWith('group-1', 'power_state', 0, 'home-1');
  });

  it('announces nothing when the write fails', async () => {
    // Announcing a change that did not happen is worse than announcing late:
    // every client would show a state the device is not in.
    const publish = publisher();
    (HomeKit.setCharacteristic as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      { code: 'ACCESSORY_UNREACHABLE', message: 'no' },
    );
    const bridge = createHomeKitBridgeAdapter(publish);

    await expect(bridge.setCharacteristic('bulb-1', 'power_state', 1)).rejects.toBeDefined();
    expect(publish.characteristic).not.toHaveBeenCalled();
  });

  it('still works with no publisher, for callers that have nobody to tell', async () => {
    const bridge = createHomeKitBridgeAdapter();

    await expect(bridge.setCharacteristic('bulb-1', 'power_state', 1)).resolves.toBeUndefined();
    await expect(bridge.setServiceGroup('g-1', 'power_state', 1)).resolves.toBeUndefined();
    await expect(bridge.executeScene('s-1')).resolves.toBeUndefined();
  });
});
