// @vitest-environment jsdom
//
// parob/homecast-cloud#113. The socket's transitions shipped as
// `connection: reconnecting` / `prev=connected` and nothing else — the same
// eleven characters whether a pod redirected us, the token expired, or a proxy
// cut an idle socket. There was no way to tell a flaky connection from a busy
// one after the fact, which is the whole of what was asked for.
//
// The rendering is `lib/__tests__/connection-log.test.ts`. This is the half
// that has to come off the real socket: that every transition names a reason,
// and carries the evidence that only existed at that call site.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: { stopObserving: vi.fn(async () => {}), call: vi.fn(async () => ({})) },
  HomeKitEvent: {},
  isRelayCapable: () => false,
  isRelayEnabled: () => false,
  withCallReason: (_r: string, fn: () => unknown) => fn(),
}));
vi.mock('../native-relay-ws', () => ({
  NativeRelayWebSocket: class {},
  shouldUseNativeRelayWs: () => false,
}));

import { ServerWebSocket } from '../websocket';
import type { TransitionFacts } from '../../lib/connection-log';

type Opts = { silent?: boolean } & Omit<TransitionFacts, 'prev'>;

/** The bits of a WebSocket the class actually drives, and a handle on them. */
class FakeSocket {
  static last: FakeSocket | null = null;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  readyState = 1;
  sent: string[] = [];
  constructor(public url: string) { FakeSocket.last = this; }
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
}

let changes: Array<{ state: string; opts?: Opts }>;

function socket() {
  changes = [];
  return new ServerWebSocket(
    { token: 't', deviceId: 'd', deviceName: 'n', browserSessionId: 'b', wsUrl: 'wss://api.example/ws' },
    { onStateChange: (state, opts) => { changes.push({ state, opts: opts as Opts }); } },
  );
}

const reasons = () => changes.map(c => c.opts?.reason);
const lastOpts = () => changes[changes.length - 1].opts!;

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.last = null;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('every connection transition says why', () => {
  it('names the reason on connect, and on a manual stop', () => {
    const ws = socket();
    ws.connect();
    expect(reasons()).toEqual(['connect']);
    ws.disconnect();
    expect(reasons()).toEqual(['connect', 'manual']);
  });

  it('carries the close code, its cleanliness, and the backoff it is about to serve', () => {
    const ws = socket();
    ws.connect();
    FakeSocket.last!.onclose!({ code: 1006, reason: '', wasClean: false });

    const { reason, evidence } = lastOpts();
    expect(changes[changes.length - 1].state).toBe('reconnecting');
    expect(reason).toBe('close:1006');
    expect(evidence).toMatchObject({
      code: 1006,
      clean: false,
      // The ladder, as the log will show it climbing. A socket that drops once
      // an hour and one stuck at the backoff ceiling are otherwise identical.
      attempt: 1,
      // Sampled at the transition, not remembered: on iOS a suspended WebView
      // is the likeliest explanation for a socket that looks flaky.
      visibility: 'visible',
      online: true,
    });
    expect(typeof evidence!.delay_ms).toBe('number');
  });

  it('distinguishes the codes that mean something specific', () => {
    const ws = socket();
    ws.connect();
    FakeSocket.last!.onclose!({ code: 4002, reason: 'replaced', wasClean: true });
    expect(lastOpts().reason).toBe('replaced');

    const ws2 = socket();
    ws2.connect();
    FakeSocket.last!.onclose!({ code: 4003, reason: '', wasClean: true });
    expect(lastOpts().reason).toBe('session-expired');
  });

  it('reports how long the previous state lasted', () => {
    const ws = socket();
    ws.connect();
    vi.advanceTimersByTime(41_000);
    FakeSocket.last!.onclose!({ code: 1006, reason: '', wasClean: false });
    // Not exact — `stateSince` is wall-clock — but it must be the 41s stretch
    // and not zero, which is what reading it after the reassignment would give.
    expect(lastOpts().prevMs).toBeGreaterThanOrEqual(41_000);
  });

  it('marks a pod redirect as the handoff it is, with where it went', () => {
    const ws = socket();
    ws.connect();
    FakeSocket.last!.onopen!({});
    FakeSocket.last!.onmessage!({
      data: JSON.stringify({ type: 'redirect', target: 'wss://pod-7.example/ws', reason: 'home_affinity' }),
    });
    const redirect = changes.find(c => c.opts?.reason === 'pod-redirect');
    expect(redirect).toBeTruthy();
    expect(redirect!.state).toBe('reconnecting');
    expect(redirect!.opts!.evidence).toMatchObject({
      target: 'wss://pod-7.example/ws',
      // The server says why it is moving us; without it every redirect looks
      // alike in the log, and only some of them are worth caring about.
      server_reason: 'home_affinity',
    });
    // Still silent — the user is not told about a deliberate sub-second move.
    expect(redirect!.opts!.silent).toBe(true);
  });
});
