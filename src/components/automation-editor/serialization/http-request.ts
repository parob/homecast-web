// Automation Editor - HTTP Request <-> editor config
//
// The panel has always offered a body and three kinds of auth, but the
// serializers carried only the URL and method: whatever was typed there was
// dropped on save and never sent. Conversion lives here, shared by both
// serializers and the config panel, like if-condition.ts.

import type { FireWebhookAction, HttpAuth } from '@/automation/types/automation';

/** The panel's default when no API key header name was typed. */
export const DEFAULT_API_KEY_HEADER = 'X-API-Key';

/**
 * Whether the panel shows a body for this method. Saving follows the same
 * rule, so a body left over from before switching to GET is not sent unseen.
 */
export function methodTakesBody(method: string | undefined): boolean {
  const m = method ?? 'POST';
  return m !== 'GET' && m !== 'DELETE';
}

/** The panel's auth fields as the engine's auth, or undefined for "None". */
export function httpConfigToAuth(config: Record<string, unknown>): HttpAuth | undefined {
  switch (config.authMode) {
    case 'bearer':
      return { type: 'bearer', token: (config.authToken as string) ?? '' };
    case 'api_key':
      return {
        type: 'api_key',
        header: (config.authHeaderName as string) || DEFAULT_API_KEY_HEADER,
        value: (config.authHeaderValue as string) ?? '',
      };
    case 'basic':
      return {
        type: 'basic',
        username: (config.authUsername as string) ?? '',
        password: (config.authPassword as string) ?? '',
      };
    default:
      return undefined;
  }
}

export function httpAuthToConfig(auth: HttpAuth | undefined): Record<string, unknown> {
  switch (auth?.type) {
    case 'bearer':
      return { authMode: 'bearer', authToken: auth.token };
    case 'api_key':
      return { authMode: 'api_key', authHeaderName: auth.header, authHeaderValue: auth.value };
    case 'basic':
      return { authMode: 'basic', authUsername: auth.username, authPassword: auth.password };
    default:
      return {};
  }
}

/**
 * The body as the panel's textarea holds it. An object body (written by hand
 * or through the API) becomes its JSON text, which the engine reads back as
 * the same JSON on the next run.
 */
export function httpBodyToConfig(body: FireWebhookAction['body']): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  return typeof body === 'string' ? body : JSON.stringify(body, null, 2);
}
