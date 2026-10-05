// Tests for the HTTP Request helpers — auth headers and trace redaction

import { describe, it, expect } from 'vitest';
import { authHeader, hasHeader, redactHeaders, REDACTED } from './http-request';

describe('authHeader', () => {
  it('builds each kind', () => {
    expect(authHeader({ type: 'bearer', token: 't' })).toEqual({ name: 'Authorization', value: 'Bearer t' });
    expect(authHeader({ type: 'api_key', header: 'X-Key', value: 'v' })).toEqual({ name: 'X-Key', value: 'v' });
    expect(authHeader({ type: 'basic', username: 'u', password: 'p' })).toEqual({ name: 'Authorization', value: 'Basic dTpw' });
  });

  it('falls back to the default header name for an API key saved without one', () => {
    expect(authHeader({ type: 'api_key', header: '', value: 'v' }).name).toBe('X-API-Key');
  });
});

describe('hasHeader', () => {
  it('ignores case, as HTTP does', () => {
    expect(hasHeader({ 'content-type': 'x' }, 'Content-Type')).toBe(true);
    expect(hasHeader({}, 'Content-Type')).toBe(false);
  });
});

describe('redactHeaders', () => {
  it('blanks credential values and keeps every name', () => {
    expect(redactHeaders({
      Authorization: 'Bearer t',
      'X-API-Key': 'k',
      Cookie: 'c',
      'X-Session-Id': 's',
      'Content-Type': 'application/json',
      'X-Room': 'kitchen',
    })).toEqual({
      Authorization: REDACTED,
      'X-API-Key': REDACTED,
      Cookie: REDACTED,
      'X-Session-Id': REDACTED,
      'Content-Type': 'application/json',
      'X-Room': 'kitchen',
    });
  });

  it("blanks the user's own API-key header even when its name looks harmless", () => {
    expect(redactHeaders({ 'X-Hub': 'k' }, ['x-hub'])).toEqual({ 'X-Hub': REDACTED });
  });
});
