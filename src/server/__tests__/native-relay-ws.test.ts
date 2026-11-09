// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NativeRelayWebSocket } from '../native-relay-ws';

const postMessage = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  postMessage.mockReset();
  Object.assign(window, { homecastNativeRelayWsBackpressure: true, __relay_ws_sockets: {}, webkit: { messageHandlers: { relayWs: { postMessage } } } });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('native relay opening deadline', () => {
  it('clears the deadline after a successful open', async () => {
    const socket = new NativeRelayWebSocket('wss://example.test/ws');
    socket._onOpen();
    const closed = vi.fn(); socket.onclose = closed;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(socket.readyState).toBe(socket.OPEN);
    expect(closed).not.toHaveBeenCalled();
  });

  it('reports one terminal failure and drops late native events', async () => {
    const socket = new NativeRelayWebSocket('wss://example.test/ws');
    const closed = vi.fn(); const opened = vi.fn(); const message = vi.fn();
    socket.onclose = closed; socket.onopen = opened; socket.onmessage = message;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(closed.mock.calls[0][0]).toMatchObject({ code: 1006, reason: 'connect-timeout' });
    socket._onOpen(); socket._onMessage('{}'); socket._onClose(1006, '', false);
    expect(opened).not.toHaveBeenCalled();
    expect(message).not.toHaveBeenCalled();
    expect(closed).toHaveBeenCalledTimes(1);
    expect((window as any).__relay_ws_sockets).toEqual({});
  });

  it('settles even when posting to the native bridge throws', async () => {
    postMessage.mockImplementation(() => { throw new Error('bridge gone'); });
    const socket = new NativeRelayWebSocket('wss://example.test/ws');
    const closed = vi.fn(); socket.onclose = closed;
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(socket.readyState).toBe(socket.CLOSED);
    expect((window as any).__relay_ws_sockets).toEqual({});
  });

  it('can close when the native bridge disappears after construction', () => {
    const socket = new NativeRelayWebSocket('wss://example.test/ws');
    Object.assign(window, { webkit: undefined });
    expect(() => socket.close()).not.toThrow();
    expect(socket.readyState).toBe(socket.CLOSED);
    expect(vi.getTimerCount()).toBe(0);
  });
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
