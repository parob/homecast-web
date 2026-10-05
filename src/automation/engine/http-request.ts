// HTTP Request (fire_webhook) helpers — pure, so the executor's network path
// stays small and these stay testable without a fetch mock.

import type { HttpAuth } from '../types/automation';

/** The header an auth setting sends. Field values are already resolved. */
export function authHeader(auth: HttpAuth): { name: string; value: string } {
  switch (auth.type) {
    case 'bearer':
      return { name: 'Authorization', value: `Bearer ${auth.token}` };
    case 'api_key':
      return { name: auth.header || 'X-API-Key', value: auth.value };
    case 'basic':
      return { name: 'Authorization', value: `Basic ${base64Utf8(`${auth.username}:${auth.password}`)}` };
  }
}

// btoa takes Latin-1 only; a password with an emoji or a non-Latin letter in
// it would throw rather than send.
function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function hasHeader(headers: Record<string, string>, name: string): boolean {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

/** Header names whose values are credentials by any reasonable reading. */
const SECRET_HEADER = /auth|token|secret|key|password|cookie|session/i;

export const REDACTED = '[redacted]';

/**
 * The request's headers as a trace may show them: every name kept, so "was
 * the auth sent?" is answerable, and every credential's value replaced.
 *
 * `alsoSecret` names a header the user chose for an API key, which can be
 * called anything — the pattern above is the fallback, not the guarantee.
 */
export function redactHeaders(headers: Record<string, string>, alsoSecret: string[] = []): Record<string, string> {
  const extra = new Set(alsoSecret.map((n) => n.toLowerCase()));
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      SECRET_HEADER.test(name) || extra.has(name.toLowerCase()) ? REDACTED : value,
    ]),
  );
}
