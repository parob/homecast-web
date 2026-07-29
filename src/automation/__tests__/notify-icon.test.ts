// The icon rides to every channel inside the notify action's `data` bag rather
// than as a fourth argument, because `data` already reaches both onNotify
// implementations — the cloud WebSocket and the Swift bridge — untouched. That
// makes `data.icon` the actual wire contract, so these tests assert on what
// onNotify receives, not on what the action was configured with.

import { describe, it, expect, vi } from 'vitest';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { HomeKitBridge } from '../engine/ActionExecutor';
import type { Automation, NotifyAction } from '../types/automation';

function makeBridge(): HomeKitBridge {
  return {
    setCharacteristic: vi.fn().mockResolvedValue(undefined),
    setServiceGroup: vi.fn().mockResolvedValue(undefined),
    executeScene: vi.fn().mockResolvedValue(undefined),
  };
}

function automationWith(notify: Partial<NotifyAction>): Automation {
  return {
    id: 'auto-1',
    name: 'Notify',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [{
      type: 'state',
      id: 'trig-1',
      accessoryId: 'sensor-1',
      characteristicType: 'contact_state',
      to: 1,
    }],
    conditions: { operator: 'and', conditions: [] },
    actions: [{
      type: 'notify',
      id: 'notify-1',
      message: 'Front door opened',
      ...notify,
    } as NotifyAction],
    metadata: { createdAt: '2026-07-29T00:00:00.000Z', updatedAt: '2026-07-29T00:00:00.000Z', triggerCount: 0 },
  };
}

/** Fire the automation once and hand back the args onNotify was called with. */
async function runAndCaptureNotify(automation: Automation) {
  const onNotify = vi.fn().mockResolvedValue({ delivered: true, channels: ['push'] });
  // Not optional in practice: the engine calls it unconditionally at the end of
  // every run, so omitting it throws after the assertions have already passed.
  const engine = new AutomationEngine({ bridge: makeBridge(), onNotify, onTraceComplete: () => {} });

  let emit: ((e: any) => void) | undefined;
  engine.initialize((handler) => { emit = handler; return () => {}; });
  engine.loadAutomations([automation]);

  emit!({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'contact_state', value: 1 });

  for (let i = 0; i < 20 && onNotify.mock.calls.length === 0; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));

  expect(onNotify).toHaveBeenCalled();
  const [message, title, data] = onNotify.mock.calls[0];
  return { message, title, data: data as Record<string, unknown> | undefined };
}

/** Same run, but reporting the notify step's recorded output. */
async function runAndCaptureOutput(automation: Automation) {
  const traces: any[] = [];
  const onNotify = vi.fn().mockResolvedValue({ delivered: true, channels: ['push'] });
  const engine = new AutomationEngine({
    bridge: makeBridge(),
    onNotify,
    onTraceComplete: (t) => { traces.push(t); },
  });

  let emit: ((e: any) => void) | undefined;
  engine.initialize((handler) => { emit = handler; return () => {}; });
  engine.loadAutomations([automation]);

  emit!({ type: 'characteristic.updated', accessoryId: 'sensor-1', characteristicType: 'contact_state', value: 1 });

  for (let i = 0; i < 20 && traces.length === 0; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));

  const step = traces[0]?.steps?.find((s: any) => s.nodeType === 'notify');
  return { step, notifyData: onNotify.mock.calls[0]?.[2] as Record<string, unknown> | undefined };
}

describe('notify icon reaches the delivery layer', () => {
  it('sends a built-in slug as data.icon', async () => {
    const { data } = await runAndCaptureNotify(automationWith({ icon: 'door-open' }));
    expect(data?.icon).toBe('door-open');
  });

  it('sends nothing extra when no icon is set', async () => {
    const { data } = await runAndCaptureNotify(automationWith({}));
    expect(data).toBeUndefined();
  });

  it('resolves a template so the URL is concrete by the time it is sent', async () => {
    // The point of the URL form: a snapshot that only exists for this run.
    const automation = automationWith({ icon: 'https://cam.example.com/{{ trigger.to_value }}.jpg' });
    const { data } = await runAndCaptureNotify(automation);
    expect(data?.icon).toBe('https://cam.example.com/1.jpg');
  });

  it('keeps action buttons alongside the icon', async () => {
    const automation = automationWith({
      icon: 'alert',
      data: { actions: [{ action: 'ack', title: 'Acknowledge' }] },
    });
    const { data } = await runAndCaptureNotify(automation);

    expect(data?.icon).toBe('alert');
    expect(data?.actions).toEqual([{ action: 'ack', title: 'Acknowledge' }]);
  });

  it('refuses an icon URL pointing into the LAN or at the relay itself', async () => {
    // The relay fetches this URL to draw its own banner, and it can see
    // localhost and the LAN — the same exposure the HTTP Request node is
    // guarded against, so the icon goes through the same guard.
    for (const internal of [
      'https://127.0.0.1/x.png',
      'https://localhost/x.png',
      'https://192.168.1.1/x.png',
      'https://10.0.0.5/x.png',
      'https://169.254.169.254/latest/meta-data',
      'https://[::1]/x.png',
    ]) {
      const { data } = await runAndCaptureNotify(automationWith({ icon: internal }));
      expect(data?.icon, internal).toBeUndefined();
    }
  });

  it('refuses a plaintext http icon URL', async () => {
    const { data } = await runAndCaptureNotify(automationWith({ icon: 'http://example.com/x.png' }));
    expect(data?.icon).toBeUndefined();
  });

  it('still delivers the notification when the icon is refused', async () => {
    // An icon is decoration; a suppressed notification is a missed alert.
    const { message, data } = await runAndCaptureNotify(
      automationWith({ icon: 'https://192.168.1.1/x.png' }),
    );
    expect(message).toBe('Front door opened');
    expect(data?.icon).toBeUndefined();
  });

  it('records why an icon was refused rather than dropping it silently', async () => {
    const { step, notifyData } = await runAndCaptureOutput(
      automationWith({ icon: 'https://192.168.1.1/x.png' }),
    );

    expect(notifyData?.icon).toBeUndefined();
    expect(step?.output?.iconRejected).toMatch(/SSRF|private/i);
    // The action still succeeded — only its decoration was refused.
    expect(step?.output?.success).toBe(true);
    expect(step?.output?.delivered).toBe(true);
  });

  it('lets a public https icon URL through', async () => {
    const url = 'https://cam.example.com/snapshot.jpg';
    const { data } = await runAndCaptureNotify(automationWith({ icon: url }));
    expect(data?.icon).toBe(url);
  });

  it('does not put a built-in slug through URL checks', async () => {
    // A slug is a name. Nothing fetches it cross-network, and it contains no
    // scheme — running it through a URL guard would reject every one of them.
    const { data } = await runAndCaptureNotify(automationWith({ icon: 'leak' }));
    expect(data?.icon).toBe('leak');
  });

  it('does not mutate the action, so the next run sees the same config', async () => {
    const automation = automationWith({ icon: 'leak', data: { actions: [] } });
    const original = JSON.parse(JSON.stringify(automation.actions[0]));

    await runAndCaptureNotify(automation);

    expect(automation.actions[0]).toEqual(original);
  });
});
