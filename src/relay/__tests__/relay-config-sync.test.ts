/**
 * Config sync as relay actions.
 *
 * The server delivers automation config over the same DirectRouter path as
 * HomeKit commands, so it arrives as a *request* in the relay's action handler
 * rather than as a fire-and-forget event. That's what makes it cross pods and
 * come back acknowledged.
 *
 * These actions previously lived on AutomationSyncManager as event handlers and
 * had no coverage at this layer at all.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

vi.mock('@/native/homekit-bridge', () => ({
  HomeKit: { onEvent: vi.fn(() => () => {}) },
  default: { onEvent: vi.fn(() => () => {}) },
  getNativeBridge: vi.fn(() => null),
  isRelayCapable: () => true,
  isRelayEnabled: () => true,
}));

import { executeHomeKitAction } from '@/relay/local-handler';
import { initAutomationEngine, teardownAutomationEngine } from '@/automation';
import type { Automation } from '@/automation/types/automation';

const bridge = {
  setCharacteristic: vi.fn(async () => {}),
  setServiceGroup: vi.fn(async () => {}),
  executeScene: vi.fn(async () => {}),
};

function automation(id: string, enabled = true): Automation {
  return {
    id, name: id, homeId: 'home-1', enabled, mode: 'single',
    triggers: [{ id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'motion_detected', to: true }],
    conditions: { operator: 'and', conditions: [] },
    actions: [{ id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: true }],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  };
}

let emit: (e: unknown) => void;

beforeEach(async () => {
  vi.clearAllMocks();
  await initAutomationEngine({
    bridge,
    subscribeToHomeKit: (h) => { emit = h as never; return () => {}; },
    onNotify: async () => {},
  });
});

afterEach(() => teardownAutomationEngine());

const motion = () => emit({
  type: 'characteristic.updated', accessoryId: 'sensor-1',
  characteristicType: 'motion_detected', value: true,
});

describe('automation.sync_all', () => {
  it('loads the automations and acknowledges how many', async () => {
    const res = await executeHomeKitAction('automation.sync_all', {
      automations: [automation('a1'), automation('a2')],
    });

    expect(res).toEqual({ loaded: 2 });
  });

  it('makes them live immediately', async () => {
    await executeHomeKitAction('automation.sync_all', { automations: [automation('a1')] });

    motion();
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());
  });

  it('replaces the previous set rather than merging', async () => {
    await executeHomeKitAction('automation.sync_all', { automations: [automation('a1')] });
    await executeHomeKitAction('automation.sync_all', { automations: [] });

    motion();
    await new Promise(r => setTimeout(r, 50));
    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('tolerates an empty payload', async () => {
    await expect(executeHomeKitAction('automation.sync_all', {})).resolves.toEqual({ loaded: 0 });
  });
});

describe('automation.sync', () => {
  it('updates a single automation and acknowledges it', async () => {
    await executeHomeKitAction('automation.sync_all', { automations: [automation('a1')] });

    const res = await executeHomeKitAction('automation.sync', { automation: automation('a1', false) });

    expect(res).toEqual({ synced: 'a1' });
    motion();
    await new Promise(r => setTimeout(r, 50));
    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('rejects a payload with no automation id', async () => {
    await expect(executeHomeKitAction('automation.sync', { automation: {} })).rejects.toThrow(/required/i);
  });
});

describe('automation.unload', () => {
  it('removes the automation and acknowledges it', async () => {
    await executeHomeKitAction('automation.sync_all', { automations: [automation('a1')] });

    const res = await executeHomeKitAction('automation.unload', { automationId: 'a1' });

    expect(res).toEqual({ deleted: 'a1' });
    motion();
    await new Promise(r => setTimeout(r, 50));
    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('rejects a missing automationId', async () => {
    await expect(executeHomeKitAction('automation.unload', {})).rejects.toThrow(/required/i);
  });
});

describe('without a running engine', () => {
  it('reports that the engine is not running rather than silently succeeding', async () => {
    teardownAutomationEngine();

    await expect(executeHomeKitAction('automation.sync_all', { automations: [] }))
      .rejects.toThrow(/engine not running/i);
  });
});

describe('app.reload', () => {
  /**
   * The relay fetches its JavaScript once at startup and never refetches it, so
   * a deployed relay-side fix stays inert until the Mac app is restarted by
   * hand. That is unworkable for a managed relay nobody is standing next to —
   * every fix this session needed a physical restart to take effect.
   */
  it('acknowledges before reloading, so the response outlives the page', async () => {
    vi.useFakeTimers();
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });

    const res = await executeHomeKitAction('app.reload', {});

    // Answer first — reloading synchronously would drop the socket mid-reply
    // and make every successful reload look like a failed request.
    expect(res).toEqual({ reloading: true, inMs: 500 });
    expect(reload).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(600);
    expect(reload).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('honours a custom delay', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { reload: vi.fn() } });

    expect(await executeHomeKitAction('app.reload', { delayMs: 2000 }))
      .toEqual({ reloading: true, inMs: 2000 });

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('clamps absurd delays rather than trusting the caller', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { reload: vi.fn() } });

    expect((await executeHomeKitAction('app.reload', { delayMs: 0 }) as any).inMs).toBe(100);
    expect((await executeHomeKitAction('app.reload', { delayMs: 999_999 }) as any).inMs).toBe(10_000);

    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
});
