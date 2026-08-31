// @vitest-environment jsdom
//
// `buildDiagnosticsBundle` reads `navigator.userAgent`, which is exactly right
// for code that only ever runs in a browser — but the suite's default
// environment is `node`, and CI pins Node 20, where `navigator` is not a global
// at all (it arrived in Node 21). Without this the file passes on a developer's
// newer Node and fails only in CI.

/**
 * What a shake report actually carries.
 *
 * A report is filed *because* something went wrong, so the two buffers that
 * know what went wrong have to survive into the bundle. Both used to fail, in
 * ways that only showed up on a busy home:
 *
 *  - the request log — the one place a failed request and its error code are
 *    recorded — was never collected at all;
 *  - `browserLogger`'s ring is shared with every inbound WS frame, so on a home
 *    with live accessories `characteristic_update` evicted the errors,
 *    connection transitions and GQL entries that were worth keeping.
 *
 * Both are asserted here rather than assumed, because both are silent: the
 * report still arrives, still looks well-formed, and simply has nothing in it.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/server/connection', () => ({
  serverConnection: {
    getState: () => ({
      connectionState: 'connected',
      isActive: true,
      relayStatus: 'online',
      error: null,
    }),
  },
}));

vi.mock('@/lib/config', () => ({
  config: {
    version: 'test',
    apiUrl: 'https://api.example.test',
    isCommunity: false,
    isStaging: false,
  },
}));

vi.mock('@/hooks/useHomeKitData', () => ({ getCacheTimestamp: () => null }));

import { buildDiagnosticsBundle } from '../relay-diagnostics';
import { browserLogger } from '../browser-logger';
import { beginRequest, clearRequestLog, logEvent } from '../request-log';

describe('the diagnostics bundle a report ships', () => {
  beforeEach(() => {
    browserLogger.clear();
    clearRequestLog();
  });

  it('carries the request log, so a failed request survives into the report', () => {
    // Exactly the situation a report is filed about: some requests worked,
    // some did not, and the error code is the whole diagnosis.
    beginRequest('accessories.list', 'home=3C4399F4').ok('ws');
    beginRequest('characteristics.set', 'home=3C4399F4').fail({ code: 'DEVICE_ERROR' });

    const bundle = buildDiagnosticsBundle() as Record<string, unknown>;

    expect(bundle.requests).toBeDefined();
    const requests = bundle.requests as Array<Record<string, unknown>>;
    const failed = requests.filter((r) => r.status === 'error');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ action: 'characteristics.set', error: 'DEVICE_ERROR' });
  });

  it('keeps the request log even when the state-broadcast storm is running', () => {
    beginRequest('characteristics.set').fail({ code: 'DEVICE_ERROR' });
    logEvent('socket', 'connected');
    for (let i = 0; i < 800; i += 1) {
      browserLogger.logWsReceive('characteristic_update', `#${i}`);
    }

    const bundle = buildDiagnosticsBundle() as Record<string, unknown>;
    const requests = bundle.requests as Array<Record<string, unknown>>;

    // The request log has its own 600-entry ring and is not touched by WS
    // frames, so the failure is still there however loud the home is.
    expect(requests.some((r) => r.error === 'DEVICE_ERROR')).toBe(true);
  });
});

describe('browserLogger under a state-broadcast storm', () => {
  beforeEach(() => {
    browserLogger.clear();
  });

  it('does not let characteristic_update evict the errors', () => {
    browserLogger.logError('relay write failed', { code: 'DEVICE_ERROR' });
    browserLogger.logConnection('disconnected', 'socket closed');
    browserLogger.logGql('GetAccessories', 'network error', 'error');

    // A busy home. 488 of 500 entries in the report on homecast-cloud#49 were
    // this one frame type; 800 is the same shape with room to spare.
    for (let i = 0; i < 800; i += 1) {
      browserLogger.logWsReceive('characteristic_update', `accessory #${i}`);
    }

    const entries = browserLogger.getEntries();
    const summaries = entries.map((e) => e.summary);

    expect(summaries).toContain('relay write failed');
    expect(summaries).toContain('connection: disconnected');
    expect(summaries).toContain('GetAccessories');
  });

  it('still keeps the recent state frames — they are worth having, just not all of it', () => {
    for (let i = 0; i < 800; i += 1) {
      browserLogger.logWsReceive('characteristic_update', `accessory #${i}`);
    }
    const frames = browserLogger.getEntries().filter((e) => e.summary === 'characteristic_update');
    expect(frames.length).toBeGreaterThan(50);
    // And the newest ones, not the oldest.
    expect(frames[frames.length - 1].details).toBe('accessory #799');
  });

  it('does not grow without bound', () => {
    for (let i = 0; i < 5_000; i += 1) {
      browserLogger.logWsReceive('characteristic_update', `#${i}`);
      if (i % 100 === 0) browserLogger.logError(`error ${i}`);
    }
    expect(browserLogger.getEntries().length).toBeLessThanOrEqual(600);
  });
});
