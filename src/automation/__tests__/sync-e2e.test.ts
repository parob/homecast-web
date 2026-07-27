/**
 * End-to-end coverage for the Cloud sync path.
 *
 * `AutomationSyncManager` and `relay-adapter` had no tests at all, yet they are
 * the only way automations reach the engine in cloud mode. This drives the full
 * loop with a fake transport:
 *
 *   automation.sync_all -> loadAutomations -> HomeKit event -> trigger ->
 *   action -> bridge call -> trace -> sendMessage('automation.trace')
 *
 * Also covers the relay-adapter's module-level handler registry, which persists
 * across engine teardown/re-init and would otherwise leak between sessions.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import { AutomationSyncManager, type SyncTransport } from '../sync/AutomationSyncManager';
import { createSyncTransport, dispatchAutomationMessage, clearAutomationHandlers } from '../relay-adapter';
import type { HomeKitEvent } from '../../native/homekit-bridge';
import type { Automation } from '../types/automation';

function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Sync test',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [
      { id: 't1', type: 'state', accessoryId: 'sensor-1', characteristicType: 'motion_detected', to: true },
    ],
    conditions: { operator: 'and', conditions: [] },
    actions: [
      { id: 'a1', type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value: true },
    ],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    ...overrides,
  };
}

/** In-memory SyncTransport that lets the test push server messages in. */
function makeTransport() {
  const handlers = new Map<string, (p: Record<string, unknown>) => void>();
  const sent: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const transport: SyncTransport = {
    sendMessage: (type, payload) => { sent.push({ type, payload }); },
    onMessage: (type, handler) => {
      handlers.set(type, handler);
      return () => handlers.delete(type);
    },
    request: async () => null,
  };
  return {
    transport,
    sent,
    push: (type: string, payload: Record<string, unknown>) => handlers.get(type)?.(payload),
    has: (type: string) => handlers.has(type),
  };
}

let engine: AutomationEngine;
let sync: AutomationSyncManager;
let bridge: { setCharacteristic: ReturnType<typeof vi.fn>; setServiceGroup: ReturnType<typeof vi.fn>; executeScene: ReturnType<typeof vi.fn> };
let emit: (e: HomeKitEvent) => void;
let harness: ReturnType<typeof makeTransport>;

beforeEach(async () => {
  bridge = {
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  };
  harness = makeTransport();
  engine = new AutomationEngine({
    bridge,
    onTraceComplete: (t) => sync.pushTrace(t),
    onNotify: async () => {},
  });
  sync = new AutomationSyncManager(engine, harness.transport);
  engine.initialize((handler) => { emit = handler; return () => {}; });
  await sync.initialize();
});

afterEach(() => {
  sync.teardown();
  engine.teardown();
  clearAutomationHandlers();
});

describe('server -> relay sync', () => {
  it('loads automations pushed as sync_all and runs them on a HomeKit event', async () => {
    harness.push('automation.sync_all', { automations: [makeAutomation()] });

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', true);
  });

  it('sends the resulting trace back to the server', async () => {
    harness.push('automation.sync_all', { automations: [makeAutomation()] });

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await vi.waitFor(() => expect(harness.sent.some(m => m.type === 'automation.trace')).toBe(true));

    const trace = harness.sent.find(m => m.type === 'automation.trace')!;
    expect((trace.payload.trace as any).automationId).toBe('auto-1');
  });

  it('replaces the whole set on a second sync_all', async () => {
    harness.push('automation.sync_all', { automations: [makeAutomation()] });
    harness.push('automation.sync_all', { automations: [] });

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('applies a single-automation sync update', async () => {
    harness.push('automation.sync_all', { automations: [makeAutomation()] });
    harness.push('automation.sync', { automation: makeAutomation({ enabled: false }) });

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('removes an automation on delete', async () => {
    harness.push('automation.sync_all', { automations: [makeAutomation()] });
    harness.push('automation.delete', { automationId: 'auto-1' });

    emit({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'motion_detected', value: true });
    await new Promise(r => setTimeout(r, 50));

    expect(bridge.setCharacteristic).not.toHaveBeenCalled();
  });

  it('routes a webhook trigger through to the engine', async () => {
    harness.push('automation.sync_all', {
      automations: [makeAutomation({
        triggers: [{ id: 't1', type: 'webhook', webhookId: 'hook-1' }],
      })],
    });

    harness.push('automation.webhook_trigger', { webhookId: 'hook-1', body: { ok: true } });
    await vi.waitFor(() => expect(bridge.setCharacteristic).toHaveBeenCalled());
  });

  it('registers every documented inbound message type', () => {
    for (const type of [
      'automation.sync_all',
      'automation.sync',
      'automation.delete',
      'automation.webhook_trigger',
      'automation.notification_response',
    ]) {
      expect(harness.has(type)).toBe(true);
    }
  });

  it('stops handling messages after teardown', () => {
    sync.teardown();

    expect(harness.has('automation.sync_all')).toBe(false);
  });
});

describe('trace queueing', () => {
  it('queues traces raised before the transport connects, then flushes them', async () => {
    const local = makeTransport();
    const offlineEngine = new AutomationEngine({
      bridge,
      onTraceComplete: () => {},
      onNotify: async () => {},
    });
    const offlineSync = new AutomationSyncManager(offlineEngine, local.transport);

    // Not initialized yet — pushTrace should buffer rather than drop.
    offlineSync.pushTrace({
      id: 'trace-1', automationId: 'auto-1', automationName: 'x',
      startedAt: new Date().toISOString(), status: 'success',
      triggerData: { triggerId: 't', triggerType: 'state', timestamp: Date.now() },
      steps: [], variables: {},
    });
    expect(local.sent).toHaveLength(0);

    await offlineSync.initialize();

    expect(local.sent.filter(m => m.type === 'automation.trace')).toHaveLength(1);
    offlineSync.teardown();
    offlineEngine.teardown();
  });
});

describe('relay-adapter handler registry', () => {
  afterEach(() => clearAutomationHandlers());

  it('dispatches a message to a registered handler', () => {
    const received: unknown[] = [];
    const transport = createSyncTransport(() => {}, async () => null);
    transport.onMessage('automation.sync', (p) => received.push(p));

    dispatchAutomationMessage('automation.sync', { automation: { id: 'x' } });

    expect(received).toHaveLength(1);
  });

  it('stops dispatching after unsubscribe', () => {
    const received: unknown[] = [];
    const transport = createSyncTransport(() => {}, async () => null);
    const unsub = transport.onMessage('automation.sync', (p) => received.push(p));

    unsub();
    dispatchAutomationMessage('automation.sync', {});

    expect(received).toHaveLength(0);
  });

  it('clearAutomationHandlers drops registrations left by a previous session', () => {
    const received: unknown[] = [];
    const transport = createSyncTransport(() => {}, async () => null);
    transport.onMessage('automation.sync', (p) => received.push(p));

    clearAutomationHandlers();
    dispatchAutomationMessage('automation.sync', {});

    expect(received).toHaveLength(0);
  });

  it('survives a handler that throws', () => {
    const transport = createSyncTransport(() => {}, async () => null);
    transport.onMessage('automation.sync', () => { throw new Error('boom'); });

    expect(() => dispatchAutomationMessage('automation.sync', {})).not.toThrow();
  });

  it('forwards outbound messages to the send function', () => {
    const sent: Array<{ type: string; payload: unknown }> = [];
    const transport = createSyncTransport((type, payload) => sent.push({ type, payload }), async () => null);

    transport.sendMessage('automation.trace', { trace: { id: 't1' } });

    expect(sent).toEqual([{ type: 'automation.trace', payload: { trace: { id: 't1' } } }]);
  });
});
