/**
 * Playwright test to validate the spotlight tutorial.
 * Captures screenshots of each tutorial step.
 */

import { test, expect, Page } from '@playwright/test';
import { setupMocks } from './mocks';

test.describe('Tutorial Spotlight Tour', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await setupMocks(page);
    await page.goto('/portal');
    await page.waitForTimeout(3000);
  });

  async function openTutorialViaSettings(page: Page) {
    // Open the three-dots menu
    await page.locator('[data-tour="header-menu"]').click();
    await page.waitForTimeout(300);

    // Click "Settings" in the dropdown
    await page.locator('[role="menuitem"]:has-text("Settings")').click();
    await page.waitForTimeout(500);

    // Click "Account" tab in settings sidebar
    await page.locator('button:has-text("Account")').click();
    await page.waitForTimeout(300);

    // Click "Replay" button
    await page.locator('button:has-text("Replay")').click();
    await page.waitForTimeout(600);
  }

  test('full tutorial walkthrough with screenshots', async ({ page }) => {
    // Verify dashboard loaded by checking for the header menu
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/output/tutorial-0-dashboard.png' });

    // Open tutorial
    await openTutorialViaSettings(page);

    // Step 0: Welcome
    await expect(page.locator('h3:has-text("Welcome to Homecast")')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'screenshots/output/tutorial-1-welcome.png' });

    // Step 1: Your Homes
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(600);
    await expect(page.locator('h3:has-text("Your Homes")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-2-homes.png' });

    // Step 2: Device Widgets
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(600);
    await expect(page.locator('h3:has-text("Device Widgets")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-3-widgets.png' });

    // Step 3: Collections — use more specific locator since sidebar also has "Collections" heading
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(600);
    await expect(page.locator('.rounded-xl h3:has-text("Collections")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-4-collections.png' });

    // Step 4: Settings & More
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(600);
    await expect(page.locator('h3:has-text("Settings & More")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-5-settings.png' });

    // Done
    await page.click('button:has-text("Done")');
    await page.waitForTimeout(500);
    await expect(page.locator('h3:has-text("Settings & More")')).not.toBeVisible();
  });

  test('close button dismisses tutorial', async ({ page }) => {
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 10000 });
    await openTutorialViaSettings(page);
    await expect(page.locator('h3:has-text("Welcome to Homecast")')).toBeVisible({ timeout: 5000 });
    // Click the X close button in the tutorial card
    await page.locator('.rounded-xl button svg.lucide-x').first().click();
    await page.waitForTimeout(500);
    await expect(page.locator('h3:has-text("Welcome to Homecast")')).not.toBeVisible();
  });

  test('back button works', async ({ page }) => {
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 10000 });
    await openTutorialViaSettings(page);
    await expect(page.locator('h3:has-text("Welcome to Homecast")')).toBeVisible({ timeout: 5000 });

    await page.click('button:has-text("Next")');
    await page.waitForTimeout(400);
    await expect(page.locator('h3:has-text("Your Homes")')).toBeVisible();

    await page.locator('button svg.lucide-chevron-left').first().click();
    await page.waitForTimeout(400);
    await expect(page.locator('h3:has-text("Welcome to Homecast")')).toBeVisible();
  });
});
