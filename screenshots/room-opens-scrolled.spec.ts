/**
 * A room opened from a scrolled home arrives already scrolled.
 *
 * parob/homecast-cloud#175: "When I visit a page in the Mobile Web app and
 * click on a room within a Home the content of the Rooms is scrolled up to the
 * top already". The reporter's screenshot shows the room page landing with its
 * large title clipped off the top edge and the compact header already
 * collapsed — the room was entered from a scrolled home view and inherited
 * that offset.
 *
 * Entering a room is a SEARCH PARAM change (`?room=…`), not a pathname change,
 * so `ScrollToTop` — which keys on `pathname` — never fires for it.
 *
 *   npx playwright test room-opens-scrolled.spec.ts --project=screenshots
 *
 * To regenerate the before/after pictures, run it once on each side with
 * ROOM_SCROLL_LABEL set — the captures land in output/issue-175/:
 *
 *   ROOM_SCROLL_LABEL=before npx playwright test room-opens-scrolled.spec.ts --project=screenshots
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';

const CAPTURE = process.env.ROOM_SCROLL_LABEL || '';
const OUT = 'output/issue-175';

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

const scrollTop = (page: Page) =>
  page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollTop;
  });

async function openHome(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  // Wait for the page to actually BE scrollable rather than sleeping and
  // hoping. On a slow runner the tiles land late, and scrolling a document
  // that is still one viewport tall silently does nothing — which would make
  // this spec pass for the wrong reason.
  await expect
    .poll(() => page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return el.scrollHeight - el.clientHeight;
    }), { message: 'the home view has something to scroll', timeout: 15_000 })
    .toBeGreaterThan(500);
}

/** Scroll the home down the way someone does to reach the room they want. */
async function scrollHome(page: Page, to: number) {
  await page.evaluate((y) => {
    const el = document.scrollingElement || document.documentElement;
    el.scrollTop = y;
  }, to);
  await expect
    .poll(() => scrollTop(page), { message: 'the home view really is scrolled', timeout: 5_000 })
    .toBeGreaterThan(200);
  return scrollTop(page);
}

test('a room entered from a scrolled home opens at the top', async ({ page }) => {
  await openHome(page);

  // 400px is well short of the bottom — an ordinary scroll, not an extreme one.
  const beforeTap = await scrollHome(page, 400);

  await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Bedroom/ })).toBeVisible();

  // Poll rather than sleep: the reset lands in an effect after the room's own
  // paint, and how long that takes is the runner's business, not the spec's.
  await expect
    .poll(() => scrollTop(page), { message: 'the room page settles at the top', timeout: 10_000 })
    .toBe(0);
  const afterTap = await scrollTop(page);
  console.log(`[#175] home scrolled to ${beforeTap}px → room opened at ${afterTap}px`);

  if (CAPTURE) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${CAPTURE}.png` });
  }

  expect(afterTap, 'the room page should start at the top, not inherit the home view scroll').toBe(0);
});

test('the room heading is not clipped by the top of the viewport', async ({ page }) => {
  await openHome(page);

  await scrollHome(page, 400);

  await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
  const heading = page.getByRole('heading', { name: /Bedroom/ });
  await expect(heading).toBeVisible();
  await expect
    .poll(() => scrollTop(page), { message: 'the room page settles at the top', timeout: 10_000 })
    .toBe(0);

  const box = await heading.boundingBox();
  console.log(`[#175] heading top = ${box?.y}px`);

  // The reporter's screenshot has the large title cut off above the viewport.
  expect(box, 'the room heading has a box').not.toBeNull();
  expect(box!.y, 'the room heading sits below the top of the viewport').toBeGreaterThan(0);
});
