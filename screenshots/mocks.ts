/**
 * Playwright interceptors for WebSocket, GraphQL, and auth.
 *
 * Sets up all network mocks so the app renders with fixture data
 * without needing a running server or relay.
 */

import { Page } from '@playwright/test';
import {
  HOME_ID, SHARED_HOME_ID, USER_ID,
  HOMES, CACHED_HOMES,
  MY_HOME_ROOMS, SHARED_HOME_ROOMS,
  MY_HOME_ACCESSORIES, SHARED_HOME_ACCESSORIES,
  SCENES, SERVICE_GROUPS,
  HOME_MEMBERS, COLLECTIONS,
  MOCK_USER, MOCK_SETTINGS, MOCK_ACCOUNT,
  MOCK_ACCESS_TOKENS, MOCK_WEBHOOKS, MOCK_WEBHOOK_DELIVERIES,
  MOCK_AUTHORIZED_APPS, MOCK_ENTITY_ACCESS, MOCK_SHARING_INFO,
  MOCK_DEALS, MOCK_DEAL_PRICE_HISTORY,
  MOCK_HC_AUTOMATIONS, MOCK_HOMEKIT_AUTOMATIONS,
} from './fixtures';

// ── Auth ─────────────────────────────────────────────────────────────────────

const FAKE_JWT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJhYWFhYWFhYS1hYWFhLWFhYWEtYWFhYS1hYWFhYWFhYWFhYWEiLCJleHAiOjk5OTk5OTk5OTl9.mock';

export async function injectAuth(page: Page) {
  await page.addInitScript((token) => {
    localStorage.setItem('homecast-token', token);
    localStorage.setItem('homecast-device-id', 'web_mock-device-id');
    // Pre-select My Home so the dashboard opens to it (matches ?home= param)
    localStorage.setItem('homecast-selected-home', '11111111-1111-1111-1111-111111111111');
    // Dismiss cookie consent banner for screenshots
    localStorage.setItem('cookie-consent', 'granted');
  }, FAKE_JWT);
}

// ── GraphQL ──────────────────────────────────────────────────────────────────

/** Extract the operation name from a GraphQL query string. */
function extractOperationName(query: string): string | null {
  const match = query.match(/(?:query|mutation|subscription)\s+(\w+)/);
  return match?.[1] ?? null;
}

export async function mockGraphQL(page: Page) {
  // Match both production (api.homecast.cloud) and local dev (localhost:8080) GraphQL endpoints
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      return route.fallback();
    }

    let body: { query?: string; operationName?: string; variables?: Record<string, unknown> };
    try {
      body = request.postDataJSON();
    } catch {
      return route.fallback();
    }

    const opName = body.operationName ?? extractOperationName(body.query ?? '');
    const data = resolveGraphQL(opName, body.variables);

    if (data !== undefined) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data }),
      });
    }

    // Unknown query — return empty data so the app doesn't crash
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: {} }),
    });
  });
}

function resolveGraphQL(
  opName: string | null,
  variables?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  switch (opName) {
    case 'GetMe':
      return { me: MOCK_USER };

    case 'GetSettings':
      return { settings: getEffectiveSettings() };

    case 'GetAccount':
      return { account: MOCK_ACCOUNT };

    case 'GetSessions':
      return {
        sessions: [
          {
            id: 'session-relay',
            deviceId: 'mac_relay-1',
            name: 'Mac (Relay)',
            sessionType: 'device',
            lastSeenAt: new Date().toISOString(),
            homeIds: [HOME_ID],
          },
        ],
      };

    case 'GetAccessTokens':
      return { accessTokens: MOCK_ACCESS_TOKENS };

    case 'GetCollections':
      return {
        collections: COLLECTIONS.map((c) => {
          const data = JSON.parse(c.dataJson);
          return { id: c.entityId, name: data.name, payload: c.dataJson, createdAt: c.updatedAt };
        }),
      };

    case 'GetStoredEntities':
      return { storedEntities: COLLECTIONS };

    case 'GetStoredEntityLayout':
      return { storedEntityLayout: getEntityLayout(variables?.entityType as string, variables?.entityId as string) };

    case 'GetPendingInvitations':
      return { pendingInvitations: [] };

    case 'GetRoomGroups':
      return { roomGroups: [] };

    case 'GetHomeMembers':
      return { homeMembers: HOME_MEMBERS };

    case 'GetCachedHomes':
      return { cachedHomes: CACHED_HOMES };

    case 'GetUserBackgrounds':
      return { userBackgrounds: [] };

    case 'GetBackgroundPresets':
      return { backgroundPresets: [] };

    case 'GetAuthorizedApps':
      return { authorizedApps: MOCK_AUTHORIZED_APPS };

    case 'GetWebhooks':
      return { webhooks: MOCK_WEBHOOKS };

    case 'GetWebhook':
      return { webhook: MOCK_WEBHOOKS[0] };

    case 'GetWebhookDeliveryHistory':
      return { webhookDeliveryHistory: { deliveries: MOCK_WEBHOOK_DELIVERIES, totalCount: MOCK_WEBHOOK_DELIVERIES.length } };

    case 'GetWebhookEventTypes':
      return { webhookEventTypes: [
        { id: 'evt-1', eventType: 'state.changed', displayName: 'State Changed', description: 'A device state changed', category: 'device', isActive: true },
        { id: 'evt-2', eventType: 'webhook.test', displayName: 'Test Event', description: 'Manual test event', category: 'system', isActive: true },
      ] };

    case 'GetMySharedHomes':
      return { mySharedHomes: [] };

    case 'GetEntityAccess':
      return { entityAccess: MOCK_ENTITY_ACCESS };

    case 'GetSharingInfo':
      return { sharingInfo: MOCK_SHARING_INFO };

    case 'GetMySharedEntities':
      return { mySharedEntities: MOCK_ENTITY_ACCESS };

    case 'GetSharedEntities':
      return { sharedEntities: MOCK_ENTITY_ACCESS };

    case 'GetActiveDeals':
      return { activeDeals: MOCK_DEALS };

    case 'GetDealPriceHistory':
      return { dealPriceHistory: MOCK_DEAL_PRICE_HISTORY[(variables?.dealId as string)] ?? [] };

    case 'TrackDealClick':
      return { trackDealClick: true };

    // HomeKit native automations
    case 'GetAutomations':
      return { automations: MOCK_HOMEKIT_AUTOMATIONS };

    // Homecast automations
    case 'HcAutomations':
      return { hcAutomations: MOCK_HC_AUTOMATIONS };

    case 'SaveHcAutomation':
      return { saveHcAutomation: MOCK_HC_AUTOMATIONS[0] };

    case 'DeleteHcAutomation':
      return { deleteHcAutomation: true };

    // Mutations that may fire on load
    case 'SyncEntities':
      return { syncEntities: { success: true, syncedCount: 0 } };

    case 'UpdateSettings':
      return { updateSettings: { success: true } };

    default:
      return undefined;
  }
}

// ── WebSocket ────────────────────────────────────────────────────────────────

export async function mockWebSocket(page: Page) {
  // Match both production (api.homecast.cloud) and local dev (localhost:8080) WebSocket endpoints
  await page.routeWebSocket(/^wss?:\/\/(api\.homecast\.cloud|localhost:8080)\/ws/, (ws) => {
    // Send connected message
    ws.send(JSON.stringify({
      type: 'connected',
      serverInstanceId: 'mock-1',
    }));

    // Send config (tells the app there are web clients listening)
    ws.send(JSON.stringify({
      type: 'config',
      payload: { webClientsListening: true },
    }));

    ws.onMessage((raw) => {
      let msg: { id?: string; type?: string; action?: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Respond to pings
      if (msg.type === 'ping' || msg.action === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }

      // Respond to requests
      if (msg.type === 'request' && msg.id) {
        const response = handleWsRequest(msg.action!, msg.payload ?? {});
        ws.send(JSON.stringify({
          id: msg.id,
          type: 'response',
          action: msg.action,
          payload: response,
        }));
      }
    });
  });
}

function handleWsRequest(
  action: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const homeId = payload.homeId as string | undefined;

  switch (action) {
    case 'homes.list':
      return {
        homes: HOMES.map((h) => ({
          ...h,
          role: h.id === SHARED_HOME_ID ? 'control' : 'owner',
        })),
      };

    case 'rooms.list':
      if (homeId === SHARED_HOME_ID) return { rooms: SHARED_HOME_ROOMS };
      return { rooms: MY_HOME_ROOMS };

    case 'accessories.list':
      if (homeId === SHARED_HOME_ID) return { accessories: SHARED_HOME_ACCESSORIES };
      return { accessories: MY_HOME_ACCESSORIES };

    case 'scenes.list':
      if (homeId === SHARED_HOME_ID) return { scenes: [] };
      return { scenes: SCENES };

    case 'serviceGroups.list':
      if (homeId === SHARED_HOME_ID) return { serviceGroups: [] };
      return { serviceGroups: SERVICE_GROUPS };

    case 'zones.list':
      return { zones: [] };

    case 'subscribe':
      return {
        subscriptions: ((payload.scopes as Array<{ type: string; id: string }>) ?? []).map((s) => ({
          type: s.type,
          id: s.id,
          expiresAt: Date.now() + 300_000,
        })),
      };

    case 'subscriptions.list':
      return { subscriptions: [] };

    default:
      return { success: true };
  }
}

// ── Screenshot styles ────────────────────────────────────────────────────────

/** Hide app content behind dialogs so element screenshots have transparent corners.
 *  Call before taking dialog screenshots. Safe for non-dialog shots too (no visual effect). */
export async function prepareDialogScreenshot(page: Page) {
  await page.addStyleTag({
    content: `
      body > #root {
        visibility: hidden !important;
      }
      html, body,
      [class*="bg-black"] {
        background: transparent !important;
      }
      [role="dialog"] {
        box-shadow: none !important;
      }
    `,
  });
}

// ── Settings override ─────────────────────────────────────────────────────────

let settingsOverride: Record<string, unknown> | null = null;

/** Override the settings returned by GetSettings for the next setupMocks call. */
export function overrideSettings(settings: Record<string, unknown>) {
  settingsOverride = settings;
}

export function getEffectiveSettings() {
  if (settingsOverride) {
    const override = { data: JSON.stringify(settingsOverride) };
    settingsOverride = null;
    return override;
  }
  return MOCK_SETTINGS;
}

// ── Entity layout overrides (backgrounds per home/room/collection) ───────────

type LayoutMap = Record<string, Record<string, unknown>>;
let entityLayoutOverrides: LayoutMap = {};

/**
 * Set layout data (including backgrounds) for specific entities.
 * Key format: "entityType:entityId" e.g. "home:11111111-..." or "room:room-bedroom"
 */
export function overrideEntityLayouts(layouts: LayoutMap) {
  entityLayoutOverrides = layouts;
}

export function getEntityLayout(entityType?: string, entityId?: string) {
  if (!entityType || !entityId) return null;
  const key = `${entityType}:${entityId}`;
  const layout = entityLayoutOverrides[key];
  if (layout) {
    return {
      __typename: 'StoredEntityLayout',
      id: `layout-${entityType}-${entityId}`,
      entityType,
      entityId,
      parentId: null,
      dataJson: null,
      layoutJson: JSON.stringify(layout),
      updatedAt: new Date().toISOString(),
    };
  }
  return null;
}

// ── Setup all mocks ──────────────────────────────────────────────────────────

export async function setupMocks(page: Page) {
  await injectAuth(page);
  // Force cloud mode so the app connects WS to localhost:8080 (not 8081).
  // Community mode uses httpPort+1 for WS, but Playwright can't intercept cross-port WS.
  await page.addInitScript(() => {
    // Override hostname to prevent community mode detection (config.ts checks window.location.hostname)
    Object.defineProperty(window, '__HOMECAST_FORCE_CLOUD__', { value: true });
  });
  await mockGraphQL(page);
  await mockWebSocket(page);
  // NOTE: call injectScreenshotStyles(page) AFTER page.goto() for transparent
  // dialog corners — addStyleTag must run after navigation.
}
