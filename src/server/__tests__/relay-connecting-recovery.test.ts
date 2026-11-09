// @vitest-environment jsdom
// Regression for Nov 9: the native transport accepts connect but never reports
// open/error/close. Exercise the real adapter and ServerWebSocket retry loop.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../native/homekit-bridge', async (orig) => {
  const real = await orig<typeof import('../../native/homekit-bridge')>();
  return { ...real, HomeKit: { ...real.HomeKit, stopObserving: vi.fn(async () => {}) },
    isRelayCapable: () => true, isRelayEnabled: () => true };
});

import ServerWebSocket from '../websocket';
import { NativeRelayWebSocket } from '../native-relay-ws';

const postMessage = vi.fn();
let connection: ServerWebSocket;
function nativeSocket(): NativeRelayWebSocket {
  return Object.values((window as unknown as {
    __relay_ws_sockets: Record<string, NativeRelayWebSocket>;
  }).__relay_ws_sockets).at(-1)!;
}
function attempts(): number {
  return postMessage.mock.calls.filter(([m]) => m.action === 'connect').length;
}

beforeEach(() => {
  vi.useFakeTimers();
  postMessage.mockReset();
  localStorage.clear();
  Object.assign(window, {
    homecastNativeRelayWs: true,
    __relay_ws_sockets: {},
    webkit: { messageHandlers: { relayWs: { postMessage } } },
  });
  connection = new ServerWebSocket({
    token: 'test-only', deviceId: 'mac_investigation', deviceName: 'test',
    wsUrl: 'wss://example.invalid/ws',
  });
});
afterEach(() => { connection.disconnect(); vi.useRealTimers(); });

describe('native connection opening recovery', () => {
  it('abandons a silent handshake at 30 seconds and retries', async () => {
    connection.connect();
    expect(attempts()).toBe(1);
    const abandoned = nativeSocket();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(attempts()).toBe(1);
    await vi.advanceTimersByTimeAsync(2_001);
    expect(attempts()).toBe(2);
    expect(abandoned.readyState).toBe(NativeRelayWebSocket.CLOSED);
    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      action: 'close', reason: 'connect-timeout',
    }));
    const replacement = nativeSocket();
    abandoned._onOpen();
    abandoned._onClose(1006, 'late callback', false);
    expect(abandoned.readyState).toBe(NativeRelayWebSocket.CLOSED);
    expect(nativeSocket()).toBe(replacement);
    expect(attempts()).toBe(2);
  });

  it('does retry when the native layer explicitly reports failure', async () => {
    connection.connect();
    nativeSocket()._onError('controlled timeout');
    nativeSocket()._onClose(1006, 'controlled timeout', false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(attempts()).toBe(2);
    // An unanswered retry is bounded as well as the initial attempt.
    await vi.advanceTimersByTimeAsync(32_000);
    expect(attempts()).toBe(3);
    expect(nativeSocket().readyState).toBe(NativeRelayWebSocket.CONNECTING);
  });

  it('does not restart after a manual disconnect during the handshake', async () => {
    connection.connect();
    connection.disconnect();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts()).toBe(1);
    expect(nativeSocket()).toBeUndefined();
  });
});
