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

describe('notifyRelayGroupWrite when expansion produces nothing', () => {
  // Triggers are evaluated per accessory, so a group write that expands to no
  // members reaches no trigger. This used to happen behind `?? []` — the same
  // shape as every other bug on this path: a lookup failing to an empty result
  // and looking like a quiet day.
  let mod: typeof import('../index');
  let activity: typeof import('../../server/local-activity');

  beforeEach(async () => {
    vi.resetModules();
    mod = await import('../index');
    activity = await import('../../server/local-activity');
  });

  afterEach(() => { mod.teardownAutomationEngine(); });

  async function start(resolver?: { getMembers?: (id: string) => string[] }) {
    await mod.initAutomationEngine({
      bridge: {
        setCharacteristic: vi.fn(async () => {}),
        setServiceGroupCharacteristic: vi.fn(async () => {}),
        executeScene: vi.fn(async () => {}),
      } as never,
      subscribeToHomeKit: () => () => {},
      onNotify: async () => {},
      ...(resolver ? { serviceGroupResolver: resolver as never } : {}),
    });
  }

  it('records a fault when no resolver is wired, instead of doing nothing', async () => {
    await start();
    mod.notifyRelayGroupWrite('GRP-1', 'on', true);

    const faults = activity.getActivityDump({ faultsOnly: true, limit: 10 }).entries;
    expect(faults.some((e) => String(e.error).includes('no service-group resolver'))).toBe(true);
  });

  it('distinguishes an unknown group from a missing resolver', async () => {
    await start({ getMembers: () => [] });
    mod.notifyRelayGroupWrite('GRP-UNKNOWN', 'on', true);

    const faults = activity.getActivityDump({ faultsOnly: true, limit: 10 }).entries;
    // The two need different responses: one is a wiring bug, one recovers on
    // the next index refresh.
    expect(faults.some((e) => String(e.error).includes('membership index'))).toBe(true);
  });

  it('stays silent and fans out when the group resolves', async () => {
    await start({ getMembers: () => ['ACC-A', 'ACC-B'] });
    mod.notifyRelayGroupWrite('GRP-1', 'on', true);

    const store = mod.getAutomationEngine()!.stateStore;
    expect(store.getState('ACC-A', 'power_state')).toBe(true);
    expect(store.getState('ACC-B', 'power_state')).toBe(true);
    expect(activity.getActivityDump({ faultsOnly: true, limit: 10 }).entries).toHaveLength(0);
  });
});

describe('seeding what the relay already knows', () => {
  // HomeKit delivers every accessory's current value right after the relay
  // subscribes, each as `undefined -> value`. A trigger naming only `to:` has
  // nothing to reject that with, so every automation whose target matched the
  // current state fired at once — a restart notified for the lot.
  let mod: typeof import('../index');
  const bridge = () => ({
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  }) as never;

  beforeEach(async () => {
    vi.resetModules();
    mod = await import('../index');
    await mod.initAutomationEngine({
      bridge: bridge(), subscribeToHomeKit: () => () => {}, onNotify: async () => {},
    });
  });
  afterEach(() => { mod.teardownAutomationEngine(); });

  it('records values without publishing them as changes', () => {
    const seen: unknown[] = [];
    mod.getAutomationEngine()!.stateStore.onAnyStateChange((e) => seen.push(e));

    mod.seedAutomationState([
      { accessoryId: 'ACC-1', characteristicType: 'power_state', value: true },
    ]);

    expect(mod.getAutomationEngine()!.stateStore.getState('ACC-1', 'power_state')).toBe(true);
    // The whole point: no trigger can fire off a seed.
    expect(seen).toHaveLength(0);
  });

  it('turns HomeKit\'s startup burst into a no-op', () => {
    mod.seedAutomationState([
      { accessoryId: 'ACC-1', characteristicType: 'power_state', value: true },
    ]);
    const seen: unknown[] = [];
    mod.getAutomationEngine()!.stateStore.onAnyStateChange((e) => seen.push(e));

    // HomeKit now reports what it already had.
    mod.getAutomationEngine()!.stateStore.updateDeviceState('ACC-1', 'power_state', true);
    expect(seen).toHaveLength(0);
  });

  it('still reports a genuine change after seeding', () => {
    mod.seedAutomationState([
      { accessoryId: 'ACC-1', characteristicType: 'power_state', value: true },
    ]);
    const seen: Array<{ oldValue: unknown; newValue: unknown }> = [];
    mod.getAutomationEngine()!.stateStore.onAnyStateChange((e) => seen.push(e));

    mod.getAutomationEngine()!.stateStore.updateDeviceState('ACC-1', 'power_state', false);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ oldValue: true, newValue: false });
  });

  it('never overwrites something already learned', () => {
    // A real event that arrived while the seed was being fetched is newer than
    // the seed, and must win.
    mod.getAutomationEngine()!.stateStore.updateDeviceState('ACC-1', 'power_state', false);
    const seeded = mod.seedAutomationState([
      { accessoryId: 'ACC-1', characteristicType: 'power_state', value: true },
    ]);

    expect(seeded).toBe(0);
    expect(mod.getAutomationEngine()!.stateStore.getState('ACC-1', 'power_state')).toBe(false);
  });

  it('is a no-op with no engine, rather than throwing into startup', () => {
    mod.teardownAutomationEngine();
    expect(() => mod.seedAutomationState([
      { accessoryId: 'A', characteristicType: 'power_state', value: true },
    ])).not.toThrow();
  });
});
