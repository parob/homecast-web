/**
 * homecast-cloud#259: Homecast's derived scenes are off for a home that never
 * chose them, and stay on for a home whose shortcuts were curated one by one.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

async function openHome(page: Page, layout: object) {
  overrideSettings({ groupByRoom: true, compactMode: false });
  await setupMocks(page);
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON();
    if (body?.operationName === 'GetStoredEntityLayout' && body.variables?.entityId === HOME_ID) {
      return route.fulfill({ json: { data: { storedEntityLayout: {
        id: `layout-${HOME_ID}`, entityType: 'home', entityId: HOME_ID, parentId: null, dataJson: null,
        layoutJson: JSON.stringify(layout),
        updatedAt: new Date().toISOString(),
      } } } });
    }
    return route.fallback();
  });
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForSelector('text=Home Mode', { timeout: 30000 });
  await page.waitForTimeout(800);
}

const shortcut = (page: Page) => page.getByText('Turn everything off', { exact: true });

test('a home that never chose shows no Homecast scenes', async ({ page }, info) => {
  await openHome(page, {});
  await page.screenshot({ path: `test-results/homecast-scenes-default-${info.project.name}.png` });
  await expect(shortcut(page)).toHaveCount(0);
});

test('a home that curated its shortcuts keeps them', async ({ page }) => {
  await openHome(page, { visibility: { hiddenActions: ['locks'] } });
  await expect(shortcut(page).first()).toBeVisible({ timeout: 20000 });
});

test('the Settings choice turns them back on', async ({ page }) => {
  await openHome(page, { visibility: { homecastScenes: true } });
  await expect(shortcut(page).first()).toBeVisible({ timeout: 20000 });
});
