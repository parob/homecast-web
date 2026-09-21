/**
 * The home name lines up with the back button, on a phone browser.
 *
 * parob/homecast-cloud#163: "The spacing between the Home name and the back
 * button in the top left doesn't lineup between the web Mobile view and the
 * native iOS view — the web Mobile view should reflect the native iOS view as
 * closely as possible."
 *
 * Measured off the two screenshots on the issue (same device, same page, same
 * scale — the tile grid lands on the same pixel in both, so the two are
 * directly comparable):
 *
 * |                       | native iOS | web mobile |
 * |-----------------------|-----------:|-----------:|
 * | back button, left     |    20.9 px |    20.9 px |
 * | home name, left       |    20.9 px |    16.1 px |
 * | room title, left      |    22.1 px |    17.3 px |
 * | tile grid, left       |    14.9 px |    14.9 px |
 *
 * Native draws both the back button and the large title from ONE leading
 * margin — `NativeHeaderBar.swift`'s `let leading = max(view.layoutMargins.left, 16)`,
 * which is 20pt on a 440pt-wide iPhone — so they share a left edge. The web
 * draws them from two different gutters: the back button sits in the header
 * row (`px-4`, and 1rem is 20px here), the heading sits in the page's content
 * container (`px-3` → 15px). Hence the 5px step, and hence this spec.
 *
 * What is asserted is the relationship, not the constant: the heading's left
 * edge is the header row's leading margin, whatever that margin is. The tile
 * grid is asserted to STAY on the page gutter, because native leaves it there
 * — it is the title that steps in, not the page.
 *
 *   HEADER_ALIGN_LABEL=before npx playwright test header-title-alignment.spec.ts --project=screenshots
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.HEADER_ALIGN_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-163');

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

async function openHome(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.evaluate(() => { (document.scrollingElement || document.documentElement).scrollTop = 0; });
  await page.waitForTimeout(500);
}

async function openRoom(page: Page) {
  await openHome(page);
  await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Bedroom/ })).toBeVisible();
  // At the top, deliberately: a scrolled room comes in with the heading
  // collapsed into the bar, which is a different thing from the one measured.
  await page.evaluate(() => { (document.scrollingElement || document.documentElement).scrollTop = 0; });
  await page.waitForTimeout(700);
}

/**
 * The bar's leading margin — the header row's content-box left edge, which is
 * where its leading control (the back chevron, the ☰) is placed.
 */
async function barLeading(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector('header [class*="justify-between"]');
    if (!row) throw new Error('header row not found');
    const b = row.getBoundingClientRect();
    return b.left + parseFloat(getComputedStyle(row).paddingLeft);
  });
}

/** Where the heading's own text starts — the element, not the glyph ink. */
async function headingLeft(page: Page) {
  return page.evaluate(() => {
    const h = document.querySelector('main h2.font-bold');
    if (!h) throw new Error('heading not found');
    const b = h.getBoundingClientRect();
    return b.left + parseFloat(getComputedStyle(h).paddingLeft);
  });
}

test('a room page lines its path and title up with the back button', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await openRoom(page);

  await page.screenshot({ path: path.join(OUT, `room-${LABEL}.png`), clip: { x: 0, y: 0, width: 440, height: 300 } });

  const leading = await barLeading(page);
  expect(await headingLeft(page)).toBeCloseTo(leading, 1);

  // And the back button is on that same margin, so the three share an edge.
  const back = (await page.getByTestId('header-back').locator('xpath=..').boundingBox())!;
  expect(back.x).toBeCloseTo(leading, 1);

  // The path line and the big name are both inside the heading, so both move
  // together — asserted on the rendered boxes rather than trusting that.
  const crumb = (await page.locator('main').getByRole('button', { name: 'My Home', exact: true }).first().boundingBox())!;
  expect(crumb.x).toBeCloseTo(leading, 1);
  const title = (await page.locator('main h2.font-bold span.truncate').first().boundingBox())!;
  expect(title.x).toBeCloseTo(leading, 1);
});

test('the home page lines its name up with the bar too', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  await openHome(page);

  await page.screenshot({ path: path.join(OUT, `home-${LABEL}.png`), clip: { x: 0, y: 0, width: 440, height: 300 } });

  const leading = await barLeading(page);
  expect(await headingLeft(page)).toBeCloseTo(leading, 1);
});

test('the tile grid stays on the page gutter, the way native leaves it', async ({ page }) => {
  // The title steps in to the bar's margin; the content below it does not.
  // Native's large title is drawn by the bar at 20pt while the page it sits
  // over keeps its own 15px gutter, and the issue's two screenshots agree on
  // the grid to the pixel. Moving the container instead would have shifted
  // every tile and broken that match.
  await openRoom(page);
  const container = await page.evaluate(() => {
    const el = document.querySelector('main h2.font-bold')!.parentElement!.parentElement!;
    const b = el.getBoundingClientRect();
    return { left: b.left + parseFloat(getComputedStyle(el).paddingLeft), pad: getComputedStyle(el).paddingLeft };
  });
  expect(container.pad).toBe('15px');
  expect(container.left).toBeCloseTo(15, 1);
  expect(await barLeading(page)).toBeGreaterThan(container.left);
});

test('a desktop is untouched', async ({ page }) => {
  // The wide layout has no phone bar to align to: the heading keeps the
  // content container's gutter and grows no extra inset.
  await page.setViewportSize({ width: 1280, height: 900 });
  await openRoom(page);
  const pad = await page.evaluate(() => getComputedStyle(document.querySelector('main h2.font-bold')!).paddingLeft);
  expect(pad).toBe('0px');
});
