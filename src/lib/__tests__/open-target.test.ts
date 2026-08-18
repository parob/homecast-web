import { describe, it, expect } from 'vitest';
import { resolveOpenTarget, DEFAULT_OPEN_TARGET } from '../open-target';

describe('resolveOpenTarget', () => {
  it('forwards a same-site path', () => {
    expect(resolveOpenTarget('/portal')).toBe('/portal');
    expect(resolveOpenTarget('/portal/admin/deals')).toBe('/portal/admin/deals');
    expect(resolveOpenTarget('/portal?home=abc&checkout=success')).toBe('/portal?home=abc&checkout=success');
  });

  it('falls back to the dashboard when there is no target', () => {
    for (const empty of [null, undefined, '']) {
      expect(resolveOpenTarget(empty)).toBe(DEFAULT_OPEN_TARGET);
    }
  });

  it('refuses to leave the site', () => {
    // The link goes out by email, so "it came from us" is not something we get
    // to assume on the way back in.
    const hostile = [
      'https://evil.example.com/',
      'http://evil.example.com/',
      '//evil.example.com/',
      '/\\evil.example.com',
      '\\\\evil.example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'portal',
      '../portal',
    ];
    for (const value of hostile) {
      expect(resolveOpenTarget(value)).toBe(DEFAULT_OPEN_TARGET);
    }
  });

  it('rejects padding and control characters', () => {
    expect(resolveOpenTarget('  /portal')).toBe(DEFAULT_OPEN_TARGET);
    expect(resolveOpenTarget('/portal ')).toBe(DEFAULT_OPEN_TARGET);
    expect(resolveOpenTarget('/portal\nLocation: https://evil.example.com')).toBe(DEFAULT_OPEN_TARGET);
    expect(resolveOpenTarget('/portal\r\nSet-Cookie: a=b')).toBe(DEFAULT_OPEN_TARGET);
  });
});
