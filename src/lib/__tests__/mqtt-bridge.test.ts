// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getMQTTBrokers, isMQTTAvailable } from '../mqtt-bridge';

/**
 * The native side answers every `mqtt` call, including the ones it cannot
 * serve. Before that it simply dropped them, and the only thing the web app
 * knew 15 seconds later was that nothing had arrived — which the brokers pane
 * rendered as "No custom brokers configured".
 */

interface Posted { action: string; method: string; callbackId: string }

function installBridge(): Posted[] {
  const posted: Posted[] = [];
  (window as any).webkit = {
    messageHandlers: { homecast: { postMessage: (msg: Posted) => posted.push(msg) } },
  };
  return posted;
}

function reply(callbackId: string, payload: unknown) {
  (window as any).__mqtt_callback(callbackId, JSON.stringify(payload));
}

describe('mqtt bridge', () => {
  let posted: Posted[];
  beforeEach(() => { posted = installBridge(); });
  afterEach(() => { delete (window as any).webkit; });

  it('is unavailable without the native handler', () => {
    expect(isMQTTAvailable()).toBe(true);
    delete (window as any).webkit;
    expect(isMQTTAvailable()).toBe(false);
  });

  it('rejects without the native handler rather than hanging', async () => {
    delete (window as any).webkit;
    await expect(getMQTTBrokers()).rejects.toThrow(/not available/);
  });

  it('resolves the broker map', async () => {
    const promise = getMQTTBrokers();
    const brokers = { 'HOME-1': [{ id: 'b1', name: 'Mosquitto' }] };
    reply(posted[0].callbackId, brokers);
    await expect(promise).resolves.toEqual(brokers);
  });

  it('rejects with the reason the native side reports', async () => {
    const promise = getMQTTBrokers();
    reply(posted[0].callbackId, { __mqttError: 'This Mac is in Cloud mode — MQTT brokers are stored in your account, not on the Mac' });
    await expect(promise).rejects.toThrow('This Mac is in Cloud mode — MQTT brokers are stored in your account, not on the Mac');
  });

  it('does not mistake a home called __mqttError for a failure', async () => {
    const promise = getMQTTBrokers();
    reply(posted[0].callbackId, { __mqttError: { nested: true } });
    await expect(promise).resolves.toEqual({ __mqttError: { nested: true } });
  });
});
