/**
 * Community mode: handles requests from external WebSocket clients.
 *
 * Swift's LocalNetworkBridge forwards incoming WebSocket messages here via
 * window.__localserver_request(clientId, message). We process the request
 * (HomeKit action, GraphQL, subscribe, etc.) and send the response back
 * via window.__localserver_respond(clientId, response).
 *
 * This runs inside the Mac app's WKWebView — NOT in external browsers.
 */

import { communityRequest, recordCommunityActivity, setCommunityClientCount } from './connection';
import { isCommunity } from '../lib/config';
import { handleGraphQL } from './local-graphql';
import { handleREST } from './local-rest';

// Type for the protocol messages (same as cloud WebSocket protocol)
interface ProtocolMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  action: string;
  payload?: Record<string, unknown>;
}

// Track connected external clients
const connectedClients = new Set<string>();
// Track authenticated WS clients (when auth is enabled)
const authenticatedClients = new Set<string>();

// Cached auth-enabled flag (async IndexedDB read, refreshed on change)
let authEnabledCache = false;
// What the user calls this relay. Empty means "no custom name", and the native
// side falls back to the hostname rather than advertising a blank row.
let relayNameCache = '';

/** Refresh the cached auth-enabled flag from IndexedDB. */
export async function refreshAuthEnabled(): Promise<void> {
  try {
    const { getSetting } = await import('./local-db');
    authEnabledCache = (await getSetting('auth-enabled')) === 'true';
  } catch {
    authEnabledCache = false;
  }
  publishAuthState();
}

/**
 * Refresh the relay's display name from IndexedDB and re-advertise it.
 *
 * Clients used to have only the Bonjour instance name, which a relay reached
 * by a typed address never carries — so a relay on a VPN was nameless. Like the
 * auth flag, the setting lives in IndexedDB where Swift cannot read it.
 */
export async function refreshRelayName(): Promise<void> {
  try {
    const { getSetting } = await import('./local-db');
    relayNameCache = (await getSetting('relay-name')) || '';
  } catch {
    relayNameCache = '';
  }
  publishAuthState();
}

/**
 * Tell the native server whether we require a login, so it can say so in its
 * Bonjour TXT record and on /health. The setting lives in IndexedDB, which is
 * only reachable from here — Swift cannot read it, so it has to be pushed.
 * Every path that refreshes the cache goes through here, so the advertisement
 * cannot drift from the setting.
 */
function publishAuthState(): void {
  const win = window as Window & {
    webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } };
  };
  win.webkit?.messageHandlers?.localServer?.postMessage({
    action: 'advertise',
    authEnabled: authEnabledCache,
    name: relayNameCache,
  });
}

/** Whether the relay requires authentication for external clients. */
export function isAuthRequired(): boolean {
  return authEnabledCache;
}

/**
 * Check if the relay has been set up.
 * If not, the entire Community system is "offline" — external clients get errors.
 */
function isRelaySetUp(): boolean {
  return !!localStorage.getItem('homecast-relay-setup');
}

/** Verify a JWT token. Returns user info or null. */
async function verifyClientToken(token: string | undefined): Promise<{ sub: string; name: string; role: string } | null> {
  if (!token) return null;
  const jwt = token.replace(/^Bearer\s+/i, '');
  if (!jwt || jwt === 'community') return null;
  const { verifyToken } = await import('./local-auth');
  return verifyToken(jwt);
}

// GraphQL operations that never require auth
const AUTH_EXEMPT_OPS = new Set([
  'IsOnboarded', 'GetVersion', 'Login', 'Signup', 'GetAuthEnabled',
]);

/**
 * Initialize the local server handler.
 * Called once when the web app starts in Community mode on the relay Mac.
 */
export function initLocalServer(): void {
  if (!isCommunity) return;

  // Only run on the relay Mac (has the native bridge)
  const w = window as Window & {
    isHomeKitRelayCapable?: boolean;
    __localserver_handler?: (clientId: string, msg: ProtocolMessage) => void;
    __localserver_disconnect_handler?: (clientId: string) => void;
    __localserver_graphql_handler?: (clientId: string, request: { operationName?: string; query?: string; variables?: Record<string, unknown>; authorization?: string }) => void;
    __localserver_http_handler?: (clientId: string, request: { method: string; path: string; body?: string; authorization?: string }) => void;
    __homecast_relay_action?: (action: string, payload?: Record<string, unknown>) => Promise<unknown>;
  };

  if (!w.isHomeKitRelayCapable) return;

  // This device is serving the relay, which is the whole of what the flag
  // means. It used to be written only on the "auth is disabled" path in
  // AuthContext, so switching authentication *on* made isRelaySetUp() false
  // and the relay began answering every external GraphQL, REST and WebSocket
  // call with "Server not configured" — the opposite of what enabling auth is
  // supposed to do.
  //
  // Only the setup flag, and never `homecast-mode`: every Mac reports
  // isHomeKitRelayCapable, including one pointed at somebody else's relay, and
  // writing 'relay' there would drop it out of client mode.
  if (localStorage.getItem('homecast-mode') !== 'client') {
    localStorage.setItem('homecast-relay-setup', 'true');
  }

  // Load auth-enabled flag and relay name from IndexedDB. Both are pushed down
  // to Swift, which cannot read IndexedDB itself.
  refreshAuthEnabled();
  refreshRelayName();

  // Anonymous usage reporting. Started here rather than in main.tsx because
  // this is the one point that has already established the relay gate — a
  // phone, a LAN browser and a Mac in client mode all return above, so a
  // household reports once instead of once per device.
  void import('./local-telemetry').then(m => m.initTelemetry());

  // Community mode has no ServerWebSocket, so nothing else starts the automation
  // engine here. Without this, Homecast automations are stored but never run.
  // Imported lazily to keep the engine out of the main bundle for the browser
  // clients that never run it (same reason local-handler defers it).
  void import('./community-automation').then(m => m.initCommunityAutomationEngine());

  w.__localserver_handler = (clientId: string, msg: ProtocolMessage) => {
    handleRequest(clientId, msg);
  };

  // The relay action path, as a promise a native caller can await.
  //
  // The MQTT bridge lives in Swift and used to reach HomeKit through
  // `window.homekit` — the raw native bridge, which is one layer below this
  // one. That layer only knows about HomeKit's own accessories, so helper
  // accessories (engine-owned, and therefore only ever visible from JS) were
  // absent from MQTT while every other Community surface had them. Going
  // through the same executor the WebSocket, REST and MCP paths use is what
  // makes MQTT show the same set of accessories as everything else.
  w.__homecast_relay_action = async (action: string, payload?: Record<string, unknown>) => {
    const { executeHomeKitAction } = await import('../relay/local-handler');
    return executeHomeKitAction(action, payload ?? {});
  };

  w.__localserver_disconnect_handler = (clientId: string) => {
    connectedClients.delete(clientId);
    authenticatedClients.delete(clientId);
    setCommunityClientCount(connectedClients.size);
  };

  // GraphQL handler — called by Swift when an HTTP POST / request arrives.
  // Device-control actions have their own auth check on the WebSocket handler;
  // here we also pass the Authorization header down to handleGraphQL so that,
  // when auth is enabled, non-public mutations are rejected for unauthenticated
  // callers. (The Swift HTTP front-end on older builds does not yet forward
  // the Authorization header on this path; once it does, this is fully wired.)
  w.__localserver_graphql_handler = async (clientId: string, request) => {
    recordCommunityActivity();
    const win = window as Window & { webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } } };

    // Gate: relay must be set up (except status check ops)
    if (!isRelaySetUp() && !AUTH_EXEMPT_OPS.has(request.operationName || '')) {
      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'graphqlResponse', clientId,
        response: JSON.stringify({ data: null, errors: [{ message: 'Server not configured' }] }),
      });
      return;
    }

    const result = await handleGraphQL({
      operationName: request.operationName,
      query: request.query,
      variables: request.variables,
      authorization: request.authorization,
    });
    win.webkit?.messageHandlers?.localServer?.postMessage({
      action: 'graphqlResponse',
      clientId,
      response: JSON.stringify(result),
    });
  };

  // HTTP handler — called by Swift for REST, MCP, OAuth requests
  w.__localserver_http_handler = async (clientId: string, request) => {
    recordCommunityActivity();
    const win = window as Window & { webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } } };

    // OAuth API endpoints are always accessible (needed before setup)
    const httpPath = request.path.split('?')[0];

    // /oauth/consent is a frontend SPA route — tell Swift to serve index.html
    if (httpPath === '/oauth/consent') {
      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'httpResponse', clientId,
        response: JSON.stringify({ _serveSPA: true }),
      });
      return;
    }

    const isOAuthAPI = httpPath.startsWith('/oauth/') || httpPath === '/register' || httpPath.startsWith('/.well-known/');
    if (isOAuthAPI) {
      try {
        const { handleOAuth } = await import('./local-oauth');
        const result = await handleOAuth(request);
        win.webkit?.messageHandlers?.localServer?.postMessage({
          action: 'httpResponse', clientId,
          response: JSON.stringify(result),
        });
      } catch (e: any) {
        win.webkit?.messageHandlers?.localServer?.postMessage({
          action: 'httpResponse', clientId,
          response: JSON.stringify({ error: e.message || 'Internal error' }),
        });
      }
      return;
    }

    // Gate: relay must be set up (OAuth exempted above)
    if (!isRelaySetUp()) {
      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'httpResponse', clientId,
        response: JSON.stringify({ error: 'Server not configured. Set up the relay first.' }),
      });
      return;
    }

    // Gate: if auth is enabled, validate client token for REST/MCP
    if (authEnabledCache) {
      const authHeader = request.authorization || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      // Allow API tokens (hc_ prefix) — they have their own validation
      if (!token.startsWith('hc_')) {
        const user = await verifyClientToken(authHeader);
        if (!user) {
          win.webkit?.messageHandlers?.localServer?.postMessage({
            action: 'httpResponse', clientId,
            response: JSON.stringify({ error: 'Authentication required' }),
          });
          return;
        }
      }
    }

    try {
      let result: unknown;
      const path = request.path.split('?')[0];

      if (path === '/mcp' && request.method === 'POST') {
        const { handleMCP } = await import('./local-mcp');
        const mcpResult = await handleMCP(request.body || '{}');
        win.webkit?.messageHandlers?.localServer?.postMessage({
          action: 'httpResponse', clientId,
          response: mcpResult,
        });
        return;
      }

      if (path.startsWith('/rest/')) {
        // Validate API token auth (hc_ tokens)
        const authHeader = request.authorization || '';
        const token = authHeader.replace(/^Bearer\s+/i, '');
        if (token && token.startsWith('hc_')) {
          const { validateToken } = await import('./local-tokens');
          const valid = await validateToken(token);
          if (!valid) {
            win.webkit?.messageHandlers?.localServer?.postMessage({
              action: 'httpResponse', clientId,
              response: JSON.stringify({ error: 'Invalid or expired token' }),
            });
            return;
          }
        }
        result = await handleREST(request);
      } else {
        result = { error: 'Not found' };
      }

      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'httpResponse', clientId,
        response: JSON.stringify(result),
      });
    } catch (e: any) {
      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'httpResponse', clientId,
        response: JSON.stringify({ error: e.message || 'Internal error' }),
      });
    }
  };
}

async function handleRequest(clientId: string, msg: ProtocolMessage): Promise<void> {
  const wasNew = !connectedClients.has(clientId);
  connectedClients.add(clientId);
  if (wasNew) setCommunityClientCount(connectedClients.size);

  const respond = (window as any).__localserver_respond;

  // Gate: relay must be set up
  if (!isRelaySetUp()) {
    respond?.(clientId, {
      id: (msg as any).id,
      type: 'response',
      action: (msg as any).action,
      error: { code: 'NOT_CONFIGURED', message: 'Homecast server is not set up yet.' },
    });
    return;
  }

  // Handle shared WebSocket protocol (different format — no auth required)
  if ((msg as any).type === 'subscribe' && (msg as any).shareHash) {
    respond?.(clientId, { type: 'subscribed', shareHash: (msg as any).shareHash });
    return;
  }
  if ((msg as any).type === 'ping') {
    respond?.(clientId, { type: 'pong' });
    return;
  }

  if (msg.type !== 'request') {
    console.warn(`[LocalServer] Unexpected message type: ${msg.type}`);
    return;
  }

  if (!respond) return;

  // Handle authenticate action — client sends token to register as authenticated
  if (msg.action === 'authenticate') {
    const token = msg.payload?.token as string | undefined;
    const user = await verifyClientToken(token);
    if (user) {
      authenticatedClients.add(clientId);
      respond(clientId, { id: msg.id, type: 'response', action: 'authenticate', payload: { success: true, name: user.name } });
    } else {
      respond(clientId, { id: msg.id, type: 'response', action: 'authenticate', error: { code: 'AUTH_FAILED', message: 'Invalid token' } });
    }
    return;
  }

  // Gate: if auth is enabled, require authenticated client for HomeKit actions
  // Allow protocol actions (subscribe, ping, etc.) without auth
  if (authEnabledCache && msg.action !== 'subscribe' && msg.action !== 'unsubscribe' &&
      msg.action !== 'subscriptions.list' && msg.action !== 'ping') {
    if (!authenticatedClients.has(clientId)) {
      respond(clientId, {
        id: msg.id,
        type: 'response',
        action: msg.action,
        error: { code: 'AUTH_REQUIRED', message: 'Authentication required' },
      });
      return;
    }
  }

  try {
    let result: unknown;

    switch (msg.action) {
      case 'subscribe':
        result = { subscriptions: (msg.payload?.scopes as Array<{type: string; id: string}> ?? []).map(s => ({
          type: s.type,
          id: s.id,
          expiresAt: Date.now() + 300000,
        }))};
        break;

      case 'unsubscribe':
        result = { success: true };
        break;

      case 'subscriptions.list':
        result = { subscriptions: [] };
        break;

      case 'ping':
        result = { pong: true, timestamp: Date.now() };
        break;

      default:
        result = await communityRequest(msg.action, msg.payload ?? {});
        break;
    }

    respond(clientId, {
      id: msg.id,
      type: 'response',
      action: msg.action,
      payload: result ?? {},
    });
  } catch (error: any) {
    respond(clientId, {
      id: msg.id,
      type: 'response',
      action: msg.action,
      error: {
        code: error.code || 'INTERNAL_ERROR',
        message: error.message || 'Unknown error',
      },
    });
  }
}

/**
 * Get the number of connected external clients.
 */
export function getConnectedClientCount(): number {
  return connectedClients.size;
}

/**
 * Clear all authenticated clients. Called when auth settings change
 * (enable auth, delete user, change password) to force re-authentication.
 */
export function clearAuthenticatedClients(): void {
  authenticatedClients.clear();
}
