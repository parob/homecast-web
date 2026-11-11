/**
 * homecast-cloud#259: the home's top shelf is headed "Scenes", but it also
 * holds roomless helper accessories. With Homecast scenes switched off and no
 * Apple Home scene placed at home level, the heading named something that was
 * not there — "Scenes" over a Home Mode tile.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

async function openHome(page: Page, scenes: unknown[]) {
  overrideSettings({ groupByRoom: true, compactMode: false });
  await setupMocks(page);
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON();
    if (body?.operationName === 'GetStoredEntityLayout' && body.variables?.entityId === HOME_ID) {
      return route.fulfill({ json: { data: { storedEntityLayout: {
        id: `layout-${HOME_ID}`, entityType: 'home', entityId: HOME_ID, parentId: null, dataJson: null,
        layoutJson: JSON.stringify({ visibility: { hiddenSummarySections: ['actions'] } }),
        updatedAt: new Date().toISOString(),
      } } } });
    }
    if (body?.operationName === 'GetScenes') return route.fulfill({ json: { data: { scenes } } });
    return route.fallback();
  });
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForSelector('text=Home Mode', { timeout: 30000 });
}

const shelf = (page: Page) => page.locator('[data-room-container]').filter({ has: page.getByText('Home Mode', { exact: true }) }).first();

test('no scenes at home level: the shelf carries no "Scenes" heading', async ({ page }, info) => {
  await openHome(page, []);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `test-results/issue-259-${info.project.name}.png` });
  await expect(shelf(page).getByRole('button', { name: /^Scenes/ })).toHaveCount(0);
});

test('a home-level scene keeps the heading', async ({ page }) => {
  await openHome(page, [
    { id: 'home-scene', name: 'Good night everywhere', actionCount: 2, actionSetType: 'HMActionSetTypeUserDefined', automationName: null,
      actions: JSON.stringify([{ accessoryId: 'acc-lr-lamp' }, { accessoryId: 'acc-br-light' }]) },
  ]);
  await expect(page.getByText('Good night everywhere', { exact: true })).toBeVisible({ timeout: 20000 });
  const wholeHome = page.locator('[data-room-container]').filter({ has: page.getByText('Good night everywhere', { exact: true }) });
  await expect(wholeHome.getByRole('button', { name: /^Scenes/ })).toBeVisible();
});
