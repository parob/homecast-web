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
export const isCommunity: boolean =
  !!(window as any).__HOMECAST_COMMUNITY__ ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1' ||
  window.location.hostname.endsWith('.local') ||
  isPrivateIP(window.location.hostname);

function resolveApiBase(): string {
  // Build-time override (local dev)
  if (import.meta.env.VITE_API_URL) return import.meta.env.VITE_API_URL;

  // Community mode: API is on the same origin as the web app
  if (isCommunity) return `${window.location.protocol}//${window.location.host}`;

  const host = window.location.hostname;
  if (host === 'staging.homecast.cloud') return 'https://staging.api.homecast.cloud';
  if (host === 'homecast.cloud' || host === 'www.homecast.cloud') return 'https://api.homecast.cloud';

  // Local dev fallback
  return `${window.location.protocol}//${window.location.hostname}:8080`;
}

function resolveWebBase(): string {
  const host = window.location.hostname;
  if (host === 'staging.homecast.cloud') return 'https://staging.homecast.cloud';
  if (host === 'homecast.cloud' || host === 'www.homecast.cloud') return 'https://homecast.cloud';
  return `${window.location.protocol}//${window.location.host}`;
}

const API_BASE = resolveApiBase();
const WEB_BASE = resolveWebBase();
const isLocal = API_BASE.includes('localhost') || API_BASE.includes('127.0.0.1');
const WS_BASE = API_BASE.replace(/^https?:/, isLocal ? 'ws:' : 'wss:');

// In Community mode, WebSocket runs on HTTP port + 1 (separate NWProtocolWebSocket listener)
function resolveWsUrl(): string {
  if (isCommunity) {
    const host = window.location.hostname;
    const httpPort = parseInt(window.location.port || '5656', 10);
    return `ws://${host}:${httpPort + 1}/ws`;
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
