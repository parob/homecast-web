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

import { communityRequest } from './connection';
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

/** Refresh the cached auth-enabled flag from IndexedDB. */
export async function refreshAuthEnabled(): Promise<void> {
  try {
    const { getSetting } = await import('./local-db');
    authEnabledCache = (await getSetting('auth-enabled')) === 'true';
  } catch {
    authEnabledCache = false;
  }
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
  'IsOnboarded', 'GetVersion',
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
  };

  if (!w.isHomeKitRelayCapable) return;

  console.log('[LocalServer] Initializing request handler');

  // Load auth-enabled flag from IndexedDB
  refreshAuthEnabled();

  w.__localserver_handler = (clientId: string, msg: ProtocolMessage) => {
    handleRequest(clientId, msg);
  };

  w.__localserver_disconnect_handler = (clientId: string) => {
    connectedClients.delete(clientId);
    authenticatedClients.delete(clientId);
    console.log(`[LocalServer] Client disconnected: ${clientId} (${connectedClients.size} remaining)`);
  };

  // GraphQL handler — called by Swift when an HTTP POST / request arrives
  // Note: Auth enforcement for device control is on the WebSocket handler, not here.
  // Swift doesn't pass the HTTP Authorization header to the JS bridge, so we can't
  // validate tokens on GraphQL requests. GraphQL ops are mostly UI/settings data.
  w.__localserver_graphql_handler = async (clientId: string, request) => {
    const win = window as Window & { webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } } };

    // Gate: relay must be set up (except status check ops)
    if (!isRelaySetUp() && !AUTH_EXEMPT_OPS.has(request.operationName || '')) {
      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'graphqlResponse', clientId,
        response: JSON.stringify({ data: null, errors: [{ message: 'Server not configured' }] }),
      });
      return;
    }

    const result = await handleGraphQL(request);
    win.webkit?.messageHandlers?.localServer?.postMessage({
      action: 'graphqlResponse',
      clientId,
      response: JSON.stringify(result),
    });
  };

  // HTTP handler — called by Swift for REST, MCP, OAuth requests
  w.__localserver_http_handler = async (clientId: string, request) => {
    const win = window as Window & { webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } } };

    // Gate: relay must be set up
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
      } else if (path.startsWith('/oauth/') || path === '/register' || path.startsWith('/.well-known/')) {
        result = { error: 'OAuth not yet implemented in Community mode' };
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
  connectedClients.add(clientId);

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
