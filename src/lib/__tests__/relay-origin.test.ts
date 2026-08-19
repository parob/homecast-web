// @vitest-environment jsdom
// config.ts reads `window` at module scope, and these rules are about URL and
// localStorage behaviour, so a real DOM is the honest place to exercise them.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// This environment's localStorage is a partial stub with no methods (same as
// notice-dismissal.test.ts), and config.ts reads it while the module is being
// evaluated — so the replacement has to be installed before the import runs,
// which a plain top-level statement would not do.
vi.hoisted(() => {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, String(v)); },
      removeItem: (k: string) => { store.delete(k); },
      clear: () => { store.clear(); },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() { return store.size; },
    },
  });
});

import { communityWsUrl, normalizeRelayOrigin, getCommunityMode, getRelayAddress, forgetRelay } from '../config';

describe('normalizeRelayOrigin', () => {
  it('reads a bare host:port as http, the way it was stored before HTTPS was possible', () => {
    expect(normalizeRelayOrigin('192.168.1.5:5656')).toBe('http://192.168.1.5:5656');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeRelayOrigin('https://home.example.com')).toBe('https://home.example.com');
  });

  it('drops a trailing slash and any path', () => {
    expect(normalizeRelayOrigin('https://home.example.com/')).toBe('https://home.example.com');
    expect(normalizeRelayOrigin('http://192.168.1.5:5656/login')).toBe('http://192.168.1.5:5656');
  });

  it('drops the default port, which is what distinguishes a proxied relay', () => {
    expect(normalizeRelayOrigin('https://home.example.com:443')).toBe('https://home.example.com');
  });

  it('tolerates whitespace', () => {
    expect(normalizeRelayOrigin('  192.168.1.5:5656  ')).toBe('http://192.168.1.5:5656');
  });
});

describe('communityWsUrl', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the reported WS port when the origin names an explicit port', () => {
    localStorage.setItem('homecast-relay-ws-port', '5657');
    expect(communityWsUrl('http://192.168.1.5:5656')).toBe('ws://192.168.1.5:5657/ws');
  });

  it('falls back to HTTP + 1 for a relay that never reported a WS port', () => {
    expect(communityWsUrl('http://192.168.1.5:5656')).toBe('ws://192.168.1.5:5657/ws');
  });

  it('honours a non-default port from the ladder rather than assuming 5657', () => {
    localStorage.setItem('homecast-relay-ws-port', '5659');
    expect(communityWsUrl('http://192.168.1.5:5658')).toBe('ws://192.168.1.5:5659/ws');
  });

  it('works over a mesh VPN, where both ports are reachable', () => {
    localStorage.setItem('homecast-relay-ws-port', '5657');
    expect(communityWsUrl('http://100.92.14.3:5656')).toBe('ws://100.92.14.3:5657/ws');
  });

  it('goes same-origin for a proxied relay, which has no second port to offer', () => {
    // The reported WS port is deliberately ignored here: the front end serves
    // one hostname on 443 and routes /ws onwards itself.
    localStorage.setItem('homecast-relay-ws-port', '5657');
    expect(communityWsUrl('https://home.example.com')).toBe('wss://home.example.com/ws');
  });

  it('uses ws, not wss, for a plain-http origin with no port', () => {
    expect(communityWsUrl('http://home.example.com')).toBe('ws://home.example.com/ws');
  });

  it('lets an explicit override win over both rules', () => {
    localStorage.setItem('homecast-relay-ws-url', 'wss://ws.example.com/socket');
    expect(communityWsUrl('https://home.example.com')).toBe('wss://ws.example.com/socket');
  });

  it('ignores a nonsense stored WS port rather than emitting NaN', () => {
    localStorage.setItem('homecast-relay-ws-port', 'not-a-port');
    expect(communityWsUrl('http://192.168.1.5:5656')).toBe('ws://192.168.1.5:5657/ws');
  });
});

describe('native relay origin', () => {
  // iOS serves this app from the device's own loopback server and points only
  // its API calls at the relay. If "which relay" is lost, the app falls back to
  // same-origin and the phone talks to itself — a server with no bridge, where
  // every request hangs and a healthy relay is reported unreachable.
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).__HOMECAST_RELAY_ORIGIN__;
  });

  it('forces client mode, even with no localStorage at all', () => {
    (window as any).__HOMECAST_RELAY_ORIGIN__ = 'http://192.168.1.5:5656';
    expect(getCommunityMode()).toBe('client');
    expect(getRelayAddress()).toBe('http://192.168.1.5:5656');
  });

  it('wins over a stale localStorage mode', () => {
    localStorage.setItem('homecast-mode', 'relay');
    localStorage.setItem('homecast-relay-address', 'http://10.0.0.9:5656');
    (window as any).__HOMECAST_RELAY_ORIGIN__ = 'http://192.168.1.5:5656';
    expect(getCommunityMode()).toBe('client');
    expect(getRelayAddress()).toBe('http://192.168.1.5:5656');
  });

  it('falls back to localStorage when the shell said nothing', () => {
    localStorage.setItem('homecast-mode', 'client');
    localStorage.setItem('homecast-relay-address', '10.0.0.9:5656');
    expect(getCommunityMode()).toBe('client');
    expect(getRelayAddress()).toBe('http://10.0.0.9:5656');
  });
});

describe('forgetRelay', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as any).__HOMECAST_RELAY_ORIGIN__;
    delete (window as any).webkit;
  });

  it('hands the job to the shell, and does not navigate itself', () => {
    const posted: any[] = [];
    (window as any).webkit = { messageHandlers: { homecast: { postMessage: (m: any) => posted.push(m) } } };
    localStorage.setItem('homecast-relay-address', 'http://10.0.0.9:5656');

    forgetRelay();

    expect(posted).toEqual([{ action: 'forgetRelay' }]);
    // The shell swaps the picker in. Navigating as well would reload the
    // WebView out from under it.
    expect(localStorage.getItem('homecast-relay-address')).toBeNull();
  });

  it('clears every key getRelayAddress reads, not just the stored address', () => {
    // The override is read *first*, so leaving it behind would keep answering
    // with the host the user is trying to get away from.
    localStorage.setItem('homecast-relay-override', 'http://10.0.0.9:5656');
    localStorage.setItem('homecast-relay-address', 'http://10.0.0.8:5656');
    localStorage.setItem('homecast-relay-ws-port', '5657');
    localStorage.setItem('homecast-relay-setup', '1');
    localStorage.setItem('homecast-mode', 'client');
    (window as any).webkit = { messageHandlers: { homecast: { postMessage: () => {} } } };

    forgetRelay();

    expect(getRelayAddress()).toBeNull();
    expect(getCommunityMode()).toBeNull();
  });
});
