import { test, expect, type Page } from '@playwright/test';
import { setupMocks, waitForDashboard, overrideEntityLayouts, overrideSettings } from './mocks';

const card = (page: Page) => page.getByTestId('tutorial-card');

async function openTutorial(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByRole('button', { name: 'Replay', exact: true }).click();
  await expect(card(page).locator('h3')).toHaveText('Welcome to Homecast');
}

// The spotlight is an SVG mask, not a separate border div. Measure its actual
// cutout against the visible target after both have settled into place.
async function expectSpotlight(page: Page, target: string) {
  await expect.poll(() => page.evaluate(tour => {
    const el = Array.from(document.querySelectorAll(`[data-tour="${tour}"]`))
      .find(node => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
    const cutout = document.querySelector('#tour-spotlight-mask g rect');
    if (!el || !cutout) return false;
    const rect = el.getBoundingClientRect();
    const actual = ['x', 'y', 'width', 'height'].map(key => Number(cutout.getAttribute(key)));
    const expected = [rect.left - 8, rect.top - 8, rect.width + 16, rect.height + 16];
    return rect.width > 10 && rect.height > 10
      && actual.every((value, i) => Math.abs(value - expected[i]) < 3);
  }, target), { message: `spotlight must follow the visible ${target}` }).toBe(true);
}

test.describe('Tutorial Spotlight Tour', () => {
  test.beforeEach(async ({ page }) => {
    overrideEntityLayouts({});
    overrideSettings({});
    await setupMocks(page);
    await page.goto('/portal');
    await waitForDashboard(page);
    await openTutorial(page);
  });

  test('walks through the current navigation and sharing controls', async ({ page }, testInfo) => {
    const phone = testInfo.project.name === 'iphone-screenshots';
    const steps = [
      ['Your Homes', phone ? 'home-selector' : 'sidebar-homes'],
      ['Accessory Widgets', 'widget-area'],
      ['Share homes, rooms, or accessories', phone ? 'header-menu' : 'widget-area'],
      ['Then choose Share', phone ? 'share-menu-item' : 'sidebar-home-share-item'],
      ['Collections', phone ? 'home-navigation-menu' : 'sidebar-collections'],
      ['Automations', 'automations'],
      ['Settings & More', 'header-menu'],
    ];
    for (const [title, target] of steps) {
      await card(page).getByText('Next', { exact: true }).click();
      await expect(card(page).locator('h3')).toHaveText(title);
      await expectSpotlight(page, target);
      if (phone) await expect(card(page)).not.toContainText(/long.press|right.click/i);
      if (process.env.CAPTURE_TOUR && ['Your Homes', 'Then choose Share', 'Collections'].includes(title)) {
        await page.screenshot({ path: testInfo.outputPath(`${title.replaceAll(' ', '-')}.png`) });
      }
    }
    await card(page).getByText('Done', { exact: true }).click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('[data-tour="home-navigation-menu"]')).toHaveCount(0);
    await expect(page.locator('[data-tour="sidebar-home-share-item"]')).toHaveCount(0);
  });

  test('Previous step returns to the welcome card', async ({ page }) => {
    await card(page).getByText('Next', { exact: true }).click();
    await expect(card(page).locator('h3')).toHaveText('Your Homes');
    await card(page).locator('[aria-label="Previous step"]').click();
    await expect(card(page).locator('h3')).toHaveText('Welcome to Homecast');
  });

  test('a narrow mouse layout uses the title menu and header sharing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Mouse layout coverage');
    await page.setViewportSize({ width: 375, height: 812 });
    await card(page).getByText('Next', { exact: true }).click();
    await expectSpotlight(page, 'home-selector');
    for (let step = 0; step < 3; step++) {
      await card(page).getByText('Next', { exact: true }).click();
    }
    await expect(card(page).locator('h3')).toHaveText('Then choose Share');
    await expectSpotlight(page, 'share-menu-item');
    await card(page).locator('[aria-label="Close tutorial"]').click();
    await expect(card(page)).toHaveCount(0);
  });

  test('closing during the sharing demonstration dismisses its menu too', async ({ page }) => {
    for (let step = 0; step < 4; step++) {
      await card(page).getByText('Next', { exact: true }).click();
    }
    await expect(card(page).locator('h3')).toHaveText('Then choose Share');
    await expect(page.locator('[data-tour="share-menu-item"], [data-tour="sidebar-home-share-item"]')).toBeVisible();
    await card(page).locator('[aria-label="Close tutorial"]').click();
    await expect(card(page)).toHaveCount(0);
    await expect(page.locator('[data-tour="share-menu-item"], [data-tour="sidebar-home-share-item"]')).toHaveCount(0);
  });
});
