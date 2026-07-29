// Every write this relay performs must be announced, and no write may loop.
//
// HomeKit fires no observer for a write the relay itself made, so two consumers
// have to be told by hand: the automation engine (whose only source of state is
// that observer) and everyone else (cloud broadcast + MQTT, or LAN clients).
// That wiring lived per write path across three files, and every new path
// forgot at least one consumer — three separate production bugs:
//
//   - state.set (REST/MCP/Home Assistant) told neither
//   - the engine's own writes told nobody
//   - scene.execute told neither, and still didn't after the first two fixes
//
// relay-write.ts is now the single fan-out. These tests are what make forgetting
// it impossible: the behavioural ones check each path announces, and the last
// one reads the handler's own source so a *new* write path cannot be added
// without either announcing or being explicitly exempted.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// vi.mock is hoisted above the file, so anything its factory closes over has
// to be hoisted with it.
const { native, notifyRelayWrite, notifyRelayGroupWrite, getServiceGroupMembers } = vi.hoisted(() => ({
  native: {
    setCharacteristic: vi.fn(),
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

vi.mock('@/automation', () => ({ notifyRelayWrite, notifyRelayGroupWrite, getServiceGroupMembers }));

import { executeHomeKitAction } from '../local-handler';
import { setRelayWritePublisher, announceRelayWrite, announceRelayGroupWrite } from '../relay-write';
import { createHomeKitBridgeAdapter } from '@/automation/relay-adapter';

let publisher: { characteristic: ReturnType<typeof vi.fn>; serviceGroup: ReturnType<typeof vi.fn> };

beforeEach(() => {
  vi.clearAllMocks();
  native.setCharacteristic.mockResolvedValue({ success: true });
  native.setServiceGroupCharacteristic.mockResolvedValue({ success: true, affectedCount: 3 });
  native.setState.mockResolvedValue({
    success: true, ok: 1, failed: [],
    changes: [{ accessoryId: 'bulb-9', characteristicType: 'power_state', value: true }],
  });
  native.executeScene.mockResolvedValue({ success: true, sceneId: 's-1' });
  publisher = { characteristic: vi.fn(), serviceGroup: vi.fn() };
  setRelayWritePublisher(publisher);
});

afterEach(() => setRelayWritePublisher(null));

describe('a write from a client announces to both consumers', () => {
  it('characteristic.set', async () => {
    await executeHomeKitAction('characteristic.set',
      { accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 });

    expect(notifyRelayWrite).toHaveBeenCalledWith('bulb-1', 'power_state', 1);
    expect(publisher.characteristic).toHaveBeenCalledWith(
      expect.objectContaining({ accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 }),
    );
  });

  it('serviceGroup.set, carrying the affected count the group tile needs', async () => {
    await executeHomeKitAction('serviceGroup.set',
      { groupId: 'g-1', characteristicType: 'power_state', value: 0, homeId: 'home-1' });

    expect(notifyRelayGroupWrite).toHaveBeenCalledWith('g-1', 'power_state', 0);
    expect(publisher.serviceGroup).toHaveBeenCalledWith('g-1', 'power_state', 0, 'home-1', 3);
  });

  it('state.set — the REST, MCP and Home Assistant path', async () => {
    await executeHomeKitAction('state.set', { state: { kitchen: { bulb: { on: true } } }, homeId: 'home-1' });

    expect(notifyRelayWrite).toHaveBeenCalledWith('bulb-9', 'power_state', true);
    expect(publisher.characteristic).toHaveBeenCalledWith(
      expect.objectContaining({ accessoryId: 'bulb-9', homeId: 'home-1' }),
    );
  });
});

describe('a write from the automation engine announces outward only', () => {
  it('announces a characteristic write to clients', async () => {
    await createHomeKitBridgeAdapter().setCharacteristic('bulb-1', 'power_state', 1);

    expect(publisher.characteristic).toHaveBeenCalledWith(
      expect.objectContaining({ accessoryId: 'bulb-1', value: 1 }),
    );
  });

  it('never feeds its own write back into the engine', async () => {
    // The loop: the engine's action lands as a state change, re-satisfies the
    // trigger that caused it, and runs again — a light that turns itself on
    // forever. Origin is what prevents it, and it is a required argument so a
    // new call site has to choose.
    await createHomeKitBridgeAdapter().setCharacteristic('bulb-1', 'power_state', 1);
    await createHomeKitBridgeAdapter().setServiceGroup('g-1', 'power_state', 1, 'home-1');

    expect(notifyRelayWrite).not.toHaveBeenCalled();
    expect(notifyRelayGroupWrite).not.toHaveBeenCalled();
  });

  it('still announces the group write outward', async () => {
    await createHomeKitBridgeAdapter().setServiceGroup('g-1', 'power_state', 1, 'home-1');

    expect(publisher.serviceGroup).toHaveBeenCalled();
  });
});

describe('announcing is defensive', () => {
  it('does not announce a write that failed', async () => {
    // Publishing a change that did not happen leaves every client showing a
    // state the device is not in — worse than announcing late.
    native.setCharacteristic.mockRejectedValueOnce({ code: 'ACCESSORY_UNREACHABLE', message: 'no' });

    await expect(executeHomeKitAction('characteristic.set',
      { accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 })).rejects.toBeDefined();
    expect(publisher.characteristic).not.toHaveBeenCalled();
    expect(notifyRelayWrite).not.toHaveBeenCalled();
  });

  it('survives having no publisher registered', async () => {
    setRelayWritePublisher(null);

    await expect(executeHomeKitAction('characteristic.set',
      { accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 })).resolves.toBeDefined();
    // The engine is still fed — the two consumers are independent.
    expect(notifyRelayWrite).toHaveBeenCalled();
  });

  it('a throwing publisher does not fail the write that already landed', () => {
    setRelayWritePublisher({
      characteristic: () => { throw new Error('socket gone'); },
      serviceGroup: () => { throw new Error('socket gone'); },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(() => announceRelayWrite([{ accessoryId: 'a', characteristicType: 'c', value: 1 }], 'client')).not.toThrow();
    expect(() => announceRelayGroupWrite('g', 'c', 1, 'client')).not.toThrow();
  });

  it('ignores changes with nothing to identify them', () => {
    announceRelayWrite([{ accessoryId: '', characteristicType: 'power_state', value: 1 }], 'client');

    expect(publisher.characteristic).not.toHaveBeenCalled();
  });
});

describe('no write path can skip the fan-out', () => {
  // The guard. Adding `case 'foo.set': return await HomeKit.setX(...)` to the
  // handler without announcing fails here, which is exactly how the last three
  // bugs shipped.
  const source = readFileSync(join(__dirname, '..', 'local-handler.ts'), 'utf8');

  /** Native calls that change device state, as opposed to reading it. */
  const MUTATING_NATIVE_CALLS = [
    'HomeKit.setCharacteristic(',
    'HomeKit.setServiceGroupCharacteristic(',
    'HomeKit.setState(',
    'HomeKit.executeScene(',
  ];

  it('every mutating native call sits in a case that announces, or is marked exempt', () => {
    // Split on the handler's own case labels rather than a line window: the
    // announce can sit several lines after the await, past a comment, and a
    // fixed window silently passes a case it did not actually read.
    const cases = source.split(/\n    case '/).slice(1);
    const unannounced: string[] = [];

    for (const block of cases) {
      const label = block.slice(0, block.indexOf("'"));
      if (!MUTATING_NATIVE_CALLS.some((c) => block.includes(c))) continue;

      const announces = block.includes('announceRelayWrite(') || block.includes('announceRelayGroupWrite(');
      const exempt = block.includes('ANNOUNCE-EXEMPT');
      if (!announces && !exempt) unannounced.push(label);
    }

    expect(unannounced).toEqual([]);
  });

  it('is actually reading the handler — not silently matching nothing', () => {
    // A source-scanning guard that finds no call sites passes forever while
    // proving nothing. Pin that it sees the ones we know are there.
    const cases = source.split(/\n    case '/).slice(1);
    const withWrites = cases.filter((b) => MUTATING_NATIVE_CALLS.some((c) => b.includes(c)));

    expect(withWrites.length).toBeGreaterThanOrEqual(4);
  });

  it('records which paths are deliberately exempt, so the gap stays visible', () => {
    // scene.execute: native returns only {success, sceneId} and does not report
    // which accessories the scene changed, so there is nothing truthful to
    // announce. Closing it needs the Swift bridge to return applied changes the
    // way setState does — an App Store release. If that list ever shrinks to
    // empty, delete this test with the exemption.
    const exemptions = source.split('\n').filter((l) => l.includes('ANNOUNCE-EXEMPT'));

    expect(exemptions).toHaveLength(1);
  });

  it('the handler reaches the engine only through relay-write', () => {
    // Direct notifyRelayWrite calls are how the two halves drifted apart.
    expect(source).not.toContain('notifyRelayWrite(');
    expect(source).not.toContain('notifyRelayGroupWrite(');
  });
});

describe('a group write reaches the individual tiles too', () => {
  // The group tile takes the group-shaped event; every member tile needs its
  // own. Without this a group write updated the group and left each member
  // showing its old value until the device happened to report in — the lights
  // had already changed, the app just had not heard, which reads as a slow or
  // failed automation.
  beforeEach(() => {
    getServiceGroupMembers.mockReturnValue(['ACC-A', 'ACC-B']);
  });

  it('publishes one event per member, as well as the group event', () => {
    announceRelayGroupWrite('GRP-1', 'power_state', true, 'client', 'HOME-1', 2);

    expect(publisher.serviceGroup).toHaveBeenCalledTimes(1);
    expect(publisher.characteristic).toHaveBeenCalledTimes(2);
    expect(publisher.characteristic).toHaveBeenCalledWith(
      { accessoryId: 'ACC-A', characteristicType: 'power_state', value: true, homeId: 'HOME-1' },
    );
  });

  it('does the same for an automation-driven group write', () => {
    // Announcing outward is safe from either origin — a broadcast is a
    // statement about state, not a command, so nothing writes back.
    announceRelayGroupWrite('GRP-1', 'power_state', false, 'automation', 'HOME-1', 2);

    expect(publisher.serviceGroup).toHaveBeenCalledTimes(1);
    expect(publisher.characteristic).toHaveBeenCalledTimes(2);
  });

  it('still sends the group event when membership is unknown', () => {
    // A stale index must not cost the group tile its update as well.
    getServiceGroupMembers.mockReturnValue([]);
    announceRelayGroupWrite('GRP-1', 'power_state', true, 'client');

    expect(publisher.serviceGroup).toHaveBeenCalledTimes(1);
    expect(publisher.characteristic).not.toHaveBeenCalled();
  });
});
