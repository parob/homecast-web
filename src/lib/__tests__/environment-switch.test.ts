import { describe, expect, it, vi } from 'vitest';
import { stagingServerIsUp, switchEnvironment } from '../environment-switch';

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
