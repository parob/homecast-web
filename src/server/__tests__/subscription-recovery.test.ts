// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/config', () => ({ isCommunity: false, config: { wsUrl: 'wss://example.test/ws' } }));
vi.mock('../../hooks/useHomeKitData', () => ({
  invalidateHomeKitCache: vi.fn(), revalidateHomeKitCache: vi.fn(),
}));
vi.mock('../../native/homekit-bridge', () => ({ isRelayCapable: () => false, isRelayEnabled: () => false }));
vi.mock('../../lib/request-log', () => ({ beginRequest: () => ({ ok: vi.fn(), fail: vi.fn() }), logEvent: vi.fn() }));
vi.mock('../../lib/browser-logger', () => ({ browserLogger: {} }));
const socketCallbacks = vi.hoisted(() => ({
  current: null as ConstructorParameters<typeof import('../websocket').ServerWebSocket>[1] | null,
}));
vi.mock('../websocket', () => ({ ServerWebSocket: class {
  constructor(_config: unknown, callbacks: NonNullable<typeof socketCallbacks.current>) {
    socketCallbacks.current = callbacks;
  }
  connect = vi.fn();
  disconnect = vi.fn();
  subscribe = (...args: unknown[]) => subscribe(...args);
  unsubscribe = (...args: unknown[]) => unsubscribe(...args);
} }));

const home = { type: 'home' as const, id: 'home-a' };
let connection: typeof import('../connection').serverConnection;
let subscribe: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  ({ serverConnection: connection } = await import('../connection'));
  subscribe = vi.fn(async () => ({ subscriptions: [{ ...home, expiresAt: Date.now() + 300_000 }] }));
  unsubscribe = vi.fn(async () => ({}));
  Object.assign(connection, {
    websocket: { subscribe, unsubscribe, disconnect: vi.fn() },
    state: { isActive: true, connectionState: 'connected', quality: 'good' },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  localStorage.clear();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function activateSocket() {
  Object.assign(connection, { state: { ...connection.getState(), isActive: false } });
  localStorage.setItem('homecast-token', 'test-token');
  await connection.activate();
  socketCallbacks.current!.onStateChange!('connected');
  return socketCallbacks.current!;
}

describe('subscription recovery without a page reload', () => {
  it('retries an initial subscription failure while the socket remains healthy', async () => {
    subscribe.mockRejectedValueOnce(new Error('temporary server failure'));
    await connection.subscribeToScopes([home]);
    expect(connection.getEarliestSubscriptionExpiry()).toBeNull();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(connection.getEarliestSubscriptionExpiry()).toBeGreaterThan(Date.now());
  });

  it('does not restore a departed view when its earlier subscription reply arrives late', async () => {
    let resolve!: (value: unknown) => void;
    subscribe.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = connection.subscribeToScopes([home]);
    await connection.unsubscribeFromScopes([home]);
    resolve({ subscriptions: [{ ...home, expiresAt: Date.now() + 300_000 }] });
    await pending;

    expect(connection.getEarliestSubscriptionExpiry()).toBeNull();
    await vi.advanceTimersByTimeAsync(300_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent requests for the same scope', async () => {
    let resolve!: (value: unknown) => void;
    subscribe.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const pending = connection.subscribeToScopes([home]);
    await connection.subscribeToScopes([home]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
    resolve({ subscriptions: [{ ...home, expiresAt: Date.now() + 300_000 }] });
    await pending;
    expect(connection.getEarliestSubscriptionExpiry()).toBeGreaterThan(Date.now());
  });

  it('stops renewing a departed scope even when unsubscribe fails', async () => {
    await connection.subscribeToScopes([home]);
    unsubscribe.mockRejectedValueOnce(new Error('connection dropped'));
    await connection.unsubscribeFromScopes([home]);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(connection.getEarliestSubscriptionExpiry()).toBeNull();
  });

  it('retries an omitted acknowledgement without renewing healthy leases early', async () => {
    subscribe.mockResolvedValueOnce({ subscriptions: [] });
    await connection.subscribeToScopes([home]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscribe).toHaveBeenCalledTimes(3);
  });

  it('does not let an earlier visit overwrite the renewed lease of a later visit', async () => {
    let resolve!: (value: unknown) => void;
    subscribe.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const earlier = connection.subscribeToScopes([home]);
    await connection.unsubscribeFromScopes([home]);
    await connection.subscribeToScopes([home]);
    const renewed = connection.getEarliestSubscriptionExpiry();
    resolve({ subscriptions: [{ ...home, expiresAt: Date.now() + 20_000 }] });
    await earlier;
    expect(connection.getEarliestSubscriptionExpiry()).toBe(renewed);
  });

  it('ignores responses from a deactivated connection', async () => {
    let resolve!: (value: unknown) => void;
    subscribe.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const earlier = connection.subscribeToScopes([home]);
    connection.deactivate();
    resolve({ subscriptions: [{ ...home, expiresAt: Date.now() + 300_000 }] });
    await earlier;
    await vi.advanceTimersByTimeAsync(300_000);
    expect(connection.getEarliestSubscriptionExpiry()).toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });

  it('matches UUID acknowledgements and unsubscribe requests regardless of case', async () => {
    await connection.subscribeToScopes([{ ...home, id: home.id.toUpperCase() }]);
    expect(connection.getEarliestSubscriptionExpiry()).toBeGreaterThan(Date.now());
    await connection.subscribeToScopes([home]);
    expect(subscribe).toHaveBeenCalledTimes(1);
    await connection.unsubscribeFromScopes([home]);
    expect(connection.getEarliestSubscriptionExpiry()).toBeNull();
  });

  it('retries desired scopes on reconnect and ignores the previous connection acknowledgement', async () => {
    const callbacks = await activateSocket();
    let resolve!: (value: unknown) => void;
    subscribe.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const earlier = connection.subscribeToScopes([home]);
    callbacks.onStateChange!('reconnecting');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscribe).toHaveBeenCalledTimes(1);
    callbacks.onStateChange!('connected');
    callbacks.onConnected!();
    await vi.advanceTimersByTimeAsync(0);
    const renewed = connection.getEarliestSubscriptionExpiry();
    expect(renewed).toBeGreaterThan(Date.now());
    resolve({ subscriptions: [{ ...home, expiresAt: Date.now() + 20_000 }] });
    await earlier;
    expect(connection.getEarliestSubscriptionExpiry()).toBe(renewed);
  });

  it('does not retry scopes the server explicitly invalidated', async () => {
    const callbacks = await activateSocket();
    await connection.subscribeToScopes([home]);
    callbacks.onBroadcast!({ type: 'subscription_invalidated', scope: home, reason: 'access_revoked' });
    await vi.advanceTimersByTimeAsync(300_000);
    callbacks.onStateChange!('reconnecting');
    callbacks.onStateChange!('connected');
    callbacks.onConnected!();
    await vi.advanceTimersByTimeAsync(0);
    expect(connection.getEarliestSubscriptionExpiry()).toBeNull();
    expect(subscribe).toHaveBeenCalledTimes(1);
  });
});
