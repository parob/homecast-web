// A write and the observer event for that same write arrive under different
// names, and everything downstream is keyed on the observer's name.
//
// `CharacteristicMapper.swift` accepts "on" but always *reports* "power_state"
// (its reverse map is pinned so events don't rename themselves between
// launches). So a client turning a light on announced `on`, the trigger watched
// `power_state`, and nothing fired — automations worked from Apple Home and did
// nothing from Homecast. Confirmed live: serviceGroup.set with
// characteristicType "on" reached HomeKit in 1045ms and ran no automation.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { canonicalCharacteristic, SIMPLE_TO_CHAR } from '@/lib/characteristic-aliases';

describe('canonicalCharacteristic', () => {
  it('renames a write to what the observer would call it', () => {
    expect(canonicalCharacteristic('on')).toBe('power_state');
  });

  it('leaves an already-canonical name alone', () => {
    // Safe to apply to a name of unknown provenance — the caller usually
    // cannot tell which side of the bridge it came from.
    expect(canonicalCharacteristic('power_state')).toBe('power_state');
    expect(canonicalCharacteristic('brightness')).toBe('brightness');
  });

  it('passes through anything it has never heard of', () => {
    expect(canonicalCharacteristic('some_vendor_thing')).toBe('some_vendor_thing');
  });

  it('is idempotent, so applying it twice cannot corrupt a name', () => {
    for (const simple of Object.keys(SIMPLE_TO_CHAR)) {
      const once = canonicalCharacteristic(simple);
      expect(canonicalCharacteristic(once)).toBe(once);
    }
  });
});

describe('notifyRelayWrite, through the real engine', () => {
  let mod: typeof import('../index');

  beforeEach(async () => {
    vi.resetModules();
    mod = await import('../index');
    await mod.initAutomationEngine({
      bridge: {
        setCharacteristic: vi.fn(async () => {}),
        setServiceGroupCharacteristic: vi.fn(async () => {}),
        executeScene: vi.fn(async () => {}),
      } as never,
      subscribeToHomeKit: () => () => {},
      onNotify: async () => {},
    });
  });

  afterEach(() => {
    mod.teardownAutomationEngine();
    vi.restoreAllMocks();
  });

  it('stores a write under the name the observer uses, not the name the write used', () => {
    mod.notifyRelayWrite('ACC-1', 'on', true);

    const store = mod.getAutomationEngine()!.stateStore;
    // The trigger watches power_state, because that is what HomeKit reports.
    expect(store.getState('ACC-1', 'power_state')).toBe(true);
    // And nothing is left in the slot the write named, which nothing watches.
    expect(store.getState('ACC-1', 'on')).toBeUndefined();
  });

  it('does not re-report a value the store already holds', () => {
    // Guards double-firing when HomeKit does report the change and gets here
    // first — and it has to compare against the canonical slot to work at all.
    mod.notifyRelayWrite('ACC-2', 'power_state', true);
    const store = mod.getAutomationEngine()!.stateStore;
    const before = store.getState('ACC-2', 'power_state');

    mod.notifyRelayWrite('ACC-2', 'on', true);
    expect(store.getState('ACC-2', 'power_state')).toBe(before);
  });

  it('is a no-op with no engine, rather than throwing into the write path', () => {
    // Called from the relay's request handler — this must never be able to
    // fail a write that already landed.
    mod.teardownAutomationEngine();
    expect(() => mod.notifyRelayWrite('ACC', 'on', true)).not.toThrow();
  });
});
