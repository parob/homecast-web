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

import { executeHomeKitAction } from '../relay/local-handler';
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

/**
 * Check if the relay has been set up.
 * If not, the entire Community system is "offline" — external clients get errors.
 */
function isRelayAuthenticated(): boolean {
  return !!localStorage.getItem('homecast-relay-setup');
}

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
    __localserver_graphql_handler?: (clientId: string, request: { operationName?: string; query?: string; variables?: Record<string, unknown> }) => void;
    __localserver_http_handler?: (clientId: string, request: { method: string; path: string; body?: string; authorization?: string }) => void;
  };

  if (!w.isHomeKitRelayCapable) return;

  console.log('[LocalServer] Initializing request handler');

  w.__localserver_handler = (clientId: string, msg: ProtocolMessage) => {
    handleRequest(clientId, msg);
  };

  w.__localserver_disconnect_handler = (clientId: string) => {
    connectedClients.delete(clientId);
    console.log(`[LocalServer] Client disconnected: ${clientId} (${connectedClients.size} remaining)`);
  };

  // GraphQL handler — called by Swift when an HTTP POST / request arrives
  // Auth-exempt GraphQL operations
  // Only operations needed for the login flow and status checks
  // Login/Signup are exempt so external browsers can authenticate AFTER relay is ready
  // The Login page UI gates on relayReady to prevent access when relay isn't signed in
  const AUTH_EXEMPT_OPS = new Set([
    'IsOnboarded', 'GetVersion',
    // Shared entity operations — accessed by unauthenticated visitors
    'GetPublicEntity', 'GetPublicEntityAccessories', 'PublicEntitySetCharacteristic',
  ]);

  w.__localserver_graphql_handler = async (clientId: string, request) => {
    const win = window as Window & { webkit?: { messageHandlers?: { localServer?: { postMessage: (msg: unknown) => void } } } };

    // Gate: require relay auth for non-login operations
    if (!isRelayAuthenticated() && !AUTH_EXEMPT_OPS.has(request.operationName || '')) {
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

    // Gate: relay Mac must be authenticated
    if (!isRelayAuthenticated()) {
      win.webkit?.messageHandlers?.localServer?.postMessage({
        action: 'httpResponse', clientId,
        response: JSON.stringify({ error: 'Server not configured. Sign in on the Mac app first.' }),
      });
      return;
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
        // Validate API token auth
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
        // OAuth — to be implemented
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

  // Gate: relay Mac must be authenticated for the system to work
  if (!isRelayAuthenticated()) {
    respond?.(clientId, {
      id: (msg as any).id,
      type: 'response',
      action: (msg as any).action,
      error: { code: 'NOT_CONFIGURED', message: 'Homecast server is not set up yet. Please sign in on the Mac app.' },
    });
    return;
  }

  // Handle shared WebSocket protocol (different format from main protocol)
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

  try {
    let result: unknown;

    // Handle non-HomeKit protocol actions
    switch (msg.action) {
      case 'subscribe':
        // Subscriptions aren't needed in Community mode — the local server
        // broadcasts all events to all clients automatically
        result = { subscriptions: (msg.payload?.scopes as Array<{type: string; id: string}> ?? []).map(s => ({
          type: s.type,
          id: s.id,
          expiresAt: Date.now() + 300000, // 5 minutes
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
        // HomeKit action — route to local handler
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
