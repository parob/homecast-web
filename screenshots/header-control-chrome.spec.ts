/**
 * The header controls, over the two backgrounds that decide how they are drawn.
 *
 * Over a dark background each control paints its own `bg-black/40` circle; over
 * a light one they are transparent and the cluster sits on one `material-regular`
 * slab. Whether that chrome earns its place is a look-at-it question, so this
 * spec exists to produce the picture rather than to assert anything —
 * parob/homecast-cloud#118 asked to see it with and without.
 *
 * Run with HEADER_CHROME_LABEL=before|after to file the pair side by side.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts, overrideSettings } from './mocks';
import { HOME_ID, SHARED_HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.HEADER_CHROME_LABEL || 'before';
// `output/` is the gitignored evidence drawer — these are for a human to look
// at, not for the docs site, and never worth a diff.
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'header-chrome');

/** An unblurred photo, as in the report's screenshot — `isDarkBackground` true. */
const DARK = { type: 'preset', presetId: 'nature-cliffs', blur: 0, brightness: 35 };
/** Near-white, so `isDarkLuminance` answers false and the slab appears. */
const LIGHT = { type: 'preset', presetId: 'solid-light-gray', blur: 0, brightness: 60 };
/**
 * The hard case for dropping the chrome: a *busy* light background, where the
 * controls are dark ink on whatever the photo happens to be behind them.
 */
const BRIGHT = { type: 'preset', presetId: 'nature-countryside', blur: 0, brightness: 78 };

async function shot(page: Page, background: Record<string, unknown>, name: string) {
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
    [`home:${HOME_ID}`]: { background },
    [`home:${SHARED_HOME_ID}`]: { background },
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.locator('[data-tour="sidebar-menu"]')).toBeVisible({ timeout: 20000 });
  // Let the background image decode — `isDarkBackground` is measured off the
  // loaded pixels, so a shot taken too early catches the light-background
  // styling over a dark photo.
  await page.waitForTimeout(3500);

  fs.mkdirSync(OUT, { recursive: true });
  // The header band plus a little of the title under it, which is what the
  // controls have to stay legible against.
  await page.screenshot({
    path: path.join(OUT, `${name}-${LABEL}.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 240 },
  });
}

test.describe('header control chrome', () => {
  test('over a dark background', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone header only');
    await shot(page, DARK, 'dark');
  });

  test('over a light background', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone header only');
    await shot(page, LIGHT, 'light');
  });

  test('over a busy light photo', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone header only');
    await shot(page, BRIGHT, 'bright');
  });
});
