/**
 * Playwright screenshot capture script.
 *
 * Navigates the app with mock data and captures element-level screenshots
 * for use in the documentation. Each screenshot is cropped to just the
 * relevant UI element.
 *
 * Output: docs/.vitepress/public/images/
 *
 * Run: cd app-web/screenshots && npx playwright test capture.spec.ts
 */

import { test, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupMocks, prepareDialogScreenshot, overrideSettings, overrideEntityLayouts } from './mocks';
import { HOME_ID, SHARED_HOME_ID } from './fixtures';

const ROOMS = {
  livingRoom: 'room-living-room',
  bedroom: 'room-bedroom',
  kitchen: 'room-kitchen',
  frontDoor: 'room-front-door',
  garden: 'room-garden',
  sharedLiving: 'room-shared-living',
  sharedPatio: 'room-shared-patio',
} as const;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = path.resolve(__dirname, '../../docs/.vitepress/public/images');
const FEATURES_DIR = path.resolve(__dirname, '../public/images/features');
const APPSTORE_DIR = path.resolve(__dirname, '../../app-ios-macos/screenshots');
const IPHONE_DIR = path.resolve(__dirname, '../../app-ios-macos/screenshots/iphone');
const IPAD_DIR = path.resolve(__dirname, '../../app-ios-macos/screenshots/ipad');

fs.mkdirSync(FEATURES_DIR, { recursive: true });
fs.mkdirSync(APPSTORE_DIR, { recursive: true });
fs.mkdirSync(IPHONE_DIR, { recursive: true });
fs.mkdirSync(IPAD_DIR, { recursive: true });

function img(name: string) {
  return path.join(IMAGES_DIR, name);
}

function featureImg(name: string) {
  return path.join(FEATURES_DIR, name);
}

function appStoreImg(name: string) {
  return path.join(APPSTORE_DIR, name);
}

function iphoneImg(name: string) {
  return path.join(IPHONE_DIR, name);
}

function ipadImg(name: string) {
  return path.join(IPAD_DIR, name);
}

/** Clip a region relative to an element's bounding box, with padding. */
async function clipAroundElement(page: Page, locator: ReturnType<Page['locator']>, opts: { padX?: number; padY?: number; width?: number; height?: number } = {}) {
  const box = await locator.boundingBox();
  if (!box) return null;
  const padX = opts.padX ?? 15;
  const padY = opts.padY ?? 15;
  return {
    x: Math.max(0, box.x - padX),
    y: Math.max(0, box.y - padY),
    width: opts.width ?? (box.width + padX * 2),
    height: opts.height ?? (box.height + padY * 2),
  };
}

/**
 * Navigate to the dashboard and ensure "My Home" is selected.
 *
 * The dashboard auto-selects homes alphabetically when homeOrder hasn't loaded,
 * which lands on "Beach House" (SHARED_HOME_ID) by default. URL params and
 * localStorage hints aren't reliable because account/accessory loading races
 * can clear pendingHomeId before the URL selection takes effect. Force-clicking
 * "My Home" guarantees the right selection regardless of load order.
 */
/**
 * Navigate to My Home, optionally selecting a specific room.
 *
 * `roomName` is the display name of the room to select (e.g. "Living Room").
 * URL-based room selection via page.goto triggers a full reload which re-hits
 * the alphabetical auto-select race, so we click the sidebar button instead.
 */
async function gotoMyHome(page: Page, roomName?: string) {
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForTimeout(3000);
  // If "My Home" isn't visible in the sidebar, open the mobile sidebar first.
  const findMyHomeBtn = () => page.getByRole('button', { name: 'My Home', exact: true }).first();
  if (!(await findMyHomeBtn().isVisible())) {
    const menuBtn = page.locator('button:has(svg.lucide-menu)').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click({ force: true });
      await page.waitForTimeout(800);
    }
  }
  // Force-select My Home in case auto-selection landed on a different home
  // (Dashboard sorts alphabetically until homeOrder arrives from GetSettings).
  if (await findMyHomeBtn().isVisible()) {
    await findMyHomeBtn().click({ force: true });
    await page.waitForTimeout(1500);
  }
  if (roomName) {
    // Re-open the mobile sidebar if it closed after the My Home click.
    const roomBtn = page.getByRole('button', { name: roomName, exact: true }).first();
    if (!(await roomBtn.isVisible())) {
      const menuBtn = page.locator('button:has(svg.lucide-menu)').first();
      if (await menuBtn.isVisible()) {
        await menuBtn.click({ force: true });
        await page.waitForTimeout(800);
      }
    }
    if (await roomBtn.isVisible()) {
      await roomBtn.click({ force: true });
      await page.waitForTimeout(1500);
    }
  }
  // On mobile, close sidebar if it's still open.
  const closeBtn = page.locator('button:has(svg.lucide-x)').first();
  if (await closeBtn.isVisible()) {
    await closeBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }
  // Reset scroll position so the header is visible in the screenshot.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelectorAll('[class*="overflow-"]').forEach((el) => {
      (el as HTMLElement).scrollTop = 0;
    });
  });
  await page.waitForTimeout(300);
}

/** Open the settings dialog from the dashboard, optionally on a specific tab. */
async function openSettings(page: Page, tabLabel?: string) {
  const menuTrigger = page.locator('[data-tour="header-menu"]').first();
  await menuTrigger.click({ force: true });
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.waitForTimeout(500);
  if (tabLabel) {
    await page.locator('[role="dialog"] nav button', { hasText: tabLabel }).first().click({ force: true });
    await page.waitForTimeout(400);
  }
}

// ── Dashboard Screenshots ──────────────────────────────────────────────────────

test.describe('Dashboard screenshots', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await setupMocks(page);
    await gotoMyHome(page);
  });

  test('dashboard overview — full page', async ({ page }) => {
    await page.screenshot({ path: img('dashboard-overview.png') });
    fs.copyFileSync(img('dashboard-overview.png'), featureImg('dashboard.png'));
  });

  test('dashboard sidebar — sidebar region only', async ({ page }) => {
    await page.screenshot({
      path: img('dashboard-sidebar.png'),
      clip: { x: 0, y: 0, width: 230, height: 530 },
    });
  });

  test('widget lightbulb — lights card with brightness and color temp', async ({ page }) => {
    const lightCard = page.getByRole('button', { name: /Ceiling Light.*brightness/ }).first();
    await lightCard.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    const clip = await clipAroundElement(page, lightCard, { padX: 5, padY: 5 });
    if (clip) {
      await page.screenshot({ path: img('widget-lightbulb.png'), clip });
    }
  });

  test('widget thermostat — status badges row', async ({ page }) => {
    const tempText = page.getByText('20.5°C');
    const badge = tempText.locator('xpath=ancestor::div[contains(@class,"flex")][1]');
    const badgeBox = await badge.boundingBox();
    const anchor = badgeBox && badgeBox.height < 200 ? badge : tempText;
    const box = await anchor.boundingBox();
    if (box) {
      await page.screenshot({
        path: img('widget-thermostat.png'),
        clip: { x: Math.max(0, box.x - 10), y: Math.max(0, box.y - 10), width: Math.min(500, box.width + 300), height: box.height + 20 },
      });
    }
  });

  test('widget lock — lock card', async ({ page }) => {
    const lockCard = page.locator('div[class*="rounded-"]').filter({ hasText: 'Lock' }).filter({ hasNotText: 'All Lights' }).first();
    const clip = await clipAroundElement(page, lockCard, { padX: 5, padY: 5 });
    if (clip) {
      await page.screenshot({ path: img('widget-lock.png'), clip });
    }
  });

  test('widget blinds — blinds position card', async ({ page }) => {
    const blindsCard = page.getByRole('button', { name: /Blinds.*% Open|Close Blinds/ }).first();
    const clip = await clipAroundElement(page, blindsCard, { padX: 5, padY: 5 });
    if (clip) {
      await page.screenshot({ path: img('widget-blinds.png'), clip });
    }
  });

  test('widget sensors — front door row with lock and camera', async ({ page }) => {
    const cameraCard = page.locator('div[class*="rounded-"]').filter({ hasText: 'Doorbell' }).first();
    const box = await cameraCard.boundingBox();
    if (box) {
      await page.screenshot({
        path: img('widget-sensors.png'),
        clip: { x: box.x - 350, y: box.y - 40, width: 730, height: box.height + 60 },
      });
    }
  });

  test('sharing — context menu on home', async ({ page }) => {
    const homeBtn = page.locator('button').filter({ hasText: 'My Home' }).first();
    await homeBtn.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
    const menu = page.locator('[role="menu"]');
    if (await menu.isVisible()) {
      await prepareDialogScreenshot(page);
      await menu.screenshot({ path: img('sharing-members.png'), omitBackground: true });
    } else {
      await page.screenshot({ path: img('sharing-members.png') });
    }
  });

  test('collections sidebar — collection selected', async ({ page }) => {
    const collection = page.locator('button, div[class*="cursor"]').filter({ hasText: 'All Lights' }).first();
    await collection.click({ force: true });
    await page.waitForTimeout(1000);
    const collectionsLabel = page.locator('text=Collections').first();
    const box = await collectionsLabel.boundingBox();
    if (box) {
      await page.screenshot({
        path: img('collections-sidebar.png'),
        clip: { x: 0, y: box.y - 10, width: 230, height: 150 },
      });
    }
  });

  // ── Settings Dialog Screenshots ────────────────────────────────────────────

  test('settings overview — main settings dialog', async ({ page }) => {
    await openSettings(page);
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible()) {
      await prepareDialogScreenshot(page);
      await dialog.screenshot({ path: img('settings-overview.png'), omitBackground: true });
    }
  });

  test('api endpoints — API Access dialog', async ({ page }) => {
    await openSettings(page, 'API Access');
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible()) {
      await prepareDialogScreenshot(page);
      await dialog.screenshot({ path: img('api-endpoints.png'), omitBackground: true });
      fs.copyFileSync(img('api-endpoints.png'), featureImg('api-access.png'));
    }
  });

  test('api create token — token creation form', async ({ page }) => {
    await openSettings(page, 'API Access');
    const createBtn = page.getByRole('button', { name: /Create Token/i });
    if (await createBtn.isVisible()) {
      await createBtn.click({ force: true });
      await page.waitForTimeout(500);
      const topDialog = page.locator('[role="dialog"]').last();
      if (await topDialog.isVisible()) {
        await prepareDialogScreenshot(page);
        await topDialog.screenshot({ path: img('api-create-token.png'), omitBackground: true });
      }
    }
  });

  test('webhooks list — webhook management', async ({ page }) => {
    await openSettings(page, 'Webhooks');
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible()) {
      await prepareDialogScreenshot(page);
      await dialog.screenshot({ path: img('webhooks-list.png'), omitBackground: true });
      fs.copyFileSync(img('webhooks-list.png'), featureImg('webhooks.png'));
    }
  });

  test('share dialog — full share dialog for home', async ({ page }) => {
    // Right-click "My Home" → click "Share Home"
    const homeBtn = page.locator('button').filter({ hasText: 'My Home' }).first();
    await homeBtn.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
    const shareItem = page.locator('[role="menuitem"]').filter({ hasText: 'Share Home' });
    if (await shareItem.isVisible()) {
      await shareItem.click();
      await page.waitForTimeout(1000);
      const dialog = page.locator('[role="dialog"]').first();
      if (await dialog.isVisible()) {
        await prepareDialogScreenshot(page);
        await dialog.screenshot({ path: img('share-dialog.png'), omitBackground: true });
        fs.copyFileSync(img('share-dialog.png'), featureImg('sharing.png'));
      }
    }
  });

  test('share dialog members — members section cropped', async ({ page }) => {
    const homeBtn = page.locator('button').filter({ hasText: 'My Home' }).first();
    await homeBtn.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
    const shareItem = page.locator('[role="menuitem"]').filter({ hasText: 'Share Home' });
    if (await shareItem.isVisible()) {
      await shareItem.click();
      await page.waitForTimeout(1000);
      // Scroll the last member into view so the dialog shows the full list
      const membersLabel = page.getByText('Members', { exact: true }).first();
      const lastMember = page.getByText('sam@example.com');
      if (await membersLabel.isVisible()) {
        await lastMember.scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
        const box = await membersLabel.boundingBox();
        if (box) {
          await prepareDialogScreenshot(page);
          await page.screenshot({
            path: img('share-dialog-members.png'),
            omitBackground: true,
            fullPage: true,
            clip: { x: Math.max(0, box.x - 30), y: Math.max(0, box.y - 10), width: 450, height: 420 },
          });
        }
      }
    }
  });

  test.skip('share dialog ai — AI Assistants section cropped', async () => {
    // The "AI Assistants" section was removed from the share dialog. Feature image
    // for AI assistants is now captured via the OAuth consent test above.
  });

  test('shared items list — shared items dialog', async ({ page }) => {
    await openSettings(page, 'Sharing');
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible()) {
      await prepareDialogScreenshot(page);
      await dialog.screenshot({ path: img('shared-items-list.png'), omitBackground: true });
    }
  });

  test('shared items apps — authorized apps tab', async ({ page }) => {
    await openSettings(page, 'Sharing');
    const appsTab = page.getByRole('tab', { name: /Authorized Apps/i });
    if (await appsTab.isVisible()) {
      await appsTab.click();
      await page.waitForTimeout(500);
    }
    const dialog = page.locator('[role="dialog"]').first();
    if (await dialog.isVisible()) {
      await prepareDialogScreenshot(page);
      await dialog.screenshot({ path: img('shared-items-apps.png'), omitBackground: true });
    }
  });

  // ── Smart Deals Screenshots ──────────────────────────────────────────────

  test('smart deal badge — deal badge on widget', async ({ page }) => {
    // Wait for deal badges to load (GraphQL GetActiveDeals must resolve after accessories)
    const dealBadge = page.locator('button[aria-label*="available"]').first();
    await dealBadge.waitFor({ state: 'visible', timeout: 15000 });
    await page.waitForTimeout(500);
    // Find the widget card that contains the first deal badge (its parent relative container)
    const widgetCard = dealBadge.locator('xpath=ancestor::div[contains(@class,"relative")][1]');
    const clip = await clipAroundElement(page, widgetCard, { padX: 5, padY: 5 });
    if (clip) {
      await page.screenshot({ path: img('smart-deal-badge.png'), clip });
    }
  });

  test('smart deal popover — deal popover with price history', async ({ page }) => {
    // Wait for deal badges to load
    const dealBadge = page.locator('button[aria-label*="available"]').first();
    await dealBadge.waitFor({ state: 'visible', timeout: 15000 });
    await dealBadge.click({ force: true });
    await page.waitForTimeout(1500);
    const popover = page.locator('[data-radix-popper-content-wrapper]').first();
    if (await popover.isVisible()) {
      await popover.screenshot({ path: img('smart-deal-popover.png') });
      fs.copyFileSync(img('smart-deal-popover.png'), featureImg('smart-deals.png'));
    }
  });
});

// ── Automation Editor Screenshot ─────────────────────────────────────────────

test.describe('Automation editor screenshot', () => {
  test('automation template picker', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await setupMocks(page);
    await page.goto('/portal');
    await page.waitForTimeout(3000);
    // Expand automations section
    const header = page.locator('button:has-text("Automations")').first();
    await header.click();
    await page.waitForTimeout(1000);
    // Click the existing "Motion Light" HC automation card to open the editor
    const motionCard = page.locator('text=Motion Light').first();
    await motionCard.click({ timeout: 5000 });
    await page.waitForTimeout(1000);
    // Capture the editor dialog showing the flow
    const dialog = page.locator('[role="dialog"]').last();
    await dialog.screenshot({ path: featureImg('automations.png') });
  });
});

// ── Features Hero Screenshot ────────────────────────────────────────────────

test.describe('Features hero screenshot', () => {
  test('dashboard with beach background', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    overrideSettings({
      theme: 'dark',
      sidebarCollapsed: false,
      compactMode: false,
      layoutMode: 'masonry',
      groupByRoom: true,
      groupByType: false,
      iconStyle: 'colourful',
      fontSize: 'small',
      hideInfoDevices: false,
      hideAccessoryCounts: true,
    });
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 } },
      [`home:${SHARED_HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: featureImg('dashboard.png') });
  });

  test('mobile dashboard with beach background', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'iPhone only');
    overrideSettings({
      theme: 'dark',
      sidebarCollapsed: false,
      compactMode: true,
      layoutMode: 'masonry',
      groupByRoom: true,
      groupByType: false,
      iconStyle: 'colourful',
      fontSize: 'small',
      hideInfoDevices: false,
      hideAccessoryCounts: true,
    });
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 } },
      [`home:${SHARED_HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: featureImg('dashboard-mobile.png') });
  });
});

// ── Standalone Page Screenshots ──────────────────────────────────────────────

test.describe('Standalone page screenshots', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await setupMocks(page);
  });

  test('oauth consent — authorization page', async ({ page }) => {
    // The page expects a single `oauth_params` query param containing URL-encoded inner params
    const innerParams = new URLSearchParams({
      client_id: 'claude-client-id',
      redirect_uri: 'https://claude.ai/oauth/callback',
      code_challenge: 'mock-challenge',
      code_challenge_method: 'S256',
      scope: 'homekit',
      state: 'mock-state',
      resource: 'https://api.homecast.cloud',
      client_name: 'Claude',
    });
    // Need to be authenticated for this page (setupMocks already injects auth)
    await page.goto('/portal');
    await page.waitForTimeout(2000);
    await page.goto(`/oauth/consent?oauth_params=${encodeURIComponent(innerParams.toString())}`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: img('oauth-consent.png') });
    fs.copyFileSync(img('oauth-consent.png'), featureImg('ai-assistants.png'));
  });

  test('landing page — hero section', async ({ page }) => {
    // Clear auth so we see the landing page, not redirect to portal
    await page.addInitScript(() => {
      localStorage.removeItem('homecast-token');
      localStorage.removeItem('homecast-device-id');
    });
    await page.goto('/');
    await page.waitForTimeout(3000);
    await page.screenshot({ path: img('landing-hero.png') });
  });

});

// ── MQTT Screenshots ─────────────────────────────────────────────────────────

test.describe('MQTT screenshots', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await setupMocks(page);
  });

  test('mqtt browser — topic tree with live state', async ({ page }) => {
    // Override GetCachedHomes to return mqttEnabled+relayConnected so the
    // home chip renders green and topic counts show. Also satisfy the
    // CreateMqttToken mutation so the browser thinks it has credentials.
    await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      const body = req.postDataJSON() as { query?: string; operationName?: string };
      const opName = body.operationName ?? body.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1];
      if (opName === 'GetCachedHomes') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { cachedHomes: [
            { id: '11111111-1111-1111-1111-111111111111', name: 'My Home', updatedAt: new Date().toISOString(), role: 'owner', ownerEmail: 'rob@homecast.cloud', mqttEnabled: true, relayConnected: true, relayLastSeenAt: new Date().toISOString(), __typename: 'CachedHome' },
            { id: '22222222-2222-2222-2222-222222222222', name: 'Beach House', updatedAt: new Date().toISOString(), role: 'control', ownerEmail: 'sam@example.com', mqttEnabled: true, relayConnected: true, relayLastSeenAt: new Date().toISOString(), __typename: 'CachedHome' },
          ] } }),
        });
      }
      if (opName === 'createMqttToken' || (body.query ?? '').includes('createMqttToken')) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: { createMqttToken: 'hc_mock_token_for_screenshot' } }),
        });
      }
      return route.fallback();
    });

    // Stub the mqtt.js library: load it from unpkg returns a script that
    // defines window.mqtt with a fake client. The fake client emits 'connect'
    // immediately and replays a curated set of mock topics on subscribe.
    await page.route(/^https?:\/\/unpkg\.com\/mqtt@.*$/, (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          (function() {
            var topics = [
              ['homecast/my-home-1111/status', 'online'],
              ['homecast/my-home-1111/living-room-a1b2/ceiling-light-c3d4', '{"brightness":80,"on":true}'],
              ['homecast/my-home-1111/living-room-a1b2/ceiling-light-c3d4/availability', 'online'],
              ['homecast/my-home-1111/living-room-a1b2/floor-lamp-e5f6', '{"brightness":45,"hue":28,"on":true,"saturation":85}'],
              ['homecast/my-home-1111/living-room-a1b2/floor-lamp-e5f6/availability', 'online'],
              ['homecast/my-home-1111/living-room-a1b2/thermostat-7890', '{"cool_target":24,"current_temp":20.5,"heat_target":20}'],
              ['homecast/my-home-1111/living-room-a1b2/thermostat-7890/availability', 'online'],
              ['homecast/my-home-1111/bedroom-aabb/bedside-lamp-ccdd', '{"brightness":40,"on":false}'],
              ['homecast/my-home-1111/bedroom-aabb/bedside-lamp-ccdd/availability', 'online'],
              ['homecast/my-home-1111/kitchen-eeff/under-cabinet-1122', '{"brightness":100,"on":true}'],
              ['homecast/my-home-1111/kitchen-eeff/under-cabinet-1122/availability', 'online'],
              ['homecast/my-home-1111/kitchen-eeff/all-kitchen-lights-3344/members', '["my-home-1111/kitchen-eeff/under-cabinet-1122"]'],
              ['homecast/my-home-1111/kitchen-eeff/all-kitchen-lights-3344', '{"on":true}'],
              ['homecast/my-home-1111/front-door-5566/door-lock-7788', '{"locked":true}'],
              ['homecast/my-home-1111/front-door-5566/door-lock-7788/availability', 'online'],
              ['homecast/my-home-1111/front-door-5566/doorbell-99aa', '{"motion":false}'],
              ['homecast/my-home-1111/front-door-5566/doorbell-99aa/availability', 'online'],
              ['homecast/beach-house-2222/status', 'online'],
              ['homecast/beach-house-2222/patio-bbcc/string-lights-ddee', '{"brightness":60,"on":true}'],
              ['homecast/beach-house-2222/patio-bbcc/string-lights-ddee/availability', 'online'],
            ];
            window.mqtt = {
              connect: function(_url, _opts) {
                var handlers = {};
                var client = {
                  on: function(ev, cb) { handlers[ev] = cb; return client; },
                  subscribe: function(_topic) {
                    setTimeout(function() {
                      topics.forEach(function(t) {
                        if (handlers.message) handlers.message(t[0], t[1]);
                      });
                    }, 80);
                  },
                  publish: function() {},
                  end: function() {},
                };
                setTimeout(function() { if (handlers.connect) handlers.connect(); }, 30);
                return client;
              }
            };
          })();
        `,
      });
    });

    await page.goto('/mqtt');
    // Wait for mqtt.js to load, connect, and topics to flush in
    await page.waitForTimeout(3500);
    // Expand "my-home-1111" so the room tree is visible. Home headers are
    // buttons whose accessible text includes the slug, chevron and count —
    // hasText with a substring match handles that.
    const myHomeRow = page.locator('button:has-text("my-home-1111")').first();
    if (await myHomeRow.isVisible()) {
      await myHomeRow.click({ force: true });
      await page.waitForTimeout(400);
    }
    // Expand a couple of rooms inside My Home
    for (const room of ['living-room-a1b2', 'kitchen-eeff', 'front-door-5566']) {
      const roomRow = page.locator(`button:has-text("${room}")`).first();
      if (await roomRow.isVisible()) {
        await roomRow.click({ force: true });
        await page.waitForTimeout(150);
      }
    }
    await page.waitForTimeout(500);
    // Crop to the centered content area so the screenshot isn't mostly whitespace.
    // Page uses max-w-4xl (~896px) centered in a 1280-wide viewport at 2x DPR.
    await page.screenshot({
      path: img('mqtt-browser.png'),
      clip: { x: 160, y: 0, width: 960, height: 600 },
    });
  });

  test('mqtt setup — Home Detail with broker toggle', async ({ page }) => {
    overrideSettings({ ...BASE_SETTINGS, developerMode: true });
    // Stub the per-home MQTT queries with a sane default
    await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
      const req = route.request();
      if (req.method() !== 'POST') return route.fallback();
      const body = req.postDataJSON() as { query?: string; operationName?: string };
      const opName = body.operationName ?? body.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1];
      if (opName === 'GetHomeMqttEnabled') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { homeMqttEnabled: true } }) });
      }
      if (opName === 'GetHomeMqttBrokers') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { homeMqttBrokers: [] } }) });
      }
      return route.fallback();
    });

    await gotoMyHome(page);
    await openSettings(page, 'Homes');
    // Click "My Home" in the Homes section to open its detail view
    const homeRow = page.locator('[role="dialog"] button').filter({ hasText: /My Home/ }).first();
    if (await homeRow.isVisible()) {
      await homeRow.click({ force: true });
      await page.waitForTimeout(800);
    }
    // Scroll the MQTT label into view so the toggle is visible in the screenshot
    const mqttLabel = page.locator('[role="dialog"]').getByText('MQTT', { exact: true }).first();
    if (await mqttLabel.isVisible()) {
      await mqttLabel.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
    }
    const dialog = page.locator('[role="dialog"]').first();
    await prepareDialogScreenshot(page);
    await dialog.screenshot({ path: img('mqtt-setup.png'), omitBackground: true });
  });
});

// ── Mac App Store Screenshots (2560×1600 at 2x) ─────────────────────────────

const BASE_SETTINGS = {
  theme: 'dark',
  sidebarCollapsed: false,
  compactMode: false,
  layoutMode: 'masonry',
  groupByRoom: true,
  groupByType: false,
  iconStyle: 'colourful',
  fontSize: 'small',
  hideInfoDevices: false,
  hideAccessoryCounts: true,
  developerMode: true,
  homeOrder: [HOME_ID, SHARED_HOME_ID],
};

test.describe('App Store screenshots', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
  });

  // 1 — Home overview with ocean gradient
  test('appstore 01 — My Home overview', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: appStoreImg('01-home-overview.png') });
  });

  // 2 — Living Room with forest background
  test('appstore 02 — Living Room', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`room:${ROOMS.livingRoom}`]: { background: { type: 'preset', presetId: 'nature-forest', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page, 'Living Room');
    await page.screenshot({ path: appStoreImg('02-living-room.png') });
  });

  // 3 — Bedroom with aurora gradient
  test('appstore 03 — Bedroom', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`room:${ROOMS.bedroom}`]: { background: { type: 'preset', presetId: 'gradient-aurora', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page, 'Bedroom');
    await page.screenshot({ path: appStoreImg('03-bedroom.png') });
  });

  // 4 — Compact mode with mountains
  test('appstore 04 — Compact mode', async ({ page }) => {
    overrideSettings({ ...BASE_SETTINGS, compactMode: true });
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-mountains', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: appStoreImg('04-compact-mode.png') });
  });

  // 5 — Beach House with beach background
  test('appstore 05 — Beach House', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${SHARED_HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await page.goto(`/portal?home=${SHARED_HOME_ID}`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: appStoreImg('05-beach-house.png') });
  });

  // 6 — Settings dialog (Display tab — community builds have no Plan content)
  test('appstore 06 — Settings', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await openSettings(page, 'Display');
    await page.screenshot({ path: appStoreImg('06-settings.png') });
  });

  // 7 — API access tokens
  test('appstore 07 — API access', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await openSettings(page, 'API Access');
    await page.screenshot({ path: appStoreImg('07-api-access.png') });
  });

  // 8 — Webhooks
  test('appstore 08 — Webhooks', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await openSettings(page, 'Webhooks');
    await page.screenshot({ path: appStoreImg('08-webhooks.png') });
  });

  // 9 — Share home dialog
  test('appstore 09 — Sharing', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    const homeBtn = page.locator('button').filter({ hasText: 'My Home' }).first();
    await homeBtn.click({ button: 'right', force: true });
    await page.waitForTimeout(500);
    const shareItem = page.locator('[role="menuitem"]').filter({ hasText: 'Share Home' });
    if (await shareItem.isVisible()) {
      await shareItem.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: appStoreImg('09-sharing.png') });
  });

  // 10 — OAuth consent page
  test('appstore 10 — OAuth consent', async ({ page }) => {
    await setupMocks(page);
    const innerParams = new URLSearchParams({
      client_id: 'claude-client-id',
      redirect_uri: 'https://claude.ai/oauth/callback',
      code_challenge: 'mock-challenge',
      code_challenge_method: 'S256',
      scope: 'homekit',
      state: 'mock-state',
      resource: 'https://api.homecast.cloud',
      client_name: 'Claude',
    });
    await page.goto('/portal');
    await page.waitForTimeout(2000);
    await page.goto(`/oauth/consent?oauth_params=${encodeURIComponent(innerParams.toString())}`);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: appStoreImg('10-oauth-consent.png') });
  });
});

// ── iPhone App Store Screenshots (1284×2778 at 3x) ──────────────────────────

test.describe('iPhone App Store screenshots', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'iPhone only');
  });

  // 1 — Home overview with ocean gradient
  test('iphone 01 — My Home overview', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: iphoneImg('01-home-overview.png') });
  });

  // 2 — Living Room with forest background
  test('iphone 02 — Living Room', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`room:${ROOMS.livingRoom}`]: { background: { type: 'preset', presetId: 'nature-forest', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page, 'Living Room');
    await page.screenshot({ path: iphoneImg('02-living-room.png') });
  });

  // 3 — Right menu open with aurora gradient
  test('iphone 03 — Right menu', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-aurora', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.locator('[data-tour="header-menu"]').first().click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: iphoneImg('03-menu.png') });
  });

  // 4 — Share dialog open via MoreVertical menu
  test('iphone 04 — Share dialog', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    // Open header menu → Share
    await page.locator('[data-tour="header-menu"]').first().click({ force: true });
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: iphoneImg('04-sharing.png') });
  });

  // 5 — Mobile sidebar navigation
  test('iphone 05 — Sidebar navigation', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    const menuBtn = page.locator('button:has(svg.lucide-menu)').first();
    if (await menuBtn.isVisible()) {
      await menuBtn.click({ force: true });
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: iphoneImg('05-sidebar.png') });
  });
});

// ── iPad App Store Screenshots (2048×2732 at 2x) ────────────────────────────

test.describe('iPad App Store screenshots', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'ipad-screenshots', 'iPad only');
  });

  // 1 — Home overview with ocean gradient
  test('ipad 01 — My Home overview', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: ipadImg('01-home-overview.png') });
  });

  // 2 — Living Room with forest background
  test('ipad 02 — Living Room', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`room:${ROOMS.livingRoom}`]: { background: { type: 'preset', presetId: 'nature-forest', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page, 'Living Room');
    await page.screenshot({ path: ipadImg('02-living-room.png') });
  });

  // 3 — Right menu open with aurora gradient
  test('ipad 03 — Right menu', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-aurora', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.locator('[data-tour="header-menu"]').first().click({ force: true });
    await page.waitForTimeout(500);
    await page.screenshot({ path: ipadImg('03-menu.png') });
  });

  // 4 — Share dialog open over dashboard
  test('ipad 04 — Share dialog', async ({ page }) => {
    overrideSettings(BASE_SETTINGS);
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', blur: 20, brightness: 35 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.locator('[data-tour="header-menu"]').first().click({ force: true });
    await page.waitForTimeout(300);
    await page.getByRole('menuitem', { name: 'Share', exact: true }).click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: ipadImg('04-sharing.png') });
  });

  // 5 — Compact mode with mountains
  test('ipad 05 — Compact mode', async ({ page }) => {
    overrideSettings({ ...BASE_SETTINGS, compactMode: true });
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'nature-mountains', blur: 15, brightness: 30 } },
    });
    await setupMocks(page);
    await gotoMyHome(page);
    await page.screenshot({ path: ipadImg('05-compact-mode.png') });
  });
});
