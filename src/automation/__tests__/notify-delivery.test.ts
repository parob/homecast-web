// The notify step used to record `success: true` the instant the message left
// the relay. On a cloud relay the server decides afterwards whether anything is
// actually sent — a per-automation rate limit, a channel preference or simply
// no registered device can all mean nothing arrives. So an automation whose
// every push was being dropped looked, in the execution history, exactly like
// one working perfectly. These tests pin the distinction.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitBridge } from '../engine/ActionExecutor';
import type { Automation } from '../types/automation';
import type { ExecutionTrace } from '../types/execution';
import type { NotifyDelivery } from '../types/notify';

function makeBridge(): HomeKitBridge {
  return {
    setCharacteristic: vi.fn().mockResolvedValue(undefined),
    setServiceGroup: vi.fn().mockResolvedValue(undefined),
    executeScene: vi.fn().mockResolvedValue(undefined),
  };
}

const AUTOMATION: Automation = {
  id: 'auto-1',
  name: 'Notify on light',
  enabled: true,
  mode: 'single',
  triggers: [{
    type: 'state',
    id: 'trig-1',
    accessoryId: 'bulb-1',
    characteristicType: 'power_state',
    to: 1,
  }],
  conditions: { operator: 'and', conditions: [] },
  actions: [{ type: 'notify', id: 'notify-1', message: 'Light on', title: 'Hello' }],
  metadata: { createdAt: '2026-07-28T00:00:00.000Z', updatedAt: '2026-07-28T00:00:00.000Z', triggerCount: 0 },
};

/** Run the automation once and return the notify step from its trace. */
async function runAndGetNotifyStep(
  onNotify: (m: string, t?: string, d?: Record<string, unknown>, a?: string) => Promise<NotifyDelivery | void>,
): Promise<any> {
  const traces: ExecutionTrace[] = [];
  const engine = new AutomationEngine({
    bridge: makeBridge(),
    onNotify,
    onTraceComplete: (t) => { traces.push(t); },
  });

  let emit: ((e: any) => void) | undefined;
  engine.initialize((handler) => { emit = handler; return () => {}; });
  engine.loadAutomations([AUTOMATION]);

  emit!({ type: 'characteristic.updated', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 });

  // Let the execution and its trace settle.
  for (let i = 0; i < 20 && traces.length === 0; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));

  engine.teardown();
  expect(traces).toHaveLength(1);
  return traces[0].steps.find((s: any) => s.nodeType === 'notify');
}

describe('notify delivery reporting', () => {
  beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => {}); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('records what was actually delivered', async () => {
    const step = await runAndGetNotifyStep(async () => ({ delivered: true, channels: ['push'] }));

    expect(step.result).toBe('executed');
    expect(step.output.delivered).toBe(true);
    expect(step.output.channels).toEqual(['push']);
    expect(step.output.rateLimited).toBeUndefined();
  });

  it('records a rate-limited push as not delivered, without failing the step', async () => {
    const step = await runAndGetNotifyStep(async () => ({
      delivered: false, channels: [], rateLimited: true, reason: 'rate_limited' as const,
    }));

    // The action ran and did not error — the automation should carry on.
    expect(step.result).toBe('executed');
    expect(step.output.success).toBe(true);
    // ...but the notification plainly did not arrive, and the trace says so.
    expect(step.output.delivered).toBe(false);
    expect(step.output.rateLimited).toBe(true);
    expect(step.output.reason).toBe('rate_limited');
  });

  it('records "unknown" when the deliverer never reports back', async () => {
    // The old behaviour: fire-and-forget, resolving with nothing. This must not
    // be read as success.
    const step = await runAndGetNotifyStep(async () => undefined);

    expect(step.output.delivered).toBe(false);
    expect(step.output.reason).toBe('unknown');
  });

  it('still surfaces a thrown notify as an error', async () => {
    const step = await runAndGetNotifyStep(async () => { throw new Error('transport down'); });

    expect(step.result).toBe('error');
    expect(step.output).toBeUndefined();
  });
});
