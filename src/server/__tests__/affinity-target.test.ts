/**
 * Remembering where the server sent us last time.
 *
 * The value read back becomes a connection target, so it is untrusted input —
 * most of these cases are about refusing to honour it, not about honouring it.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: () => null,
    get length() { return store.size; },
  },
});

import { preferredWsUrl, rememberAffinityTarget, forgetAffinityTarget } from '../affinity-target';

const FRONT_DOOR = 'wss://api.homecast.cloud/ws';
const TARGET = 'wss://api.homecast.cloud/ws?affinity=7d9e35ca';

describe('affinity target', () => {
  beforeEach(() => { store.clear(); vi.useRealTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts at the front door when nothing is remembered', () => {
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
  });

  it('returns to where the server sent us, so the handoff is not repeated', () => {
    rememberAffinityTarget(TARGET);
    expect(preferredWsUrl(FRONT_DOOR)).toBe(TARGET);
  });

  it('forgets on demand, for when the endpoint produced only silence', () => {
    rememberAffinityTarget(TARGET);
    forgetAffinityTarget();
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
  });

  it('refuses a target on another host', () => {
    // A saved staging target must never be able to point a production session
    // somewhere it does not belong.
    rememberAffinityTarget('wss://staging.api.homecast.cloud/ws?affinity=x');
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
  });

  it('refuses a target that is not a websocket URL', () => {
    rememberAffinityTarget('https://api.homecast.cloud/steal');
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
  });

  it('refuses junk without throwing', () => {
    store.set('homecast-ws-affinity', 'not json');
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
    store.set('homecast-ws-affinity', JSON.stringify({ url: TARGET }));  // no timestamp
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
  });

  it('expires, so a dormant install starts from the front door', () => {
    store.set('homecast-ws-affinity', JSON.stringify({
      url: TARGET,
      at: Date.now() - 13 * 60 * 60 * 1000,
    }));
    expect(preferredWsUrl(FRONT_DOOR)).toBe(FRONT_DOOR);
    // ...and drops the stale entry rather than re-reading it every launch.
    expect(store.get('homecast-ws-affinity')).toBeUndefined();
  });
});
