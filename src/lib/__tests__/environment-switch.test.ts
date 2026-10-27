import { describe, expect, it, vi } from 'vitest';
import { stagingServerIsUp, switchEnvironment, waitForStaging, wakeStaging } from '../environment-switch';

function fakeWindow(withBridge = false) {
  const call = vi.fn();
  return {
    win: { location: { href: 'https://staging.homecast.cloud/login' }, ...(withBridge ? { homekit: { call } } : {}) },
    call,
  };
}

describe('switchEnvironment', () => {
  it('asks the iOS/Mac app to switch, and leaves navigation to it', () => {
    const { win, call } = fakeWindow(true);
    const doc = { cookie: '' };
    switchEnvironment('production', win, doc, undefined);
    expect(call).toHaveBeenCalledWith('settings.setEnvironment', { environment: 'production' }, expect.stringMatching(/^env-switch-/));
    expect(win.location.href).toBe('https://staging.homecast.cloud/login');
    expect(doc.cookie).toBe('');
  });

  it('in a browser, records the choice for both origins and goes to production', () => {
    const { win } = fakeWindow();
    const doc = { cookie: '' };
    const storage = { setItem: vi.fn() };
    switchEnvironment('production', win, doc, storage);
    expect(doc.cookie).toContain('homecast-env=production');
    expect(doc.cookie).toContain('domain=.homecast.cloud');
    expect(storage.setItem).toHaveBeenCalledWith('homecast-environment', 'production');
    expect(win.location.href).toBe('https://homecast.cloud/portal');
  });

  it('still switches when storage throws', () => {
    const { win } = fakeWindow();
    const storage = { setItem: () => { throw new Error('private mode'); } };
    switchEnvironment('staging', win, { cookie: '' }, storage);
    expect(win.location.href).toBe('https://staging.homecast.cloud/portal');
  });
});

describe('stagingServerIsUp', () => {
  it('is true when staging answers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    expect(await stagingServerIsUp(fetchImpl as unknown as typeof fetch)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('https://staging.api.homecast.cloud/', expect.objectContaining({ method: 'POST' }));
  });

  it('is false when staging is scaled to zero (503 from the load balancer)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    expect(await stagingServerIsUp(fetchImpl as unknown as typeof fetch)).toBe(false);
  });

  it('is false when the request fails or times out', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await stagingServerIsUp(fetchImpl as unknown as typeof fetch)).toBe(false);
  });
});

describe('wakeStaging', () => {
  it('asks production, with no sign-in', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: { wakeStaging: { available: true, awakeUntil: '2026-10-27T07:00:00Z', error: null } } }),
    });
    expect(await wakeStaging(fetchImpl as unknown as typeof fetch)).toEqual({ ok: true, awakeUntil: '2026-10-27T07:00:00Z' });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.homecast.cloud/');
    expect(init.headers).not.toHaveProperty('Authorization');
    expect(init.body).toContain('wakeStaging');
  });

  it("reports the server's refusal", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ data: { wakeStaging: { available: false, awakeUntil: null, error: 'Too many wake requests' } } }),
    });
    expect(await wakeStaging(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, error: 'Too many wake requests' });
  });

  it('reports a network failure rather than throwing', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    expect(await wakeStaging(fetchImpl as unknown as typeof fetch)).toEqual({ ok: false, error: expect.stringContaining("Couldn't reach Homecast") });
  });
});

describe('waitForStaging', () => {
  it('polls until staging answers', async () => {
    const answers = [false, false, true];
    const sleep = vi.fn().mockResolvedValue(undefined);
    let t = 0;
    const ok = await waitForStaging({ isUp: async () => answers.shift()!, sleep, pollMs: 5000, timeoutMs: 60000, now: () => (t += 1000) });
    expect(ok).toBe(true);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('gives up at the deadline', async () => {
    let t = 0;
    const ok = await waitForStaging({ isUp: async () => false, sleep: async () => { t += 5000; }, pollMs: 5000, timeoutMs: 20000, now: () => t });
    expect(ok).toBe(false);
  });
});
