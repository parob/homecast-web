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

  it('still surfaces a thrown notify as an error, without halting the run', async () => {
    // Deliberate: the notification is handed off and the actions after it run,
    // so a transport failure can no longer stop the automation. The devices
    // matter more than the message about them — but the trace still says so.
    const step = await runAndGetNotifyStep(async () => { throw new Error('transport down'); });

    expect(step.result).toBe('error');
    expect(step.error).toContain('transport down');
  });

  it('runs the actions after a failing notify', async () => {
    const bridge = makeBridge();
    const traces: ExecutionTrace[] = [];
    const engine = new AutomationEngine({
      bridge,
      onNotify: async () => { throw new Error('transport down'); },
      onTraceComplete: (t) => { traces.push(t); },
    });

    let emit: ((e: any) => void) | undefined;
    engine.initialize((h) => { emit = h; return () => {}; });
    engine.loadAutomations([{
      ...AUTOMATION,
      actions: [
        { type: 'notify', id: 'notify-1', message: 'Lights on' },
        { type: 'set_characteristic', id: 'set-1', accessoryId: 'bulb-2', characteristicType: 'power_state', value: 1 },
      ],
    }]);
    emit!({ type: 'characteristic.updated', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 });
    for (let i = 0; i < 30 && traces.length === 0; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    engine.teardown();

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('bulb-2', 'power_state', 1);
  });
});

// Honest reporting must not cost latency.
//
// Awaiting the server's delivery report inline put a network round trip between
// the notify action and whatever followed it. Measured in production: the
// device write took 287ms, the notify blocked for 1233ms, and an automation
// that notified and *then* turned a light on took over a second to turn the
// light on — up to the 8s report timeout if the server never answered.
describe('a notify does not hold up the actions after it', () => {
  it('runs the next action without waiting for the delivery report', async () => {
    const bridge = makeBridge();
    let releaseReport: (d: NotifyDelivery) => void = () => {};
    const reportArrived = new Promise<NotifyDelivery>((r) => { releaseReport = r; });

    const traces: ExecutionTrace[] = [];
    const engine = new AutomationEngine({
      bridge,
      onNotify: () => reportArrived,
      onTraceComplete: (t) => { traces.push(t); },
    });

    let emit: ((e: any) => void) | undefined;
    engine.initialize((h) => { emit = h; return () => {}; });
    engine.loadAutomations([{
      ...AUTOMATION,
      actions: [
        { type: 'notify', id: 'notify-1', message: 'Lights on' },
        { type: 'set_characteristic', id: 'set-1', accessoryId: 'bulb-2', characteristicType: 'power_state', value: 1 },
      ],
    }]);
    emit!({ type: 'characteristic.updated', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 });

    // The report has NOT arrived, yet the light is already switched.
    for (let i = 0; i < 30; i++) await Promise.resolve();
    expect(bridge.setCharacteristic).toHaveBeenCalledWith('bulb-2', 'power_state', 1);
    expect(traces).toHaveLength(0);

    // ...and once it does arrive, the trace still records the truth.
    releaseReport({ delivered: true, channels: ['push'] });
    for (let i = 0; i < 30 && traces.length === 0; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    engine.teardown();

    const step = traces[0].steps.find((s: any) => s.nodeType === 'notify') as any;
    expect(step.output.delivered).toBe(true);
    expect(step.output.channels).toEqual(['push']);
  });

  it('does not wait forever for a report that never comes', async () => {
    vi.useFakeTimers();
    const traces: ExecutionTrace[] = [];
    const engine = new AutomationEngine({
      bridge: makeBridge(),
      onNotify: () => new Promise<never>(() => {}), // never resolves
      onTraceComplete: (t) => { traces.push(t); },
    });

    let emit: ((e: any) => void) | undefined;
    engine.initialize((h) => { emit = h; return () => {}; });
    engine.loadAutomations([AUTOMATION]);
    emit!({ type: 'characteristic.updated', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 });

    await vi.advanceTimersByTimeAsync(10_000);
    engine.teardown();
    vi.useRealTimers();

    expect(traces).toHaveLength(1);
    const step = traces[0].steps.find((s: any) => s.nodeType === 'notify') as any;
    // Recorded as unknown, never as sent.
    expect(step.output.delivered).toBe(false);
    expect(step.output.reason).toBe('unknown');
  });
});

describe('a run is timed by its work, not by the reporting that follows it', () => {
  it('does not charge the automation for the delivery-report wait', async () => {
    // Measured in production: 273ms of actions reported as 1407ms, because the
    // finish time was stamped after settling the late delivery report. Duration
    // is how people judge whether automations are fast, so it must measure the
    // work.
    let releaseReport: () => void = () => {};
    const report = new Promise<NotifyDelivery>((r) => {
      releaseReport = () => r({ delivered: true, channels: ['push'] });
    });

    const traces: ExecutionTrace[] = [];
    const engine = new AutomationEngine({
      bridge: makeBridge(),
      onNotify: () => report,
      onTraceComplete: (t) => { traces.push(t); },
    });

    let emit: ((e: any) => void) | undefined;
    engine.initialize((h) => { emit = h; return () => {}; });
    engine.loadAutomations([AUTOMATION]);
    emit!({ type: 'characteristic.updated', accessoryId: 'bulb-1', characteristicType: 'power_state', value: 1 });

    // Let the actions finish, then hold the report back a while.
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 120));
    releaseReport();
    for (let i = 0; i < 30 && traces.length === 0; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    engine.teardown();

    const { startedAt, finishedAt } = traces[0];
    const duration = new Date(finishedAt!).getTime() - new Date(startedAt).getTime();
    expect(duration).toBeLessThan(100);
  });
});

describe('the delivery report replaces the placeholder completely', () => {
  // The pending placeholder carries reason:'unknown'. When the real report
  // arrived it overwrote `delivered` and `channels` but left `reason` behind,
  // producing "delivered: true, reason: unknown" — a contradiction, in the one
  // record built specifically to be trusted about delivery.
  it('clears the placeholder reason on a clean delivery', async () => {
    const step = await runAndGetNotifyStep(async () => ({
      delivered: true, channels: ['push'],
    }));
    expect(step.output.delivered).toBe(true);
    expect(step.output.channels).toEqual(['push']);
    expect(step.output.reason).toBeUndefined();
  });

  it('still reports a reason when the deliverer gives one', async () => {
    const step = await runAndGetNotifyStep(async () => ({
      delivered: false, channels: [], rateLimited: true, reason: 'rate_limited' as const,
    }));
    expect(step.output.reason).toBe('rate_limited');
    expect(step.output.rateLimited).toBe(true);
  });
});
