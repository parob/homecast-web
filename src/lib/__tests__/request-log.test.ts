/**
 * The request log exists to answer "what did the app do when it opened".
 *
 * Two properties carry that, and both fail silently if broken: it records from
 * module load (the panel cannot be mounted yet while a launch happens), and it
 * records whether or not anyone is subscribed (or switching it on would show an
 * empty list and the launch would be gone).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import {
  beginRequest, logEvent, getRequestLog, clearRequestLog, formatRequestLog,
  subscribeRequestLog, isRequestPanelEnabled, setRequestPanelEnabled,
} from '../request-log';

describe('request log', () => {
  beforeEach(() => {
    clearRequestLog();
    store.clear();
  });

  it('records with nobody subscribed, so switching the panel on shows history', () => {
    // The launch case: entries accrue before any UI exists to hear about them.
    logEvent('socket', 'connecting');
    beginRequest('homes.list').ok('ws');

    expect(getRequestLog()).toHaveLength(2);
    expect(getRequestLog()[1]).toMatchObject({ action: 'homes.list', status: 'ok', via: 'ws' });
  });

  it('marks a request pending until it settles, and keeps failures', () => {
    const pending = beginRequest('accessories.list', 'home=3C4399F4');
    expect(getRequestLog()[0].status).toBe('pending');

    pending.fail({ code: 'NO_DEVICE' });
    expect(getRequestLog()[0]).toMatchObject({ status: 'error', error: 'NO_DEVICE' });
    expect(getRequestLog()[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('stamps entries relative to page load, not wall clock', () => {
    logEvent('app', 'boot');
    const entry = getRequestLog()[0];
    // Small and non-negative: the axis is "since this page started".
    expect(entry.at).toBeGreaterThanOrEqual(0);
    expect(entry.at).toBeLessThan(60_000);
  });

  it('keeps the buffer bounded so a long session cannot grow without limit', () => {
    for (let i = 0; i < 900; i++) logEvent('tick', String(i));
    expect(getRequestLog().length).toBeLessThanOrEqual(600);
    // Oldest dropped, newest kept.
    expect(getRequestLog()[getRequestLog().length - 1].detail).toBe('899');
  });

  it('notifies subscribers, coalesced rather than once per entry', async () => {
    const seen = vi.fn();
    const unsub = subscribeRequestLog(seen);
    logEvent('a'); logEvent('b'); logEvent('c');

    expect(seen).not.toHaveBeenCalled();     // coalesced, not synchronous
    await new Promise(r => setTimeout(r, 150));
    expect(seen).toHaveBeenCalledTimes(1);
    unsub();
  });

  it('formats a paste-able report', () => {
    beginRequest('accessories.list', 'home=3C4399F4').ok('ws');
    logEvent('socket', 'connected');
    const text = formatRequestLog();
    expect(text).toContain('accessories.list');
    expect(text).toContain('home=3C4399F4');
    expect(text).toContain('socket connected');
  });

  it('persists the panel switch so it survives the reload it needs to observe', () => {
    expect(isRequestPanelEnabled()).toBe(false);
    setRequestPanelEnabled(true);
    expect(isRequestPanelEnabled()).toBe(true);
    setRequestPanelEnabled(false);
    expect(isRequestPanelEnabled()).toBe(false);
  });
});
