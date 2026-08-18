import { describe, it, expect } from 'vitest';
import { MARKETING_PATHS, isMarketingPath } from '../marketing-routes';

describe('isMarketingPath', () => {
  it('claims every marketing page', () => {
    for (const path of MARKETING_PATHS) {
      expect(isMarketingPath(path)).toBe(true);
    }
  });

  it('claims the bare root — the page the app used to open on', () => {
    // The AASA claims "/" because our emails link to it, and "/" serves the
    // marketing landing page. That pairing is the whole bug.
    expect(isMarketingPath('/')).toBe(true);
  });

  it.each([
    '/portal',
    '/portal/admin/deals',
    '/login',
    '/signup',
    '/verify-email',
    '/reset-password',
    '/subscribe',
    '/oauth/consent',
    '/s/abc123',
    '/mqtt',
    '/analytics',
    '',
  ])('leaves %s alone — it is a screen of the app', (path) => {
    expect(isMarketingPath(path)).toBe(false);
  });

  it('does not claim /delete-account', () => {
    // Wears marketing chrome, but resetAndUninstall is Community-only, so for a
    // cloud account this is the product's ONLY deletion route — the one Apple
    // 5.1.1(v) and Google's data-deletion URL point at. It must stay reachable
    // inside the native app. Do not "tidy" it into the list.
    expect(isMarketingPath('/delete-account')).toBe(false);
  });

  it('does not claim /features', () => {
    // An alias that only ever redirects — no page of its own.
    expect(isMarketingPath('/features')).toBe(false);
  });

  it('matches exactly, trailing slash included', () => {
    // Pins long-standing behaviour rather than endorsing it: React Router
    // matches "/pricing/" to the /pricing route, so the staging badge shows
    // there today. Changing that should be a deliberate act, not a side effect.
    expect(isMarketingPath('/pricing/')).toBe(false);
  });
});
