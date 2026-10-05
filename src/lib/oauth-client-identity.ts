// What the OAuth consent screen may say about who is asking, and where it is
// allowed to send the user afterwards. Pure, unit-tested.
//
// Everything on the consent page arrives in its own URL, so none of it is
// trusted by itself. The two facts worth showing are derived here rather than
// read from a separate parameter that could say anything:
//
//  - A client_id that is an https URL (a Client ID Metadata Document — what
//    Claude uses by default) is the address the server fetched the client's
//    details from. Its host is the one claim about identity a third party
//    cannot forge, so it is shown beside the self-asserted name.
//  - A redirect back to localhost goes to whatever program is listening on
//    this computer. That is how desktop and command-line apps sign in, but
//    any local program can claim to be one, so it is called out.

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Schemes that would run in, or replace, homecast.cloud if navigated to.
const UNSAFE_PROTOCOLS = new Set(['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:', 'filesystem:']);

/** The host a URL client_id was fetched from, or null for a registered client. */
export function clientIdHost(clientId: string | null | undefined): string | null {
  if (!clientId || !clientId.startsWith('https://')) return null;
  try {
    const host = new URL(clientId).hostname;
    return host || null;
  } catch {
    return null;
  }
}

/** True when the redirect returns to a program on this computer. */
export function isLoopbackRedirect(redirectUri: string | null | undefined): boolean {
  if (!redirectUri) return false;
  try {
    const url = new URL(redirectUri);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** Whether the page may navigate to `url`. The server validates redirects
 *  too; this is the last line, because `location.href = 'javascript:…'`
 *  would run with this page's session. */
export function isSafeNavigation(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    return !UNSAFE_PROTOCOLS.has(new URL(url).protocol);
  } catch {
    return false;
  }
}
