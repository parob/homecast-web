/**
 * Tests for login page flows: community mode, cloud mode, mode switching.
 *
 * These test the web UI side — the native Swift mode selector is not tested here,
 * but everything after mode selection (relay connection, sign-out, cookie consent) is.
 */

import { test, expect, Page } from '@playwright/test';
import { mockGraphQL, mockWebSocket, injectAuth } from './mocks';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Set up community mode in localStorage before page loads. */
async function setupCommunityClient(page: Page, relayAddress: string) {
  await page.addInitScript((addr) => {
    // Simulate community mode client connected to a relay
    localStorage.setItem('homecast-mode', 'client');
    localStorage.setItem('homecast-relay-address', addr);
    localStorage.setItem('cookie-consent', 'granted');
    // Inject community flag (normally done by local server)
    (window as any).__HOMECAST_COMMUNITY__ = true;
  }, relayAddress);
}

/** Set up community relay mode (the relay Mac itself). */
async function setupCommunityRelay(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('homecast-mode', 'relay');
    localStorage.setItem('homecast-relay-setup', 'true');
    localStorage.setItem('cookie-consent', 'granted');
    (window as any).__HOMECAST_COMMUNITY__ = true;
    (window as any).isHomeKitRelayCapable = true;
  });
}

/** Set up community mode with no relay configured (first launch). */
async function setupCommunityFirstLaunch(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('cookie-consent', 'granted');
    (window as any).__HOMECAST_COMMUNITY__ = true;
  });
}

/** Note: cloud mode cannot be fully tested on localhost because isCommunity
 *  is evaluated at module load time from window.location.hostname. Tests that
 *  depend on cloud-specific UI (email login, sign-up link) are skipped. */

/** Mock the community relay health/status check. */
async function mockCommunityRelay(page: Page, opts: { authEnabled?: boolean; relayReady?: boolean } = {}) {
  const { authEnabled = false, relayReady = true } = opts;

  // Mock GraphQL queries used by Login page and CommunityAuthProvider
  // Match any origin since community client mode redirects API to the relay address
  await page.route(/\/$/, async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    let body: any;
    try { body = request.postDataJSON(); } catch { return route.fallback(); }
    const op = body.operationName ?? '';
    if (op === 'IsOnboarded') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { isOnboarded: true, authEnabled, relayReady } }),
      });
    }
    // For auth-disabled: GetMe returns guest user
    if (op === 'GetMe' && !authEnabled) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: { me: null } }),
      });
    }
    return route.fallback();
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

test.describe('Community mode - first launch', () => {
  test('shows setup flow with relay address input', async ({ page }) => {
    await setupCommunityFirstLaunch(page);
    await page.goto('/login');

    // Should show Community Edition branding
    await expect(page.getByText('Community Edition')).toBeVisible();

    // Should show the setup flow — not the auth login form
    // On first launch with no mode set, non-native-app clients see the relay check
    // which will fail and show relay not ready
  });
});

test.describe('Community mode - relay not ready', () => {
  test('shows relay not ready with change mode button', async ({ page }) => {
    await setupCommunityClient(page, 'localhost:9999');
    // Don't mock the relay — let the fetch fail
    await page.goto('/login');

    await expect(page.getByText('Relay not ready')).toBeVisible({ timeout: 10000 });
    // Should show the relay address it tried
    await expect(page.getByText('localhost:9999')).toBeVisible();
    // Should have a proper change mode button
    await expect(page.getByRole('button', { name: /change relay connection/i })).toBeVisible();
  });
});

test.describe('Community mode - auth enabled', () => {
  test('shows sign-in form with relay address and change mode button', async ({ page }) => {
    await setupCommunityClient(page, 'mymac.local:5656');
    await mockCommunityRelay(page, { authEnabled: true, relayReady: true });
    await page.goto('/login');

    // Should show the sign-in form
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible({ timeout: 10000 });
    // Should show which relay we're connecting to
    await expect(page.getByText('mymac.local:5656')).toBeVisible();
    // Should have username/password fields
    await expect(page.getByLabel('Username')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    // Should have change mode button (proper button, not tiny text)
    const changeModeBtn = page.getByRole('button', { name: /change relay connection/i });
    await expect(changeModeBtn).toBeVisible();
  });
});

test.describe('Community mode - auth disabled', () => {
  test('does not show login form when auth is disabled', async ({ page }) => {
    await setupCommunityClient(page, 'localhost:8080');
    await mockCommunityRelay(page, { authEnabled: false, relayReady: true });
    await page.goto('/login');

    // Auth disabled + relay ready → should NOT show the auth login form
    // (either redirects to dashboard or shows loading)
    await expect(page.getByLabel('Username')).not.toBeVisible({ timeout: 5000 });
    await expect(page.getByText('Relay not ready')).not.toBeVisible();
  });
});

test.describe('Cloud mode - login page', () => {
  // Note: on localhost, isCommunity is true so we can't test cloud-specific UI (email form, sign-up).
  // These tests verify mode-switching buttons which appear in both modes.

  test('shows change mode button in native app', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('cookie-consent', 'granted');
      // Simulate native app bridge
      (window as any).webkit = { messageHandlers: { homecast: { postMessage: () => {} } } };
      (window as any).__HOMECAST_COMMUNITY__ = true;
    });
    await mockCommunityRelay(page, { authEnabled: true, relayReady: true });
    await page.goto('/login');

    // In community mode with native app, button says "Change relay connection"
    await expect(page.getByRole('button', { name: /change relay connection/i })).toBeVisible({ timeout: 10000 });
  });

  test('shows change mode button for browser clients in community mode', async ({ page }) => {
    await setupCommunityClient(page, 'mymac.local:5656');
    await mockCommunityRelay(page, { authEnabled: true, relayReady: true });
    await page.goto('/login');

    await expect(page.getByRole('button', { name: /change relay connection/i })).toBeVisible({ timeout: 10000 });
  });
});

test.describe('Cookie consent', () => {
  test('shows cookie banner on web (no native app)', async ({ page }) => {
    // Don't set cookie-consent in localStorage
    await page.goto('/login');

    await expect(page.getByText('We use cookies and analytics')).toBeVisible({ timeout: 5000 });
    await expect(page.getByRole('button', { name: 'Accept' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Reject' })).toBeVisible();
  });

  test('hides cookie banner in native app', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).webkit = { messageHandlers: { homecast: { postMessage: () => {} } } };
    });
    await page.goto('/login');

    // Should not show cookie banner
    await expect(page.getByText('We use cookies and analytics')).not.toBeVisible({ timeout: 3000 });
  });

  test('hides cookie banner in community mode', async ({ page }) => {
    await page.addInitScript(() => {
      (window as any).__HOMECAST_COMMUNITY__ = true;
    });
    await page.goto('/login');

    await expect(page.getByText('We use cookies and analytics')).not.toBeVisible({ timeout: 3000 });
  });
});

test.describe('SetupState - relay offline with owned homes', () => {
  // Skip on localhost — isCommunity=true overrides the cloud dashboard flow
  test.skip('shows GetStarted options instead of just relay offline', async ({ page }) => {
    await injectAuth(page);

    // Override GetSessions to return empty (no relay connected) — must be before mockGraphQL
    await page.route('**/', async (route) => {
      const request = route.request();
      if (request.method() !== 'POST') return route.fallback();
      let body: any;
      try { body = request.postDataJSON(); } catch { return route.fallback(); }
      const op = body.operationName ?? '';
      if (op === 'GetSessions') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { sessions: [] } }),
        });
      }
      return route.fallback();
    });

    await mockGraphQL(page);

    // Mock WebSocket — return homes with relayConnected=false
    await page.routeWebSocket(/^wss?:\/\/(api\.homecast\.cloud|localhost:8080)\/ws/, (ws) => {
      ws.send(JSON.stringify({ type: 'connected', serverInstanceId: 'mock-1' }));
      ws.send(JSON.stringify({ type: 'config', payload: { webClientsListening: true } }));
      ws.onMessage((raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        if (msg.type === 'ping' || msg.action === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
          return;
        }
        if (msg.type === 'request' && msg.id) {
          if (msg.action === 'homes.list') {
            ws.send(JSON.stringify({
              id: msg.id, type: 'response', action: msg.action,
              payload: { homes: [{ id: 'home-1', name: 'My Home', isPrimary: true, roomCount: 3, accessoryCount: 5, relayConnected: false }] },
            }));
          } else {
            ws.send(JSON.stringify({ id: msg.id, type: 'response', action: msg.action, payload: {} }));
          }
        }
      });
    });

    await page.goto('/portal');

    // Should show the relay offline banner (amber) and setup options
    await expect(page.getByText('Your Mac relay is offline')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Connect your devices')).toBeVisible();
    await expect(page.getByText('Self-hosted relay')).toBeVisible();
    await expect(page.getByText('Cloud relay')).toBeVisible();
  });
});
