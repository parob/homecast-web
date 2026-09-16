// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../native/homekit-bridge', () => ({
  HomeKit: { stopObserving: vi.fn(async () => {}), call: vi.fn(async () => ({})) },
  HomeKitEvent: {}, isRelayCapable: () => false, isRelayEnabled: () => false,
  withCallReason: (_r: string, fn: () => unknown) => fn(),
}));
vi.mock('../native-relay-ws', () => ({
  NativeRelayWebSocket: class {}, shouldUseNativeRelayWs: () => false,
}));

import { ServerWebSocket } from '../websocket';
import { beginHomesList, effectiveServing, ingestHomesList, ingestHomeServingPush, resetHomeServing } from '../home-serving';
import { statusPresentation, type StatusInputs } from '@/lib/status-badge';
import { buildAnswerCard } from '@/lib/answer-card';

class FakeSocket {
  static OPEN = 1;
  static last: FakeSocket;
  onopen: ((e: unknown) => void) | null = null;
  onmessage: ((e: unknown) => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onclose: ((e: unknown) => void) | null = null;
  readyState = 1;
  sent: Array<{ id: string; type: string; action: string }> = [];
  constructor(public url: string) { FakeSocket.last = this; }
  send(data: string) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; }
  receive(message: unknown) { this.onmessage?.({ data: JSON.stringify(message) }); }
}

const cloud = { state: 'served', by: 'mini', kind: 'cloud', since: '2026-09-16T10:00:00Z', graceEndsAt: null } as const;
let ws: ServerWebSocket;
let wire: FakeSocket;
const inputs = (homeId = 'home-a', over: Partial<StatusInputs> = {}): StatusInputs => ({
  quality: ws.getConnectionQuality(), serving: effectiveServing(homeId), relayServing: effectiveServing(homeId),
  thisDevice: 'laptop', managed: true, community: false, reconnected: false,
  unmapped: false, localReason: null, relayEnabled: false, ...over,
});
const card = (over: Partial<StatusInputs> = {}) => buildAnswerCard({
  ...inputs('home-a', over), homeName: 'Home A', deviceNoun: 'Mac', rtt: '40ms',
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-16T10:01:00Z'));
  vi.stubGlobal('WebSocket', FakeSocket);
  resetHomeServing();
  ingestHomesList(['home-a', 'home-b', 'home-c'].map(id => ({ id, serving: cloud })));
  ws = new ServerWebSocket(
    { token: 'test', deviceId: 'laptop', deviceName: 'Test Mac', browserSessionId: 'test', wsUrl: 'wss://example.test/ws' },
    { onBroadcast: m => { if (m.type === 'home_serving') ingestHomeServingPush(m); } },
  );
  ws.connect();
  wire = FakeSocket.last;
  wire.onopen?.({});
  wire.receive({ type: 'connected' });
  vi.advanceTimersByTime(40);
  wire.receive({ type: 'pong' });
  vi.advanceTimersByTime(1000);
  expect(ws.getConnectionQuality()).toBe('good');
});
afterEach(() => {
  ws.disconnect();
  resetHomeServing();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(action: string, homeId?: string) {
  const result = ws.request(action, homeId ? { homeId } : {}).catch(error => error);
  const message = wire.sent.filter(m => m.type === 'request').at(-1)!;
  return { result, reply: (code?: string) => wire.receive({
    ...message, type: 'response', ...(code ? { error: { code, message: code } } : { payload: {} }),
  }) };
}

describe('actual request accounting → home status', () => {
  it('keeps the backup status while a camera takes 20 seconds and ordinary requests answer', async () => {
    wire.receive({ type: 'home_serving', homeId: 'home-a', serving: { ...cloud, by: 'laptop', kind: 'self_hosted' } });
    const camera = request('camera.snapshot', 'home-a');
    for (let second = 1; second <= 20; second++) {
      vi.advanceTimersByTime(1000);
      const normal = request('accessories.list', 'home-b');
      normal.reply();
      await normal.result;
      expect({ second, quality: ws.getConnectionQuality(), label: statusPresentation(inputs()).label })
        .toEqual({ second, quality: 'good', label: 'Standing in' });
    }
    camera.reply();
    await camera.result;
  });

  it.each(['SCREEN_RECORDING_DENIED', 'CAMERAS_DISABLED', 'UNKNOWN_ACTION', 'UNKNOWN_METHOD', 'SNAPSHOT_TIMEOUT', 'NO_DEVICE', 'HOMEKIT_ERROR'])
    ('keeps %s on the request rather than declaring a connection outage', async code => {
      for (let n = 0; n < 2; n++) {
        const req = request('camera.snapshot', 'home-a');
        req.reply(code);
        expect(await req.result).toMatchObject({ code });
      }
      expect(ws.getConnectionQuality()).toBe('good');
      expect(card().verdict).toBe('Home A is working');
    });

  it('does not make a slow device in one home change another home’s status', async () => {
    const slow = request('characteristic.get', 'home-b');
    vi.advanceTimersByTime(9000);
    expect(ws.getConnectionQuality()).toBe('good');
    expect(card().verdict).toBe('Home A is working');
    slow.reply();
    await slow.result;
  });

  it('still detects a silent connection during camera work', async () => {
    vi.advanceTimersByTime(29_000);
    const camera = request('camera.snapshot', 'home-a');
    // The next ping goes unanswered. A camera must not hide that evidence.
    vi.advanceTimersByTime(8_500);
    expect(ws.getConnectionQuality()).toBe('stalled');
    camera.reply();
    await camera.result;
  });

  it('does not turn a recovered connection into a green home while a backup still serves it', () => {
    ingestHomeServingPush({ homeId: 'home-a', serving: { ...cloud, kind: 'self_hosted', by: 'laptop' } });
    expect(statusPresentation(inputs('home-a', { reconnected: true })).label).toBe('Standing in');
  });

  it('recognises the backup from another device too', () => {
    ingestHomeServingPush({ homeId: 'home-a', serving: { ...cloud, kind: 'self_hosted', by: 'other-mac' } });
    expect(statusPresentation(inputs()).label).toBe('Standing in');
    expect(card().because).toContain('backup');
  });

  it('does not diagnose a failed relay or promise an alert from stalled transport evidence', () => {
    const answer = card({ quality: 'stalled' });
    expect(answer.because).not.toMatch(/relay.*(?:isn't answering|no answer)|internet.*fine/);
    expect(answer.note).toBeNull();
    expect(answer.chain.nodes.find(n => n.key === 'relay')?.tone).not.toBe('bad');
  });

  it('does not let an older list replace a newer push', () => {
    const startedAt = beginHomesList();
    wire.receive({ type: 'home_serving', homeId: 'HOME-A', serving: {
      ...cloud, state: 'waiting', by: null, kind: null, since: '2026-09-16T10:01:00Z', graceEndsAt: '2026-09-16T10:06:00Z',
    } });
    ingestHomesList([{ id: 'home-a', serving: cloud }], { startedAt });
    expect(effectiveServing('home-a')?.state).toBe('waiting');
    expect(statusPresentation(inputs()).label).toBe('Waiting for backup');
    expect(effectiveServing('home-b')).toEqual(cloud);
  });
});

it('does not mistake outgoing requests for proof that the cloud is still answering', async () => {
  const pending: Promise<unknown>[] = [];
  const original = wire;
  for (let n = 0; n < 8; n++) {
    pending.push(request('camera.snapshot', 'home-a').result);
    vi.advanceTimersByTime(5000);
  }
  // No inbound frames since the initial pong. A request timeout must rebuild
  // this socket even though the user kept making requests while it was dead.
  expect(FakeSocket.last).not.toBe(original);
  ws.disconnect();
  await Promise.all(pending);
});

it('does not carry background-reconnect timing into foreground connection health', () => {
  ws.disconnect();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  ws.connect();
  wire = FakeSocket.last;
  wire.onopen?.({});
  wire.receive({ type: 'connected' });
  vi.advanceTimersByTime(29_000);
  wire.receive({ type: 'pong' });
  expect(ws.getLastRttMs()).toBeNull();
  visibility.mockReturnValue('visible');
  document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(40);
  wire.receive({ type: 'pong' });
  vi.advanceTimersByTime(4_000);
  expect(ws.getLastRttMs()).toBe(40);
  expect(ws.getConnectionQuality()).toBe('good');
});
