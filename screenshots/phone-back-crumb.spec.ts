/**
 * The way back from a room, on a phone browser.
 *
 * parob/homecast-cloud#157 asked for the web's mobile view to carry the back
 * button the native iOS build draws. It already had the behaviour — the dimmed
 * home name on the path line above the room's title goes back — but not the
 * look: native draws `‹ George Street`, the web drew `George Street`.
 *
 * So this checks the glyph is there, that it is inside the control rather than
 * beside it (a chevron that is not part of the tap target is decoration), and
 * that the control still does what it did.
 *
 *   BACK_CRUMB_LABEL=before npx playwright test phone-back-crumb.spec.ts --project=screenshots
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.BACK_CRUMB_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-157');

/** The reporter's device, from the context blob on the issue. */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';

test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: IPHONE_UA,
});

async function openRoom(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Bedroom/ })).toBeVisible();
  await page.waitForTimeout(700);
}

test('a room page on a phone shows the way back', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await openRoom(page);

  await page.screenshot({
    path: path.join(OUT, `back-crumb-${LABEL}.png`),
    clip: { x: 0, y: 0, width: 440, height: 300 },
  });

  const back = page.getByTestId('crumb-back');
  await expect(back).toBeVisible();

  // The chevron belongs to the button, not to the line it sits on: anything
  // else looks tappable without being tappable.
  await expect(back.locator('svg')).toHaveCount(1);

  // And it still goes back, which is the half that already worked.
  await back.click();
  await expect(page.getByRole('heading', { name: /My Home/ })).toBeVisible();
});

test('a desktop breadcrumb keeps its path, with no back arrow in the middle', async ({ page }) => {
  // The same crumb on a wide window is one step of a path that reads left to
  // right. An arrow there would be pointing at the wrong thing.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openRoom(page);
  await expect(page.getByTestId('crumb-back').locator('svg')).toHaveCount(0);
});
