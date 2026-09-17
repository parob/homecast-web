import { test } from '@playwright/test';

/** Mock only — captures the three tile sizes proposed on homecast-cloud#154. */
test('widget span mock', async ({ page }) => {
  await page.setViewportSize({ width: 1330, height: 700 });
  await page.goto('/screenshots/fixtures/widget-span-mock.html');
  await page.waitForSelector('[data-mock-tile="large"] img');
  await page.waitForTimeout(600);
  await page.screenshot({ path: 'evidence/issue-154/sizes.png', clip: { x: 0, y: 0, width: 1330, height: 640 } });
});
