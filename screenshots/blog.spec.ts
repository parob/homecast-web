/**
 * The blog's app screenshots, captured from mock data.
 *
 * Each test writes a PNG to blog-output/<slug>/<name>.png. They are
 * converted to the WebP the posts reference by hand (cwebp/magick), because the
 * crop and compression are an editorial call, not a test outcome.
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupMocks } from './mocks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = (slug: string, name: string) => {
  const dir = path.join(__dirname, 'blog-output', slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookie-consent', 'granted'));
  await setupMocks(page);
});

test('dashboard — the release post cover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/portal');
  await page.waitForTimeout(3000);
  const myHome = page.locator('button').filter({ hasText: 'My Home' }).first();
  if (await myHome.isVisible()) { await myHome.click({ force: true }); await page.waitForTimeout(2000); }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.screenshot({ path: out('introducing-homecast', 'dashboard') });
});

test('analytics — a room, one panel per measure', async ({ page }) => {
  await page.goto('/analytics?room=Bedroom%202&mockHistory=big');
  await page.getByText('Temperature').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out('introducing-homecast', 'analytics') });
});
