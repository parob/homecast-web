/** #212 follow-up: the dashboard's bottom fade was behind the widgets.
 * These checks exercise the actual dashboard, paint order and pixels. Desktop
 * browser emulation does not reproduce Safari's toolbar; its expanded/collapsed
 * geometry still needs a Safari check. */
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';
test.use({ userAgent: IPHONE_UA, deviceScaleFactor: 1 });

async function openDashboard(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({ [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'gradient-ocean', brightness: 50, blur: 0 } } });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.evaluate(() => document.fonts.ready);
}

async function probeFade(page: Page) {
  return page.locator('.sticky-bottom-scrim').evaluate(el => {
    const r = el.getBoundingClientRect();
    const pointerEvents = getComputedStyle(el).pointerEvents;
    // Temporarily include the pointer-inert fade in the hit-test to read paint
    // order. No stacking styles change; restore before checking actual pixels.
    (el as HTMLElement).style.pointerEvents = 'auto';
    const topmost = document.elementFromPoint(innerWidth / 2, innerHeight - 20);
    (el as HTMLElement).style.pointerEvents = '';
    return { top: r.top, bottom: r.bottom, height: innerHeight, overContent: topmost === el, pointerEvents };
  });
}

test('widgets fade into the bottom canvas while scrolling and resizing', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone-browser surface');
  await openDashboard(page);
  for (const height of [800, 640, 956]) {
    await page.setViewportSize({ width: 440, height });
    for (const scroll of [0, 400, 1200]) {
      await page.evaluate(y => scrollTo(0, y), scroll);
      await expect.poll(async () => (await probeFade(page)).overContent).toBe(true);
      const fade = await probeFade(page);
      expect(fade.top).toBeCloseTo(height - 120, 0);
      expect(fade.bottom).toBeGreaterThanOrEqual(height);
      expect(fade.pointerEvents).toBe('none');
    }
  }
  // Real screenshot pixels must reach the canvas colour even where a tile is
  // scrolling underneath. This fails when the fade only covers the wallpaper.
  const canvas = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor.match(/[\d.]+/g)!.slice(0, 3).map(Number));
  const png = await page.screenshot({ path: testInfo.outputPath('bottom-fade.png') });
  const edge = await sharp(png).extract({ left: 20, top: 946, width: 400, height: 8 }).png().toBuffer();
  const pixels = await sharp(edge).stats();
  for (let i = 0; i < 3; i++) expect(Math.abs(pixels.channels[i].mean - canvas[i])).toBeLessThan(3);
});

test('the home menu still dims the fade and canvas together', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone-browser surface');
  await openDashboard(page);
  const original = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
  await page.getByRole('button', { name: 'My Home', exact: true }).first().click();
  await expect(page.getByRole('menu').first()).toBeVisible();
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).not.toBe(original);
  // The existing overlay sliver must paint above the dashboard's fade.
  await expect.poll(() => page.locator('[data-edge-sample="bottom"]').first().evaluate(el => {
    (el as HTMLElement).style.pointerEvents = 'auto';
    const overFade = document.elementFromPoint(innerWidth / 2, innerHeight - 20) === el;
    (el as HTMLElement).style.pointerEvents = '';
    return overFade;
  })).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor)).toBe(original);
  await expect.poll(async () => (await probeFade(page)).overContent).toBe(true);
});

test('the browser fade is absent in the native iPhone shell', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-screenshots', 'Native phone surface');
  await page.addInitScript(() => {
    Object.assign(window, { isHomecastApp: true, isHomecastIOSApp: true });
  });
  await openDashboard(page);
  await expect(page.locator('.sticky-bottom-scrim')).toHaveCount(0);
});

test('the browser fade is absent on desktop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'screenshots', 'Desktop surface');
  await openDashboard(page);
  await expect(page.locator('.sticky-bottom-scrim')).toHaveCount(0);
});
