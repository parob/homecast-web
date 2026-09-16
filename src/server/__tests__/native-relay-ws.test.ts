// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeRelayWebSocket } from '../native-relay-ws';

const postMessage = vi.fn();
beforeEach(() => {
  postMessage.mockReset();
  Object.assign(window, { homecastNativeRelayWsBackpressure: true, __relay_ws_sockets: {}, webkit: { messageHandlers: { relayWs: { postMessage } } } });
});

describe('native relay socket backpressure', () => {
  it('tracks outstanding UTF-8 bytes until native acknowledges each send', () => {
    const socket = new NativeRelayWebSocket('wss://example.test/ws');
    socket._onOpen(); socket.send('abc'); socket.send('é');
    expect(socket.bufferedAmount).toBe(5);
    socket._onSent(3); expect(socket.bufferedAmount).toBe(2);
    socket._onSent(2); expect(socket.bufferedAmount).toBe(0);
    socket._onSent(999); expect(socket.bufferedAmount).toBe(0);
  });

  it('does not accumulate phantom bytes on old shells without send acknowledgments', () => {
    Object.assign(window, { homecastNativeRelayWsBackpressure: undefined });
    const socket = new NativeRelayWebSocket('wss://example.test/ws'); socket._onOpen(); socket.send('abc');
    expect(socket.bufferedAmount).toBe(0);
  });

  it('clears outstanding bytes on close', () => {
    const socket = new NativeRelayWebSocket('wss://example.test/ws'); socket._onOpen(); socket.send('abc');
    socket._onClose(1000, undefined, true);
    expect(socket.bufferedAmount).toBe(0);
  });
});
