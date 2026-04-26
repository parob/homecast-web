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

// ── Mobile Tutorial Tests ─────────────────────────────────────────────────────

test.describe('Tutorial Spotlight Tour (Mobile)', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'iPhone only');
    await setupMocks(page);
    await page.goto('/portal');
    await page.waitForTimeout(3000);
  });

  async function openTutorialMobile(page: Page) {
    // On mobile, open the three-dots menu
    await page.locator('[data-tour="header-menu"]').click();
    await page.waitForTimeout(300);

    // Click "Settings"
    await page.locator('[role="menuitem"]:has-text("Settings")').click();
    await page.waitForTimeout(500);

    // Mobile settings uses drill-down nav — tap "Account" row
    await page.locator('button:has-text("Account")').click();
    await page.waitForTimeout(300);

    // Click "Replay" button
    await page.locator('button:has-text("Replay")').click();
    await page.waitForTimeout(600);
  }

  test('mobile tutorial walkthrough with screenshots', async ({ page }) => {
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 10000 });
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-0-dashboard.png' });

    await openTutorialMobile(page);

    // Step 0: Welcome
    await expect(page.locator('h3:has-text("Welcome to Homecast")')).toBeVisible({ timeout: 5000 });
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-1-welcome.png' });

    // Step 1: Your Homes — opens the sidebar sheet, spotlights sidebar-homes inside it.
    // Regression: prior bug returned the hidden desktop sidebar (rect 0×0) so
    // the ring never rendered. Assert the spotlight ring lands on the visible
    // homes section in the open sheet.
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1500);
    await expect(page.locator('h3:has-text("Your Homes")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-2-homes.png' });
    const homesRingRect = await page.evaluate(() => {
      // The ring is the absolute-positioned div with z-index 10045 inside the
      // tutorial overlay (which itself is at z-index 10040).
      const candidates = Array.from(document.querySelectorAll('div'));
      const ring = candidates.find(d => {
        const cs = getComputedStyle(d);
        return cs.position === 'absolute' && cs.zIndex === '10045';
      });
      const r = ring?.getBoundingClientRect();
      return r ? { top: r.top, left: r.left, w: r.width, h: r.height } : null;
    });
    expect(homesRingRect, 'Your Homes spotlight ring should be present and sized').not.toBeNull();
    expect(homesRingRect!.w, 'ring width should be a real homes section').toBeGreaterThan(50);
    expect(homesRingRect!.h, 'ring height should be a real homes section').toBeGreaterThan(50);

    // Step 2: Device Widgets
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1200);
    await expect(page.locator('h3:has-text("Device Widgets")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-3-widgets.png' });

    // Step 3: Share a home or room — stage 1 (spotlight home only)
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1500);
    await expect(page.locator('h3:has-text("Share a home or room")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-4-share-stage1.png' });

    // Step 4: Then choose Share — stage 2 (open context menu)
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1800);
    await expect(page.locator('h3:has-text("Then choose Share")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-5-share-stage2.png' });

    // Step 5: Share a single device
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(2000);
    await expect(page.locator('h3:has-text("Share a single device")')).toBeVisible();
    const stage6Debug = await page.evaluate(() => {
      const sheet = document.querySelector('[role="dialog"]');
      const sheetState = sheet?.getAttribute('data-state');
      const sheetVisible = sheet ? (sheet as HTMLElement).offsetWidth > 0 : false;
      const ctxMenu = document.querySelector('[role="menu"]');
      const ctxState = ctxMenu?.getAttribute('data-state');
      return { sheetState, sheetVisible, ctxMenuExists: !!ctxMenu, ctxState };
    });
    // eslint-disable-next-line no-console
    console.log('STAGE 6 DEBUG:', JSON.stringify(stage6Debug));
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-6-share-device.png' });

    // Step 6: Collections
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1500);
    await expect(page.locator('.rounded-xl h3:has-text("Collections")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-7-collections.png' });

    // Step 7: Automations
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1500);
    await expect(page.locator('h3:has-text("Automations")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-8-automations.png' });

    // Step 8: Settings & More
    await page.click('button:has-text("Next")');
    await page.waitForTimeout(1200);
    await expect(page.locator('h3:has-text("Settings & More")')).toBeVisible();
    await page.screenshot({ path: 'screenshots/output/tutorial-mobile-9-settings.png' });

    // Done
    await page.click('button:has-text("Done")');
    await page.waitForTimeout(500);
    await expect(page.locator('h3:has-text("Settings & More")')).not.toBeVisible();
  });
});
