// @vitest-environment jsdom
/**
 * Shipped logs must say which device produced them (parob/homecast-web#109).
 *
 * The fault this pins: app-web inside the Mac relay's WKWebView shipped logs
 * that were **indistinguishable** from a browser tab's. `source` is the
 * hardcoded `"web"` on both and the session id is minted `web-…` on both, so
 * in Cloud Logging there was no way to tell the relay's own web app from
 * someone's laptop. Anything reasoning about relay behaviour from shipped logs
 * hit that wall — it cost parob/homecast-cloud#119 an open question it did not
 * need to have.
 *
 * Measured on `main` before the fix, by driving the real logger and capturing
 * the real request body:
 *
 *     RELAY   source     = "web"        BROWSER source     = "web"
 *     RELAY   session_id = "web-mtyq0amo-cknrak"
 *     BROWSER session_id = "web-mtyq0ams-zfy38i"
 *     RELAY   entry keys : ["level","message","timestamp","metadata"]
 *     RELAY   device_id  = undefined
 *
 * `device_id` is the fix and it needed no new protocol: `client_logs.py` has
 * always read it as a first-class column, and this shipper simply never sent
 * it. So these tests assert the *payload*, which is the contract, rather than
 * any internal.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

interface RelayWindow {
  isHomeKitRelayCapable?: boolean;
}

interface ShippedBody {
  source: string;
  session_id: string;
  entries: Array<Record<string, unknown>>;
}

/**
 * Drive the real logger with a real (stubbed) transport and return what it
 * would have POSTed to `/internal/logs`.
 *
 * `vi.resetModules()` before each import matters: the logger is a module
 * singleton that reads its session id at construction, exactly as it does on a
 * real page load.
 */
async function shipOneError(opts: { relayCapable: boolean; deviceId?: string }): Promise<ShippedBody> {
  vi.resetModules();
  (window as unknown as RelayWindow).isHomeKitRelayCapable = opts.relayCapable;
  sessionStorage.clear();
  localStorage.clear();
  if (opts.deviceId) localStorage.setItem('homecast-device-id', opts.deviceId);

  let captured: ShippedBody | null = null;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    captured = JSON.parse(String(init.body)) as ShippedBody;
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });

  const { browserLogger } = await import('@/lib/browser-logger');
  browserLogger.install({
    source: 'web',
    url: () => 'https://api.homecast.cloud/internal/logs',
    token: () => 'tok',
  });

  console.error('something went wrong');
  await browserLogger.flushNow();

  if (!captured) throw new Error('nothing was shipped');
  return captured;
}

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (window as unknown as RelayWindow).isHomeKitRelayCapable;
});

describe('a relay can be told from a browser in shipped logs', () => {
  it('labels the relay by its mac_ device id', async () => {
    const body = await shipOneError({ relayCapable: true, deviceId: 'mac_abc-123' });
    expect(body.entries[0].device_id).toBe('mac_abc-123');
  });

  it('labels a browser by its web_ device id', async () => {
    const body = await shipOneError({ relayCapable: false, deviceId: 'web_def-456' });
    expect(body.entries[0].device_id).toBe('web_def-456');
  });

  it('makes the two distinguishable — which is the whole bug', async () => {
    const relay = await shipOneError({ relayCapable: true, deviceId: 'mac_abc-123' });
    const browser = await shipOneError({ relayCapable: false, deviceId: 'web_def-456' });

    // `source` is still "web" for both. That is deliberate and unchanged:
    // widening the server's _ALLOWED_SOURCES is a cross-repo change with the
    // usual server-before-web ordering, and shipping an unknown `source` gets
    // the whole batch rejected with a 400.
    expect(relay.source).toBe('web');
    expect(browser.source).toBe('web');

    // The distinction rides on the field the server has always had.
    expect(relay.entries[0].device_id).not.toBe(browser.entries[0].device_id);
    expect(String(relay.entries[0].device_id).startsWith('mac_')).toBe(true);
    expect(String(browser.entries[0].device_id).startsWith('web_')).toBe(true);
  });
});

describe('when there is no device id yet', () => {
  it('omits the key rather than sending null', async () => {
    // The logger is installed before `getDeviceId()` has necessarily minted
    // one. An explicit null would land in the column as a value; an absent key
    // reads as "not reported", which is the truth.
    const body = await shipOneError({ relayCapable: true });
    expect('device_id' in body.entries[0]).toBe(false);
  });

  it('still ships the entry, because a log line without an id is better than none', async () => {
    const body = await shipOneError({ relayCapable: false });
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].message).toContain('something went wrong');
  });

  it('picks the id up on a later flush rather than caching the miss', async () => {
    // Read per flush, not once at construction — otherwise a cold start caches
    // `null` and the field never populates for the life of the tab.
    vi.resetModules();
    sessionStorage.clear();
    localStorage.clear();

    const bodies: ShippedBody[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as ShippedBody);
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    });

    const { browserLogger } = await import('@/lib/browser-logger');
    browserLogger.install({
      source: 'web',
      url: () => 'https://api.homecast.cloud/internal/logs',
      token: () => 'tok',
    });

    console.error('before the id exists');
    await browserLogger.flushNow();

    localStorage.setItem('homecast-device-id', 'mac_minted-late');
    console.error('after the id exists');
    await browserLogger.flushNow();

    expect(bodies).toHaveLength(2);
    expect('device_id' in bodies[0].entries[0]).toBe(false);
    expect(bodies[1].entries[0].device_id).toBe('mac_minted-late');
  });
});
