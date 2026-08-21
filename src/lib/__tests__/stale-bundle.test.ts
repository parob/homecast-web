// @vitest-environment jsdom
// jsdom: reloadForNewBundle touches window.location, navigator.serviceWorker
// and the Cache API — the recovery is the behaviour worth testing, not the
// message matcher alone.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isStaleBundleError, isLikelyOffline, reloadForNewBundle } from '../stale-bundle';

describe('isStaleBundleError', () => {
  // The messages three engines actually produce for the same cause: a lazy
  // import of a chunk a deploy renamed away. Verbatim, because there is no
  // error code to key on and the wording is the whole signal.
  it.each([
    ['Chrome', 'Failed to fetch dynamically imported module: https://homecast.cloud/assets/DealPriceChart-BBgncQ6Q.js'],
    ['Firefox', 'error loading dynamically imported module'],
    ['Safari', 'Importing a module script failed.'],
    ['Vite preload', 'Unable to preload CSS for /assets/Dashboard-TXodn9Nu.css'],
  ])('recognises the %s wording', (_engine, message) => {
    expect(isStaleBundleError(new Error(message))).toBe(true);
  });

  it('accepts a bare string, since not every rejection carries an Error', () => {
    expect(isStaleBundleError('Failed to fetch dynamically imported module: /assets/x.js')).toBe(true);
  });

  it('reads an Error-shaped object that did not survive a structured clone', () => {
    expect(isStaleBundleError({ message: 'Failed to fetch dynamically imported module' })).toBe(true);
  });

  it('leaves real bugs alone — they must keep reaching the crash screen', () => {
    expect(isStaleBundleError(new Error("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isStaleBundleError(new Error('Failed to fetch'))).toBe(false);
    expect(isStaleBundleError(new TypeError('x is not a function'))).toBe(false);
  });

  it('survives the things an error path really gets handed', () => {
    expect(isStaleBundleError(undefined)).toBe(false);
    expect(isStaleBundleError(null)).toBe(false);
    expect(isStaleBundleError('')).toBe(false);
    expect(isStaleBundleError({})).toBe(false);
    expect(isStaleBundleError({ message: 42 })).toBe(false);
  });
});

describe('isLikelyOffline', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'onLine');
  const setOnLine = (value: boolean | undefined) =>
    Object.defineProperty(navigator, 'onLine', { value, configurable: true });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'onLine', original);
  });

  it('is true only when the browser positively reports no network', () => {
    setOnLine(false);
    expect(isLikelyOffline()).toBe(true);
  });

  it('is false when online — a truthy onLine proves very little, so it must not trigger anything', () => {
    setOnLine(true);
    expect(isLikelyOffline()).toBe(false);
  });

  it('is false when the browser has no opinion, so the update path stays the default', () => {
    setOnLine(undefined);
    expect(isLikelyOffline()).toBe(false);
  });
});

describe('reloadForNewBundle', () => {
  let deleted: string[];
  let unregistered: number;
  let reloads: number;

  beforeEach(() => {
    vi.useFakeTimers();
    deleted = [];
    unregistered = 0;
    reloads = 0;

    vi.stubGlobal('caches', {
      keys: async () => [
        'homecast-shell-abc123',
        'homecast-assets',
        // Not ours. A shared origin's caches must survive a recovery that is
        // only ever about this app's own delivery.
        'workbox-precache-v2',
      ],
      delete: async (name: string) => {
        deleted.push(name);
        return true;
      },
    });

    Object.defineProperty(navigator, 'serviceWorker', {
      value: {
        getRegistrations: async () => [
          { unregister: async () => { unregistered += 1; return true; } },
        ],
      },
      configurable: true,
    });

    Object.defineProperty(window, 'location', {
      value: { reload: () => { reloads += 1; } },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('drops the asset cache as well as the shell', async () => {
    reloadForNewBundle();
    await vi.runAllTimersAsync();

    // The asset cache is the one that spans builds, so it is the one that can
    // pin a bad response past a reload. Dropping only the shell is what let the
    // Reload button land back on its own screen.
    expect(deleted).toContain('homecast-shell-abc123');
    expect(deleted).toContain('homecast-assets');
  });

  it('leaves caches belonging to anything else alone', async () => {
    reloadForNewBundle();
    await vi.runAllTimersAsync();
    expect(deleted).not.toContain('workbox-precache-v2');
  });

  it('unregisters the worker, so a wedged one cannot answer the reload', async () => {
    reloadForNewBundle();
    await vi.runAllTimersAsync();
    expect(unregistered).toBe(1);
  });

  it('reloads exactly once, however the clearing went', async () => {
    reloadForNewBundle();
    await vi.runAllTimersAsync();
    expect(reloads).toBe(1);
  });

  it('still reloads when the Cache API never settles', async () => {
    vi.stubGlobal('caches', { keys: () => new Promise(() => {}), delete: async () => true });
    reloadForNewBundle();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reloads).toBe(1);
  });

  it('still reloads when clearing throws outright', async () => {
    vi.stubGlobal('caches', {
      keys: async () => { throw new Error('storage disabled'); },
      delete: async () => true,
    });
    reloadForNewBundle();
    await vi.runAllTimersAsync();
    expect(reloads).toBe(1);
  });
});
