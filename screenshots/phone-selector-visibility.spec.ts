/** The compact selector must hand back to the large heading at the top.
 * A delayed sign-in used to capture the header's boot fallback before the
 * real row mounted, leaving both home names visible after scrolling back. */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';

test.use({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });

async function scrollTo(page: Page, y: number) {
  const target = await page.evaluate(y => {
    window.scrollTo({ top: y, behavior: 'instant' });
    return Math.min(y, document.documentElement.scrollHeight - innerHeight);
  }, y);
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(target);
}

for (const slowSignIn of [false, true]) {
  test(`selector yields to home and room headings after ${slowSignIn ? 'slow' : 'normal'} sign-in`, async ({ page }, info) => {
    test.skip(info.project.name !== 'iphone-screenshots', 'Phone browser header');
    overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
    overrideEntityLayouts({});
    await setupMocks(page);
    if (slowSignIn) {
      await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async route => {
        if (route.request().postData()?.includes('GetMe')) {
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
        await route.fallback();
      });
    }
    await page.goto(`/portal?home=${HOME_ID}`);
    await waitForDashboard(page);
    const heading = page.locator('main h2').first();
    const selector = page.locator('header .transition-opacity[aria-hidden]');
    await expect(heading).toContainText('My Home');
    await page.evaluate(() => document.fonts.ready);
    for (const where of ['home', 'room']) {
      if (where === 'room') {
        await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
        await expect(heading).toContainText('Bedroom');
      }
      for (let round = 0; round < 2; round++) {
        await scrollTo(page, 300);
        await expect(selector).toHaveAttribute('aria-hidden', 'false');
        await expect(selector).toHaveCSS('opacity', '1');
        await scrollTo(page, 0);
        await expect(heading).toBeInViewport();
        await expect(selector).toHaveAttribute('aria-hidden', 'true');
        await expect(selector).toHaveCSS('opacity', '0');
        await expect(selector).toHaveCSS('pointer-events', 'none');
      }
      // Let the scrolling compositor finish the return before capturing the
      // page; its first screenshot can still contain only the sticky wallpaper.
      await page.waitForTimeout(400);
      await page.screenshot({ path: info.outputPath(`${where}-at-top.png`) });
    }
  });
}
