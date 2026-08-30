/**
 * Settings → Sharing must actually render under the harness.
 *
 * The two screenshot tests that touch this screen are both guarded by
 * `if (await dialog.isVisible())`, so a crash into the error boundary skips
 * their body instead of failing them. These assert unconditionally.
 *
 * Run: cd app-web/screenshots && npx playwright test sharing-settings.spec.ts
 */

import { test, expect, Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

async function gotoMyHome(page: Page) {
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForTimeout(3000);
  const myHome = page.getByRole('button', { name: 'My Home', exact: true }).first();
  if (await myHome.isVisible()) {
    await myHome.click({ force: true });
    await page.waitForTimeout(1500);
  }
}

async function openSettings(page: Page, tabLabel: string) {
  const menuTrigger = page.locator('[data-tour="header-menu"]').first();
  await menuTrigger.click({ force: true });
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: 'Settings', exact: true }).click();
  await page.waitForTimeout(500);
  await page.locator('[role="dialog"] nav button', { hasText: tabLabel }).first().click({ force: true });
  await page.waitForTimeout(600);
}

test.describe('Settings → Sharing', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await setupMocks(page);
    await gotoMyHome(page);
  });

  test('renders instead of crashing into the error boundary', async ({ page }) => {
    const pageErrors: Error[] = [];
    page.on('pageerror', (e) => pageErrors.push(e));

    await openSettings(page, 'Sharing');

    // The settings dialog must still be on screen. The error boundary is not a
    // [role="dialog"], so a crash takes this to 0.
    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible();

    // And the Sharing panel's own tabs must be there — a dialog that survived
    // but rendered nothing useful is not a pass.
    await expect(page.getByRole('tab', { name: /Authorized Apps/i })).toBeVisible();

    expect(
      pageErrors.map((e) => e.message),
      'Settings → Sharing threw while rendering',
    ).toEqual([]);
  });
});
