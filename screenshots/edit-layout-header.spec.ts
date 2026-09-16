/**
 * Edit Layout's bar fits the copy it carries.
 *
 * This file used to hold a second test — that the bar's burger landed on the
 * same pixel as the header's, because the bar covers the header rather than
 * floating over it, and a 16px `-ml-2` once made the control jump on entering
 * the mode. **Both of those burgers are gone.** `bc633c8` retired the header's
 * ☰ on mobile web (the home name in the heading carries that menu now) and the
 * edit bar no longer draws one either, so there is no pair left to align and
 * nothing that test could guard. Retired rather than re-pointed, deliberately:
 * the ⋮ and Done are different controls in different places, so holding them to
 * each other's centre would be inventing an invariant, not preserving one. See
 * parob/homecast-web#133.
 *
 * What remains is the subtitle's height, which is real and still measured here.
 *
 * Only a real browser can show this. jsdom has no layout, so a unit test would
 * assert class strings and pass whichever inset was written.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';

const doneButton = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"] button', { hasText: 'Done' });

/** Open the dashboard and turn Edit Layout on from the ⋮ menu. */
async function enterEditLayout(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(doneButton(page)).toBeVisible();
  await page.waitForTimeout(500);
}

test.describe('Edit Layout header', () => {
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
      await waitForDashboard(page);
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
