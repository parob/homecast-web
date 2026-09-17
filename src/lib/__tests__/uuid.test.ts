import { describe, it, expect, afterEach, vi } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
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

describe('nothing but lib/uuid calls crypto.randomUUID', () => {
  // Every call site was migrated in August 2026; useCameraLive reintroduced one
  // in #175 and a phone on the dev server crashed opening a camera. The relay
  // Mac never reproduces it (WKWebView on localhost is a secure context), so
  // only a test can catch it before a LAN client does.
  it('finds no raw call outside src/lib/uuid.ts', () => {
    const root = new URL('../../', import.meta.url).pathname;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) { if (entry.name !== '__tests__') walk(path); continue; }
        if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) continue;
        const rel = relative(root, path);
        if (rel === 'lib/uuid.ts') continue;
        if (/\bcrypto\s*\.\s*randomUUID\s*\(/.test(readFileSync(path, 'utf8'))) offenders.push(rel);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
