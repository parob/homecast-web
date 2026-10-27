import { describe, expect, it, vi } from 'vitest';
import { requestStagingWake, stagingServerIsUp, switchEnvironment, takeStagingWakeRequest } from '../environment-switch';

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

describe('waking staging from its own badge', () => {
  it('leaves a short-lived request for production, then goes there', () => {
    const { win } = fakeWindow();
    const writes: string[] = [];
    const doc = { set cookie(v: string) { writes.push(v); }, get cookie() { return writes.join('; '); } };
    requestStagingWake(win, doc, undefined);
    expect(writes[0]).toMatch(/^homecast-wake-staging=1;domain=\.homecast\.cloud;.*max-age=900/);
    expect(win.location.href).toBe('https://homecast.cloud/portal');
  });

  it('in the iOS/Mac app, also leaves the request and asks the app to switch', () => {
    const { win, call } = fakeWindow(true);
    const doc = { cookie: '' };
    requestStagingWake(win, doc, undefined);
    expect(doc.cookie).toContain('homecast-wake-staging=1');
    expect(call).toHaveBeenCalledWith('settings.setEnvironment', { environment: 'production' }, expect.any(String));
  });

  it('production takes the request once, clearing it', () => {
    const doc = { cookie: 'homecast-env=production; homecast-wake-staging=1' };
    expect(takeStagingWakeRequest(doc)).toBe(true);
    expect(doc.cookie).toMatch(/^homecast-wake-staging=;.*max-age=0/);
    expect(takeStagingWakeRequest(doc)).toBe(false);
  });

  it('ignores other cookies that merely contain the name', () => {
    expect(takeStagingWakeRequest({ cookie: 'x-homecast-wake-staging=1' })).toBe(false);
    expect(takeStagingWakeRequest({ cookie: 'homecast-wake-staging=10' })).toBe(false);
  });
});
