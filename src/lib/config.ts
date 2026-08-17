const isPrivateIP = (h: string) =>
  /^(10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.)/.test(h);

/**
 * Community mode detection.
 *
 * Primary: server-injected flag (works with tunnels like Cloudflare).
 * The local HTTP server injects `window.__HOMECAST_COMMUNITY__ = true`
 * into index.html and serves `/config.json` with `{ mode: "community" }`.
 *
 * Fallback: hostname detection (localhost, .local, private IPs).
 */
// Dev-only escape hatch: `?cloud=1` on the dev server forces cloud mode so
// marketing pages (/how-it-works, /pricing, …) can be previewed on localhost.
// Compiled out of production builds (import.meta.env.DEV is false there).
const forceCloud =
  !!(window as any).__HOMECAST_FORCE_CLOUD__ ||
  (import.meta.env.DEV && new URLSearchParams(window.location.search).get('cloud') === '1');

export const isCommunity: boolean =
  !forceCloud && (
    !!(window as any).__HOMECAST_COMMUNITY__ ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1' ||
    window.location.hostname.endsWith('.local') ||
    isPrivateIP(window.location.hostname)
  );

/**
 * The relay origin handed down by the native shell, when there is one.
 *
 * iOS serves this web app from the phone's *own* loopback server and points
 * only its API calls at the relay, so "which relay" has to cross from Swift.
 * It used to cross only as injected localStorage, which made a silent
 * catastrophe possible: if that write did not stick — cleared by a mode
 * switch, a fresh container, anything — `getCommunityMode()` returned null,
 * the app fell back to same-origin, and the phone started talking to its own
 * loopback server. That server has no bridge on iOS, so every GraphQL call
 * hung until it timed out and the UI reported the relay as unreachable while
 * the relay was perfectly healthy.
 *
 * A window global set at document start cannot be cleared by page code and is
 * present before this module is evaluated, so it is the authority when set.
 */
function nativeRelayOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  return (window as any).__HOMECAST_RELAY_ORIGIN__ || null;
}

// --- Community mode: relay vs client ---
// Set during first-launch setup. 'relay' = this device runs the relay.
// 'client' = this device connects to a remote relay.
export function getCommunityMode(): 'relay' | 'client' | null {
  if (!isCommunity) return null;
  // The shell told us which relay to use; that settles it.
  if (nativeRelayOrigin()) return 'client';
  return (localStorage.getItem('homecast-mode') as 'relay' | 'client') || null;
}
export function isRelayMode(): boolean { return getCommunityMode() === 'relay'; }
export function isClientMode(): boolean { return getCommunityMode() === 'client'; }
export function isRelaySetupComplete(): boolean { return !!localStorage.getItem('homecast-relay-setup'); }

/**
 * `192.168.1.5:5656` → `http://192.168.1.5:5656`; anything already carrying a
 * scheme keeps it, so a relay reached over HTTPS stays HTTPS.
 *
 * `URL.origin` drops a default port, which is what lets the WebSocket rule
 * below tell "explicit port" (LAN, mesh VPN) from "443/80" (behind a proxy).
 */
export function normalizeRelayOrigin(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    return new URL(withScheme).origin;
  } catch {
    return withScheme;
  }
}

/**
 * The relay this device connects to, as a full origin.
 *
 * This was stored as bare `host:port` before remote access was supported, so a
 * value with no scheme is read as http — exactly what those installs were
 * already doing implicitly. No migration step needed.
 */
export function getRelayAddress(): string | null {
  const raw = nativeRelayOrigin() || localStorage.getItem('homecast-relay-address');
  return raw ? normalizeRelayOrigin(raw) : null;
}

/** The relay's real WebSocket port, as reported by /health or Bonjour TXT. */
export function getRelayWsPort(): number | null {
  const raw = localStorage.getItem('homecast-relay-ws-port');
  const parsed = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function resolveApiBase(): string {
  // Build-time override (local dev)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // Community client mode: point to the remote relay. The stored value is a
  // full origin, so a relay reached over HTTPS — a tunnel, a VPN, a public
  // host — is used as given rather than forced back down to http.
  if (isCommunity && isClientMode()) {
    const addr = getRelayAddress();
    if (addr) return addr;
  }

  // Community mode: API is on the same origin as the web app
  if (isCommunity) return `${window.location.protocol}//${window.location.host}`;

  const host = window.location.hostname;
  if (host === 'staging.homecast.cloud' || host === 'staging.mqtt.homecast.cloud') return 'https://staging.api.homecast.cloud';
  if (host === 'homecast.cloud' || host === 'www.homecast.cloud' || host === 'mqtt.homecast.cloud') return 'https://api.homecast.cloud';

  // Local dev fallback
  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

function resolveWebBase(): string {
  const host = window.location.hostname;
  if (host === 'staging.homecast.cloud' || host === 'staging.mqtt.homecast.cloud') return 'https://staging.homecast.cloud';
  if (host === 'homecast.cloud' || host === 'www.homecast.cloud' || host === 'mqtt.homecast.cloud') return 'https://homecast.cloud';
  return `${window.location.protocol}//${window.location.host}`;
}

const API_BASE = resolveApiBase();
const WEB_BASE = resolveWebBase();
// Follow the scheme rather than guessing from the hostname: an https origin
// always means wss, wherever it is served from.
const WS_BASE = API_BASE.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');

/**
 * Where a Community relay's WebSocket lives.
 *
 * The relay serves HTTP and WebSocket on two separate ports (WS = HTTP + 1).
 * That is fine on a LAN, but a reverse proxy presenting one hostname on 443
 * has no second port to offer — so the shape of the origin decides:
 *
 *   explicit port    → same host, the relay's real WS port  (LAN, mesh VPN)
 *   no port (443/80) → same origin /ws, which the proxy routes to the WS port
 *
 * The real port comes from /health or Bonjour TXT when we have it; HTTP + 1 is
 * only a fallback for relays that never reported one.
 *
 * `homecast-relay-ws-url` overrides both, for topologies neither rule fits.
 */
export function communityWsUrl(origin: string): string {
  const override = localStorage.getItem('homecast-relay-ws-url');
  if (override) return override;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return `${WS_BASE}/ws`;
  }
  const scheme = url.protocol === 'https:' ? 'wss:' : 'ws:';

  if (!url.port) return `${scheme}//${url.host}/ws`;

  const wsPort = getRelayWsPort() ?? parseInt(url.port, 10) + 1;
  return `${scheme}//${url.hostname}:${wsPort}/ws`;
}

function resolveWsUrl(): string {
  if (isCommunity) {
    if (isClientMode()) {
      const addr = getRelayAddress();
      if (addr) return communityWsUrl(addr);
    }
    // Served by the relay itself — its own origin is the relay's origin.
    return communityWsUrl(window.location.origin);
  }
  return `${WS_BASE}/ws`;
}

export const config = {
  apiUrl: API_BASE,
  webUrl: WEB_BASE,
  wsUrl: resolveWsUrl(),
  graphqlUrl: `${API_BASE}/`,
  isStaging: window.location.hostname.includes('staging'),
  isCommunity,
  version: import.meta.env.VITE_COMMIT_SHA || 'dev',
  appStoreUrl: 'https://apps.apple.com/us/app/homecast-app/id6759559232?platform=mac',
};
