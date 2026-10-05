import { describe, it, expect } from 'vitest';
import { clientIdHost, isLoopbackRedirect, isSafeNavigation } from '../oauth-client-identity';

describe('clientIdHost', () => {
  it('names the host a URL client_id was fetched from', () => {
    expect(clientIdHost('https://claude.ai/oauth/mcp-oauth-client-metadata')).toBe('claude.ai');
    expect(clientIdHost('https://app.example.com:8443/client.json')).toBe('app.example.com');
  });

  it('is null for a registered client — the consent page looks as it always has', () => {
    expect(clientIdHost('3f1c2b9e-7a1d-4a8e-9a55-2b6f0f3a1c11')).toBeNull();
    expect(clientIdHost('')).toBeNull();
    expect(clientIdHost(undefined)).toBeNull();
  });

  it('ignores anything but https', () => {
    expect(clientIdHost('http://claude.ai/oauth/x')).toBeNull();
    expect(clientIdHost('javascript://claude.ai/%0Aalert(1)')).toBeNull();
  });

  it('reports the real host, not one embedded in userinfo', () => {
    expect(clientIdHost('https://claude.ai@evil.example/x')).toBe('evil.example');
  });
});

describe('isLoopbackRedirect', () => {
  it('flags a return to this computer', () => {
    expect(isLoopbackRedirect('http://localhost:3118/callback')).toBe(true);
    expect(isLoopbackRedirect('http://127.0.0.1:50123/callback')).toBe(true);
    expect(isLoopbackRedirect('http://[::1]:4000/cb')).toBe(true);
  });

  it('does not flag a website', () => {
    expect(isLoopbackRedirect('https://claude.ai/api/mcp/auth_callback')).toBe(false);
    expect(isLoopbackRedirect('http://localhost.evil.example/cb')).toBe(false);
    expect(isLoopbackRedirect('not a url')).toBe(false);
    expect(isLoopbackRedirect('')).toBe(false);
  });
});

describe('isSafeNavigation', () => {
  it('allows web and native-app redirects', () => {
    expect(isSafeNavigation('https://claude.ai/api/mcp/auth_callback?code=x')).toBe(true);
    expect(isSafeNavigation('http://localhost:3118/callback?code=x')).toBe(true);
    expect(isSafeNavigation('cursor://anysphere.cursor-retrieval/oauth/callback?code=x')).toBe(true);
  });

  it('refuses script and document-replacing schemes, however they are spelled', () => {
    expect(isSafeNavigation('javascript://x/%0Aalert(1)')).toBe(false);
    expect(isSafeNavigation('JavaScript:alert(1)')).toBe(false);
    expect(isSafeNavigation('java\tscript:alert(1)')).toBe(false);
    expect(isSafeNavigation(' javascript:alert(1)')).toBe(false);
    expect(isSafeNavigation('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(isSafeNavigation('vbscript:msgbox(1)')).toBe(false);
  });

  it('refuses nothing at all', () => {
    expect(isSafeNavigation('')).toBe(false);
    expect(isSafeNavigation(undefined)).toBe(false);
    expect(isSafeNavigation('/relative/path')).toBe(false);
  });
});
