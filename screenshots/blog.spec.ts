/**
 * The blog's app screenshots, captured from mock data.
 *
 * Each test writes a PNG to blog-output/<slug>/<name>.png. They are
 * converted to the WebP the posts reference by hand (cwebp/magick), because the
 * crop and compression are an editorial call, not a test outcome.
 */
import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupMocks, prepareDialogScreenshot } from './mocks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = (slug: string, name: string) => {
  const dir = path.join(__dirname, 'blog-output', slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
};

async function openShareDialog(page: Page) {
  await page.goto('/portal');
  await page.waitForTimeout(2500);
  const homeBtn = page.locator('button').filter({ hasText: 'My Home' }).first();
  await homeBtn.click({ button: 'right', force: true });
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]').filter({ hasText: 'Share Home' }).click();
  await page.waitForTimeout(1200);
  return page.locator('[role="dialog"]').first();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookie-consent', 'granted'));
  await setupMocks(page);
});

test('consent screen — the AI assistant post', async ({ page }) => {
  const inner = new URLSearchParams({
    client_id: 'claude-client-id',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'mock-challenge',
    code_challenge_method: 'S256',
    scope: 'mcp:read mcp:write',
    state: 'mock-state',
    resource: 'https://api.homecast.cloud/mcp',
    client_name: 'Claude',
  });
  await page.goto('/portal');
  await page.waitForTimeout(2000);
  await page.goto(`/oauth/consent?oauth_params=${encodeURIComponent(inner.toString())}`);
  await page.getByText('Select homes and permissions').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const card = page.locator('div.rounded-xl, div.rounded-2xl, [class*="card"]').filter({ hasText: 'Select homes and permissions' }).last();
  await card.screenshot({ path: out('control-apple-home-from-claude-and-chatgpt', 'consent') });
});

test('analytics — a room, one panel per measure', async ({ page }) => {
  await page.goto('/analytics?room=Bedroom%202&mockHistory=big');
  await page.getByText('Temperature').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out('apple-home-history-and-analytics', 'room') });
});

test('share dialog — members, public access and passcodes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1700 });
  const dialog = await openShareDialog(page);
  await prepareDialogScreenshot(page);
  await dialog.screenshot({ path: out('share-apple-home-with-android-family', 'share-dialog'), omitBackground: true });
});

test('add passcode — limited access with a weekly window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1700 });
  const share = await openShareDialog(page);
  // The + beside the Passcodes heading is the first plus in the dialog.
  await share.getByRole('button').filter({ has: page.locator('svg.lucide-plus') }).first().click();
  await page.waitForTimeout(700);
  await page.getByPlaceholder('e.g., Guest access').fill('Cleaner');
  const code = page.getByLabel(/^passcode$/i).first();
  if (await code.isVisible()) await code.fill('4821');
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.getByRole('switch').first().click();
  await page.waitForTimeout(500);
  const addWindow = page.getByRole('button', { name: /add window/i }).first();
  if (await addWindow.isVisible()) { await addWindow.click(); await page.waitForTimeout(500); }
  await prepareDialogScreenshot(page);
  await dialog.screenshot({ path: out('share-apple-home-with-android-family', 'passcode'), omitBackground: true });
});

test('dashboard — the roundup cover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/portal');
  await page.waitForTimeout(3000);
  const myHome = page.locator('button').filter({ hasText: 'My Home' }).first();
  if (await myHome.isVisible()) { await myHome.click({ force: true }); await page.waitForTimeout(2000); }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.screenshot({ path: out('whats-new-scenes-in-rooms-long-press-edit', 'dashboard') });
});
