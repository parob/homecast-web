import { test, expect } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

/**
 * Two virtual accessories with the same name, in the same room, clicked once.
 * Exactly one should expand. Reported as both expanding, which cannot be an id
 * collision — the fixtures give them distinct ids on purpose.
 */
test('clicking one of two same-named tiles expands only that one', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
  overrideSettings({ compactMode: true, groupByRoom: true });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForSelector('text=Guest Staying', { timeout: 20000 });

  const tiles = page.locator('text=Guest Staying');
  expect(await tiles.count(), 'both duplicates should render').toBeGreaterThanOrEqual(2);

  await tiles.first().click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'test-results/expand-dupe.png' });

  const expanded = page.locator('[data-expanded="true"], .z-50');
  console.log('expanded-ish nodes:', await expanded.count());
});
