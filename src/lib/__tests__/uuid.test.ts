import { describe, it, expect, afterEach, vi } from 'vitest';
import { randomUUID } from '../uuid';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const realCrypto = globalThis.crypto;

function withCrypto(replacement: unknown) {
  Object.defineProperty(globalThis, 'crypto', {
    value: replacement, configurable: true, writable: true,
  });
}

afterEach(() => withCrypto(realCrypto));

describe('randomUUID', () => {
  it('produces a valid v4 UUID', () => {
    expect(randomUUID()).toMatch(UUID_V4);
  });

  it('uses crypto.randomUUID when the browser has it', () => {
    const spy = vi.fn(() => '11111111-2222-4333-8444-555555555555');
    withCrypto({ ...realCrypto, randomUUID: spy });
    expect(randomUUID()).toBe('11111111-2222-4333-8444-555555555555');
    expect(spy).toHaveBeenCalled();
  });

  it('works when crypto.randomUUID is absent — the insecure-context case', () => {
    // This is the real failure: a LAN browser on http://192.168.1.211:5656 is
    // not a secure context, so the browser does not define crypto.randomUUID
    // at all. Calling it threw and killed ServerConnection.activate().
    withCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    expect(randomUUID()).toMatch(UUID_V4);
  });

  it('works with no Web Crypto whatsoever', () => {
    withCrypto(undefined);
    expect(randomUUID()).toMatch(UUID_V4);
  });

  it('does not collide across many draws in the fallback path', () => {
    withCrypto({ getRandomValues: realCrypto.getRandomValues.bind(realCrypto) });
    const seen = new Set(Array.from({ length: 5000 }, () => randomUUID()));
    expect(seen.size).toBe(5000);
  });

  it('still yields distinct ids when only Math.random is available', () => {
    withCrypto(undefined);
    const seen = new Set(Array.from({ length: 2000 }, () => randomUUID()));
    expect(seen.size).toBe(2000);
  });
});
