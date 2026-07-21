// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSharedWebSocket } from '../useSharedWebSocket';

vi.mock('@/lib/config', () => ({
  config: { isCommunity: false, wsUrl: 'wss://api.test/ws' },
}));

vi.mock('@/server/connection', () => ({
  getBrowserSessionId: () => 'sess_test-tab',
}));

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  sent: string[] = [];
  closeCalls: Array<[number?, string?]> = [];

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code?: number, reason?: string) {
    this.closeCalls.push([code, reason]);
    this.readyState = MockWebSocket.CLOSED;
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateServerClose(code: number) {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason: '' });
  }
}

let visibilityState: DocumentVisibilityState = 'visible';

function setVisibility(state: DocumentVisibilityState) {
  visibilityState = state;
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

describe('useSharedWebSocket', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    vi.stubGlobal('WebSocket', MockWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function mountHook(shareHash = 'abc123', passcode?: string | null) {
    return renderHook(
      ({ hash, code }: { hash: string; code?: string | null }) => useSharedWebSocket(hash, code),
      { initialProps: { hash: shareHash, code: passcode } }
    );
  }

  it('opens one socket and subscribes with browserSessionId', () => {
    mountHook();
    expect(MockWebSocket.instances).toHaveLength(1);

    const ws = MockWebSocket.instances[0];
    expect(ws.url).toBe('wss://api.test/ws/shared');
    act(() => ws.simulateOpen());

    expect(ws.sent).toHaveLength(1);
    expect(JSON.parse(ws.sent[0])).toEqual({
      type: 'subscribe',
      shareHash: 'abc123',
      browserSessionId: 'sess_test-tab',
    });
  });

  it('does not reconnect after unmount', () => {
    const { unmount } = mountHook();
    const ws = MockWebSocket.instances[0];
    act(() => ws.simulateOpen());

    unmount();
    expect(ws.closeCalls).toHaveLength(1);
    // Handlers are detached so the trailing browser onclose is a no-op
    expect(ws.onclose).toBeNull();

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it('reconnects after an unexpected close but not after 4001/4002/4003', () => {
    mountHook();
    const ws1 = MockWebSocket.instances[0];
    act(() => ws1.simulateOpen());

    // Abnormal close → reconnect after 3s
    act(() => ws1.simulateServerClose(1006));
    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);

    // Replaced by a newer connection → no reconnect
    const ws2 = MockWebSocket.instances[1];
    act(() => ws2.simulateOpen());
    act(() => ws2.simulateServerClose(4002));
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('holds a single live socket across tab hide/show and keeps the new socket pinging', () => {
    mountHook();
    const ws1 = MockWebSocket.instances[0];
    act(() => ws1.simulateOpen());

    setVisibility('hidden');
    expect(ws1.closeCalls).toHaveLength(1);
    expect(ws1.onclose).toBeNull();

    setVisibility('visible');
    expect(MockWebSocket.instances).toHaveLength(2);
    const ws2 = MockWebSocket.instances[1];
    act(() => ws2.simulateOpen());

    // The old socket's leaked interval must not ping, and the stale socket's
    // close must not clear the new socket's ping interval
    const ws1SentBefore = ws1.sent.length;
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(ws1.sent.length).toBe(ws1SentBefore);
    expect(ws2.sent.filter((m) => JSON.parse(m).type === 'ping')).toHaveLength(1);

    // No extra sockets appear later
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('ignores a redundant visible event while already connected', () => {
    mountHook();
    const ws1 = MockWebSocket.instances[0];
    act(() => ws1.simulateOpen());

    setVisibility('visible');
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(ws1.closeCalls).toHaveLength(0);
  });
});
