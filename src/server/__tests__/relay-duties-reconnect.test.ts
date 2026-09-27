// @vitest-environment jsdom
//
// Relay duties across reconnects.
//
// Every socket close runs cleanup(), which drops isActiveRelay without stopping
// the duties; the next relay_status then ran startRelayDuties() over the top of
// the last run. Each reconnect left another HomeKitServiceGroupResolver polling
// HomeKit every 5 minutes, another 30s clock-drift interval and another
// visibilitychange listener. The managed relay reconnects ~9.5 times an hour,
// so a day's uptime carried ~228 of each. Baseline before the fix, 50
// reconnects: 50 resolvers, +100 intervals, +50 listeners.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../native/homekit-bridge', async (orig) => {
  const real = await orig<typeof import('../../native/homekit-bridge')>();
  // Every bridge call returns something usable both as an unsubscribe function
  // and as a promise, which is all the relay-duty paths ask of it.
  const call = () => {
    const f = (() => {}) as unknown as Record<string, unknown>;
    const p = Promise.resolve([]);
    f.then = p.then.bind(p); f.catch = p.catch.bind(p); f.finally = p.finally.bind(p);
    return f;
  };
  const HomeKit = new Proxy({}, { get: () => vi.fn(call) });
  return { ...real, HomeKit, isRelayCapable: () => true, isRelayEnabled: () => true };
});
vi.mock('../../automation', async (orig) => {
  const real = await orig<typeof import('../../automation')>();
  return { ...real, initAutomationEngine: vi.fn(async () => ({})), teardownAutomationEngine: vi.fn() };
});

import { HomeKitServiceGroupResolver } from '../../automation';
import ServerWebSocket from '../websocket';

type Internals = { handleMessage(e: { data: string }): void; cleanup(): void };

const restore: Array<() => void> = [];
afterEach(() => { while (restore.length) restore.pop()!(); });

function track() {
  const live = { resolvers: 0, intervals: new Set<unknown>(), wakeListeners: 0 };

  const { start, stop } = HomeKitServiceGroupResolver.prototype;
  HomeKitServiceGroupResolver.prototype.start = function (...a) { live.resolvers++; return start.apply(this, a); };
  HomeKitServiceGroupResolver.prototype.stop = function (...a) { live.resolvers--; return stop.apply(this, a); };
  restore.push(() => Object.assign(HomeKitServiceGroupResolver.prototype, { start, stop }));

  const { setInterval: si, clearInterval: ci } = globalThis;
  globalThis.setInterval = ((f: () => void, ms?: number) => { const id = si(f, ms); live.intervals.add(id); return id; }) as typeof setInterval;
  globalThis.clearInterval = ((id: unknown) => { live.intervals.delete(id); ci(id as never); }) as typeof clearInterval;
  restore.push(() => { globalThis.setInterval = si; globalThis.clearInterval = ci; });
  restore.push(() => live.intervals.forEach(id => ci(id as never)));

  const { addEventListener: add, removeEventListener: remove } = document;
  document.addEventListener = function (this: Document, type: string, ...rest: never[]) {
    if (type === 'visibilitychange') live.wakeListeners++;
    return add.call(this, type, ...rest);
  } as typeof document.addEventListener;
  document.removeEventListener = function (this: Document, type: string, ...rest: never[]) {
    if (type === 'visibilitychange') live.wakeListeners--;
    return remove.call(this, type, ...rest);
  } as typeof document.removeEventListener;
  restore.push(() => { document.addEventListener = add; document.removeEventListener = remove; });

  return live;
}

const ACTIVE = JSON.stringify({ type: 'relay_status', payload: { isActiveRelay: true } });

describe('relay duties across reconnects', () => {
  it('holds one set of duties however many times the socket reconnects', () => {
    const live = track();
    const ws = new ServerWebSocket({ token: 't', deviceId: 'mac_test', deviceName: 'test' }) as unknown as Internals;
    const baseIntervals = live.intervals.size;

    ws.handleMessage({ data: ACTIVE });
    const once = { resolvers: live.resolvers, intervals: live.intervals.size - baseIntervals, wake: live.wakeListeners };

    for (let i = 0; i < 50; i++) {
      ws.cleanup(); // what every socket close runs
      ws.handleMessage({ data: ACTIVE });
    }

    expect(once).toEqual({ resolvers: 1, intervals: 2, wake: 1 });
    expect(live.resolvers).toBe(1);
    expect(live.intervals.size - baseIntervals).toBe(2);
    expect(live.wakeListeners).toBe(1);
  });

  it('releases everything when the server moves duties elsewhere', () => {
    const live = track();
    const ws = new ServerWebSocket({ token: 't', deviceId: 'mac_test', deviceName: 'test' }) as unknown as Internals;
    const baseIntervals = live.intervals.size;

    ws.handleMessage({ data: ACTIVE });
    ws.handleMessage({ data: JSON.stringify({ type: 'relay_status', payload: { isActiveRelay: false } }) });

    expect(live.resolvers).toBe(0);
    expect(live.intervals.size - baseIntervals).toBe(0);
    expect(live.wakeListeners).toBe(0);
  });
});
