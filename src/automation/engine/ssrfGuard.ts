// SSRF protection for outbound HTTP requests from user-authored automations.
//
// The relay runs inside the user's Mac and has line-of-sight to localhost, the
// LAN, and the relay's own HTTP server (localhost:5656). Without guards, a
// FireWebhook / HTTP Request node with a templated URL lets automation authors
// (or anyone who can post to a webhook trigger) pivot into internal services
// and exfiltrate response bodies through downstream nodes.
//
// This module parses and validates a URL. It rejects:
//   - non-http/https schemes (file:, ftp:, data:, chrome:, about:)
//   - loopback (127.0.0.0/8, ::1)
//   - link-local (169.254.0.0/16, fe80::/10)
//   - RFC1918 and RFC4193 (10/8, 172.16/12, 192.168/16, fc00::/7)
//   - broadcast (255.255.255.255)
//   - numeric-encoded IPs (decimal, octal, hex) that evade string checks
//   - IPv4-mapped IPv6 (::ffff:…)
//   - bare hostnames without a dot (e.g. `localhost`, `router`, `homeassistant`)
//
// Call `assertSafeOutboundUrl(url)` before any `fetch()` that was driven by
// user-controlled input. Throws if the URL is blocked.

export class BlockedOutboundUrlError extends Error {
  constructor(reason: string) {
    super(`[SSRF] Blocked outbound URL: ${reason}`);
    this.name = 'BlockedOutboundUrlError';
  }
}

export function assertSafeOutboundUrl(rawUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new BlockedOutboundUrlError(`invalid URL: ${truncate(rawUrl)}`);
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    throw new BlockedOutboundUrlError(`scheme "${parsed.protocol}" not allowed`);
  }

  const host = parsed.hostname.toLowerCase();
  if (!host) throw new BlockedOutboundUrlError('missing host');

  const ipv4 = parseIPv4Any(host);
  if (ipv4 !== null) {
    if (isPrivateIPv4(ipv4)) {
      throw new BlockedOutboundUrlError(`IPv4 ${ipv4Str(ipv4)} is in a private/loopback/link-local range`);
    }
    return;
  }

  if (host.startsWith('[') || host.includes(':')) {
    const ipv6 = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if (isPrivateIPv6(ipv6)) {
      throw new BlockedOutboundUrlError(`IPv6 ${ipv6} is in a private/loopback/link-local range`);
    }
    return;
  }

  if (!host.includes('.')) {
    throw new BlockedOutboundUrlError(`bare hostname "${host}" not allowed (no dots) — likely resolves to a LAN device`);
  }

  const lowered = host;
  if (lowered === 'localhost' || lowered.endsWith('.localhost') || lowered.endsWith('.local') || lowered.endsWith('.internal') || lowered.endsWith('.lan') || lowered.endsWith('.home') || lowered.endsWith('.home.arpa')) {
    throw new BlockedOutboundUrlError(`hostname "${host}" is an internal/LAN TLD`);
  }
}

function truncate(s: string, n = 100): string {
  return s.length > n ? s.slice(0, n) + '…' : s;
}

/**
 * Parse any of the legal IPv4 string forms: dotted decimal, dotted octal,
 * dotted hex, or a single decimal/octal/hex integer representing the whole
 * 32-bit address. Returns the unsigned 32-bit integer, or null if not IPv4.
 *
 * URL hostnames are typically already normalized by the URL parser, but
 * different runtimes handle these forms differently, so we do our own parse.
 */
function parseIPv4Any(host: string): number | null {
  const parts = host.split('.');
  if (parts.length === 4) {
    let out = 0;
    for (const p of parts) {
      const byte = parseNumericByte(p);
      if (byte === null || byte < 0 || byte > 255) return null;
      out = (out << 8 | byte) >>> 0;
    }
    return out;
  }
  if (parts.length === 1) {
    const whole = parseNumericWhole(parts[0]);
    if (whole === null) return null;
    if (whole < 0 || whole > 0xFFFFFFFF) return null;
    return whole >>> 0;
  }
  return null;
}

function parseNumericByte(s: string): number | null {
  if (!s) return null;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  if (/^0[0-7]+$/.test(s)) return parseInt(s, 8);
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  return null;
}

function parseNumericWhole(s: string): number | null {
  if (!s) return null;
  if (/^0x[0-9a-f]+$/i.test(s)) return parseInt(s, 16);
  if (/^0[0-7]+$/.test(s)) return parseInt(s, 8);
  if (/^[0-9]+$/.test(s)) return parseInt(s, 10);
  return null;
}

function ipv4Str(n: number): string {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

function isPrivateIPv4(ip: number): boolean {
  // 0.0.0.0/8
  if (((ip >>> 24) & 0xff) === 0) return true;
  // 10.0.0.0/8
  if (((ip >>> 24) & 0xff) === 10) return true;
  // 127.0.0.0/8
  if (((ip >>> 24) & 0xff) === 127) return true;
  // 169.254.0.0/16 (link-local)
  if (((ip >>> 16) & 0xffff) === ((169 << 8) | 254)) return true;
  // 172.16.0.0/12
  if (((ip >>> 24) & 0xff) === 172 && ((ip >>> 20) & 0xf) === 1) return true;
  // 192.168.0.0/16
  if (((ip >>> 16) & 0xffff) === ((192 << 8) | 168)) return true;
  // 100.64.0.0/10 (CGNAT)
  if (((ip >>> 24) & 0xff) === 100 && ((ip >>> 22) & 0x3) === 1) return true;
  // 224.0.0.0/4 (multicast)
  if (((ip >>> 28) & 0xf) >= 0xE) return true;
  // 255.255.255.255
  if (ip === 0xffffffff) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fe80:') || lower.startsWith('fe80::')) return true;
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // IPv4-mapped: ::ffff:a.b.c.d (may be normalized by URL parser to hex-colon form, e.g. ::ffff:7f00:1)
  const mapped = lower.match(/^::ffff:(.+)$/);
  if (mapped) {
    const inner = mapped[1];
    const asDotted = parseIPv4Any(inner);
    if (asDotted !== null && isPrivateIPv4(asDotted)) return true;
    // Hex-colon form: "7f00:1"
    const hexPair = inner.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexPair) {
      const hi = parseInt(hexPair[1], 16);
      const lo = parseInt(hexPair[2], 16);
      if (!isNaN(hi) && !isNaN(lo) && isPrivateIPv4(((hi << 16) | lo) >>> 0)) return true;
    }
  }
  return false;
}
