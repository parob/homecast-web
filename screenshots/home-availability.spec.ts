import { test, expect } from '@playwright/test';
import { setupMocks, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';

test('keeps a backup wait consistent from the badge through the unavailable card', async ({ page }) => {
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.evaluate(async homeId => {
    // Use the module actually loaded by this page, including any Vite version.
    const url = performance.getEntriesByType('resource').map(entry => entry.name)
      .find(name => new URL(name).pathname === '/src/server/home-serving.ts');
    if (!url) throw new Error('The page serving store was not loaded');
    const serving = await import(url);
    serving.ingestHomeServingPush({ homeId, serving: { state: 'waiting', by: null, kind: null,
      graceEndsAt: new Date(Date.now() + 180_000).toISOString(), since: null } });
  }, HOME_ID);
  await expect(page.getByRole('button', { name: /Waiting for backup\. Home control/ })).toBeVisible();
  await expect(page.getByRole('main').getByText('Connecting…', { exact: true })).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'Home connection' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Waiting for backup', { exact: true }).last()).toBeVisible();
  await expect(page.getByText(/takes over in 3 min/)).toBeVisible();
  await expect(page.getByText(/been notified/)).not.toBeVisible();
});
