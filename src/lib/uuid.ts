/**
 * A UUID v4 that works outside a secure context.
 *
 * `crypto.randomUUID` is declared `[SecureContext]`, so the browser only
 * defines it on HTTPS origins and on localhost. The main way anyone reaches a
 * Community relay is neither: a browser on the LAN opening
 * `http://192.168.1.211:5656`. There `crypto.randomUUID` is simply absent, and
 * calling it throws `TypeError: crypto.randomUUID is not a function`.
 *
 * That killed `ServerConnection.activate()` — `getDeviceId()` is the first
 * thing it calls — so a LAN browser got no WebSocket, no live updates, and one
 * console error explaining none of it.
 *
 * `crypto.getRandomValues` is **not** secure-context-gated (unlike
 * `crypto.randomUUID` and `crypto.subtle`), so the fallback is still
 * cryptographically random. `Math.random` is the last resort for an
 * environment that has no Web Crypto at all, and only affects id uniqueness,
 * never anything security-bearing — the relay's own hashing and token signing
 * run in the WKWebView on localhost, which is a secure context.
 */
export function randomUUID(): string {
  const webCrypto = globalThis.crypto as Crypto | undefined;

  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof webCrypto?.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }

  // RFC 4122 §4.4: version 4 in the high nibble of byte 6, variant 10x in the
  // top bits of byte 8. Without these the string is random but not a valid
  // UUID, and anything that parses it round-trips a different value.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i++) {
    hex.push(bytes[i].toString(16).padStart(2, '0'));
  }

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-');
}
