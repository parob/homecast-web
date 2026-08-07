/**
 * `state.set` has to service virtual accessories itself.
 *
 * It is the path REST (`POST /rest/state`), the MCP `set_state` tool and Home
 * Assistant all take, and it is addressed by slug: the native side resolves
 * each key against HomeKit. A virtual accessory is owned by the engine and is
 * not in HomeKit, so every write to one arriving this way was dropped without
 * a word — while `get_state` reported its characteristic and listed it in
 * `_settable`. Advertising a write and then discarding it is worse than not
 * supporting it, because nothing tells the caller.
 *
 * `characteristic.set` (the dashboard, the apps, MQTT `/set`) already handled
 * them. These tests pin the bulk path onto the same behaviour.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

const setState = vi.fn();

vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: { onEvent: vi.fn(() => () => {}), setState: (...a: unknown[]) => setState(...a) },
  default: { onEvent: vi.fn(() => () => {}) },
  getNativeBridge: vi.fn(() => null),
  isRelayCapable: () => true,
  isRelayEnabled: () => true,
}));

import { executeHomeKitAction } from '@/relay/local-handler';
import { initAutomationEngine, teardownAutomationEngine, getAutomationEngine } from '@/automation';
import type { VirtualAccessoryDefinition } from '@/automation/types/automation';

const bridge = {
  setCharacteristic: vi.fn(async () => {}),
  setServiceGroup: vi.fn(async () => {}),
  executeScene: vi.fn(async () => {}),
};

// Slug keys are `sanitizeName(name)_<last 4 of id>` — the same shape
// `GET /rest/state` reports, which is the only spelling a caller can have seen.
const MODE: VirtualAccessoryDefinition = {
  id: 'va-mode-0001', name: 'Home Mode', type: 'input_select',
  homeId: 'HOME-1', options: ['Home', 'Away'], initialValue: 'Home',
} as VirtualAccessoryDefinition;
const MODE_KEY = 'home_mode_0001';

const COUNTER: VirtualAccessoryDefinition = {
  id: 'va-count-0002', name: 'Counter', type: 'counter', homeId: 'HOME-1', initial: 0,
} as VirtualAccessoryDefinition;
const COUNTER_KEY = 'counter_0002';

const READONLY: VirtualAccessoryDefinition = {
  id: 'va-ro-0003', name: 'Readonly Mode', type: 'input_select',
  homeId: 'HOME-1', options: ['a', 'b'], initialValue: 'a', controllable: false,
} as VirtualAccessoryDefinition;
const READONLY_KEY = 'readonly_mode_0003';

beforeEach(async () => {
  vi.clearAllMocks();
  setState.mockResolvedValue({ success: true, ok: 1, failed: [], changes: [] });
  const engine = await initAutomationEngine({
    bridge,
    subscribeToHomeKit: () => () => {},
    onNotify: async () => {},
  });
  engine.virtualManager.loadAll([MODE, COUNTER, READONLY]);
});

afterEach(() => { teardownAutomationEngine(); });

const valueOf = (id: string) => getAutomationEngine()!.getVirtualStates()[id];

describe('state.set on a virtual accessory', () => {
  it('applies the write instead of handing it to HomeKit', async () => {
    const result = await executeHomeKitAction('state.set', {
      state: { unknown_: { [MODE_KEY]: { virtual_mode: 'Away' } } },
      homeId: 'HOME-1',
    }) as { ok: number; changes: Array<{ accessoryId: string }> };

    expect(valueOf(MODE.id)).toBe('Away');
    // Nothing left for native — it would only have failed to resolve the key
    expect(setState).not.toHaveBeenCalled();
    expect(result.ok).toBe(1);
    expect(result.changes.map(c => c.accessoryId)).toEqual([MODE.id]);
  });

  it('sets a counter rather than adding to it', async () => {
    await executeHomeKitAction('state.set', {
      state: { unknown_: { [COUNTER_KEY]: { virtual_count: 7 } } },
      homeId: 'HOME-1',
    });
    expect(valueOf(COUNTER.id)).toBe(7);

    await executeHomeKitAction('state.set', {
      state: { unknown_: { [COUNTER_KEY]: { virtual_count: 2 } } },
      homeId: 'HOME-1',
    });
    expect(valueOf(COUNTER.id)).toBe(2);
  });

  it('still sends HomeKit accessories to native, in the same call', async () => {
    setState.mockResolvedValue({
      success: true, ok: 1, failed: [],
      changes: [{ accessoryId: 'bulb-1', characteristicType: 'power_state', value: true }],
    });

    const result = await executeHomeKitAction('state.set', {
      state: {
        kitchen_aaaa: { bulb_bbbb: { on: true } },
        unknown_: { [MODE_KEY]: { virtual_mode: 'Away' } },
      },
      homeId: 'HOME-1',
    }) as { ok: number; changes: Array<{ accessoryId: string }> };

    // Native saw only the HomeKit half
    expect(setState).toHaveBeenCalledTimes(1);
    expect(setState.mock.calls[0][0]).toEqual({ kitchen_aaaa: { bulb_bbbb: { on: true } } });
    expect(valueOf(MODE.id)).toBe('Away');
    // Both halves are counted and announced
    expect(result.ok).toBe(2);
    expect(result.changes.map(c => c.accessoryId).sort()).toEqual([MODE.id, 'bulb-1'].sort());
  });

  it('reports a read-only virtual accessory as failed rather than throwing', async () => {
    const result = await executeHomeKitAction('state.set', {
      state: { unknown_: { [READONLY_KEY]: { virtual_mode: 'b' } } },
      homeId: 'HOME-1',
    }) as { failed: string[] };

    expect(valueOf(READONLY.id)).toBe('a');
    expect(result.failed).toContain(`unknown_/${READONLY_KEY}.virtual_mode`);
  });

  it('leaves an unrelated key for native rather than swallowing it', async () => {
    await executeHomeKitAction('state.set', {
      state: { kitchen_aaaa: { some_light_9999: { on: true } } },
      homeId: 'HOME-1',
    });
    expect(setState).toHaveBeenCalledWith({ kitchen_aaaa: { some_light_9999: { on: true } } }, 'HOME-1');
  });

  it('ignores a virtual accessory belonging to another home', async () => {
    await executeHomeKitAction('state.set', {
      state: { unknown_: { [MODE_KEY]: { virtual_mode: 'Away' } } },
      homeId: 'SOME-OTHER-HOME',
    });
    // Untouched here, and passed through for native to fail to resolve
    expect(valueOf(MODE.id)).toBe('Home');
    expect(setState).toHaveBeenCalled();
  });
});
