/**
 * The way back from a room, on a phone browser.
 *
 * parob/homecast-cloud#157 asked for the web's mobile view to carry the back
 * button the native iOS build draws. The behaviour was already there — the
 * dimmed home name on the path line goes back — but not the look.
 *
 * The first attempt put a chevron on that path line and the reporter said it
 * was still not the native look. It was not: `NativeHeaderBar.swift` sets
 * `backButtonDisplayMode = .minimal`, which is a chevron ALONE in the
 * navigation bar, leading edge, opposite the trailing controls — not a glyph
 * in the page's text. So what is asserted here is the POSITION as much as the
 * glyph: in the header row, left of centre, vertically centred on the same
 * line as the search and ⋯ controls.
 *
 *   BACK_CRUMB_LABEL=before npx playwright test phone-back-button.spec.ts --project=screenshots
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
    path: path.join(OUT, `back-button-${LABEL}.png`),
    clip: { x: 0, y: 0, width: 440, height: 300 },
  });

  const back = page.getByTestId('header-back');
  await expect(back).toBeVisible();

  // Where UIKit draws it: the bar's leading edge, on the same line as the
  // trailing controls. Both halves matter — a chevron anywhere else on the
  // screen is the thing the reporter already rejected.
  const box = (await back.boundingBox())!;
  const controls = (await page.locator('[data-native-header="search"]').first().boundingBox())!;
  expect(box.x).toBeLessThan(60);
  expect(box.x + box.width).toBeLessThan(controls.x);
  // Same line: centres within a few pixels of each other.
  expect(Math.abs((box.y + box.height / 2) - (controls.y + controls.height / 2))).toBeLessThan(6);
  // A tap target, not a glyph: UIKit's bar buttons are 44pt, and 40 is what
  // every other control in this row already is.
  expect(box.width).toBeGreaterThanOrEqual(40);
  expect(box.height).toBeGreaterThanOrEqual(40);

  // Chevron alone — `.minimal` draws no title beside it.
  expect((await back.innerText()).trim()).toBe('');

  // And it goes back.
  await back.click();
  await expect(page.getByRole('heading', { name: /My Home/ })).toBeVisible();
});

test('the path line above the room name stays plain text', async ({ page }) => {
  // The first attempt put the chevron here. Native does not, so neither does
  // this: the crumb is a word you can tap, and the glyph lives in the bar.
  await openRoom(page);
  const crumb = page.locator('main').getByRole('button', { name: 'My Home', exact: true }).first();
  await expect(crumb).toBeVisible();
  await expect(crumb.locator('svg')).toHaveCount(0);
});

test('a desktop keeps its breadcrumb and grows no back button', async ({ page }) => {
  // A wide window reads its path left to right and has no bar to put a back
  // button in.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openRoom(page);
  await expect(page.getByTestId('header-back')).toHaveCount(0);
});
