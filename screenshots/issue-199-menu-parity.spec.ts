/**
 * homecast-cloud#199: the header's overflow menu and the home switcher read
 * as a flat, opaque web dropdown next to the native app's translucent
 * `UIMenu` — an solid card instead of glass, and the overflow menu's titled
 * section sat in its own separately-tinted panel rather than one continuous
 * card with hairline dividers between groups.
 *
 * `DropdownMenuContent`'s `scrim` variant (used by both menus) now paints a
 * translucent, backdrop-blurred material instead of the opaque `bg-popover`,
 * and the overflow menu's title row no longer sits inside its own
 * `bg-muted` box — it is a header row in the same card, set off by a
 * `DropdownMenuSeparator` like every other group.
 *
 * `BEFORE=1` runs this against the stashed source (`git stash` on this
 * branch), so the two runs are the actual before/after pair rather than a
 * simulated one.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

const BEFORE = process.env.BEFORE === '1';
const suffix = BEFORE ? 'before' : 'after';

async function gotoMyHome(page: Page) {
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForTimeout(3500);
}

test.describe('overflow menu and home switcher glass', () => {
  test.skip(({ isMobile }) => !isMobile, 'the reported surfaces are the mobile web header');

  test(`overflow menu — ${suffix}`, async ({ page }) => {
    await setupMocks(page);
    await gotoMyHome(page);

    const trigger = page.locator('[data-native-header="overflow"]');
    await expect(trigger).toBeVisible();
    await trigger.click();

    // The card menu, open and settled.
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(500);

    await page.screenshot({ path: `evidence/issue-199/overflow-menu-${suffix}.png` });
  });

  test(`home switcher — ${suffix}`, async ({ page }) => {
    await setupMocks(page);
    await gotoMyHome(page);

    const trigger = page.locator('[data-tour="home-selector"]').first();
    await expect(trigger).toBeVisible();
    await trigger.click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await page.waitForTimeout(500);

    await page.screenshot({ path: `evidence/issue-199/home-switcher-${suffix}.png` });
  });
});
