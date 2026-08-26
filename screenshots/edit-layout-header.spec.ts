/**
 * Edit Layout's bar must not move the menu button.
 *
 * The bar covers the app header rather than floating over it, so the burger is
 * drawn twice — once by the header, once by the bar — and the two have to land
 * on the same pixel or entering the mode makes the control jump. It did: the
 * bar's button carried `-ml-2` against the header's `px-2`, a 16px shift left.
 *
 * Only a real browser can show this. jsdom has no layout, so a unit test would
 * assert class strings and pass whichever inset was written.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

/** The header's burger, and the one the Edit Layout bar draws over it. */
const headerBurger = (page: Page) => page.locator('[data-tour="sidebar-menu"]');
const editBarBurger = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"] button[aria-label="Open menu"]');

async function centre(locator: ReturnType<typeof headerBurger>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('menu button has no box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Open the dashboard and turn Edit Layout on from the ⋮ menu. */
async function enterEditLayout(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(editBarBurger(page)).toBeVisible();
  await page.waitForTimeout(500);
}

test.describe('Edit Layout header', () => {
  test('the menu button stays where it was', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(headerBurger(page)).toBeVisible({ timeout: 20000 });

    const before = await centre(headerBurger(page));

    // Edit Layout is entered by a hold or from the ⋮ menu; the menu is the
    // route that does not also pick a tile up.
    await enterEditLayout(page);

    const after = await centre(editBarBurger(page));

    expect(Math.abs(after.x - before.x), `burger moved ${after.x - before.x}px horizontally`).toBeLessThanOrEqual(1);
    expect(Math.abs(after.y - before.y), `burger moved ${after.y - before.y}px vertically`).toBeLessThanOrEqual(1);
  });

  /**
   * The subtitle is two lines: what the gesture does, and where hidden things
   * went. Aligning the burger cost the column 20px, and the instruction it used
   * to carry needed 248px against a column of 196px at 390pt and 234px at 428px
   * — so it wrapped to three lines. Shorter copy is what fixes that, and only a
   * real browser can tell whether it still fits: this measures rendered height
   * against line-height at the narrowest phones we serve.
   */
  for (const width of [375, 390, 428]) {
    test(`the subtitle stays on two lines at ${width}px`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

      await page.setViewportSize({ width, height: 844 });
      await setupMocks(page);
      await page.goto(`/portal?home=${HOME_ID}`);
      await expect(headerBurger(page)).toBeVisible({ timeout: 20000 });
      await enterEditLayout(page);

      const lines = await page.locator('[data-testid="edit-layout-bar"]').evaluate((bar) => {
        const col = bar.querySelector('div.flex-1') as HTMLElement;
        // Skip the title; the two after it are the subtitle.
        return Array.from(col.querySelectorAll('span')).slice(1).map((el) => {
          const lineHeight = parseFloat(getComputedStyle(el).lineHeight);
          return {
            text: (el.textContent || '').trim(),
            lines: Math.round(el.getBoundingClientRect().height / lineHeight),
          };
        });
      });

      expect(lines).toHaveLength(2);
      for (const line of lines) {
        expect(line.lines, `"${line.text}" wrapped onto ${line.lines} lines at ${width}px`).toBe(1);
      }
    });
  }
});
