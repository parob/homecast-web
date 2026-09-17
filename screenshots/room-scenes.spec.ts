import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

const sceneName = 'Relax with warm evening lighting throughout the living room';
async function openHome(page: Page, groupByRoom = true) {
  overrideSettings({ compactMode: true, groupByRoom });
  await setupMocks(page);
  const saves: any[] = [];
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON();
    if (body.operationName === 'GetScenes') return route.fulfill({ json: { data: { scenes: [
      { id: 'room-scene', name: sceneName, actionCount: 1, actionSetType: 'HMActionSetTypeUserDefined', automationName: null, actions: JSON.stringify([{ accessoryId: 'acc-lr-lamp', accessoryName: 'Floor Lamp', characteristicType: 'power_state', targetValue: true }]) },
      { id: 'home-scene', name: 'Good night everywhere', actionCount: 2, actionSetType: 'HMActionSetTypeUserDefined', automationName: null, actions: JSON.stringify([{ accessoryId: 'acc-lr-lamp' }, { accessoryId: 'acc-br-light' }]) },
    ] } } });
    if (body.operationName === 'UpdateStoredEntityLayout') {
      saves.push(body);
      return route.fulfill({ json: { data: { updateStoredEntityLayout: { success: true, entity: {
        id: `layout-${body.variables.entityId}`, ...body.variables, updatedAt: new Date().toISOString(),
      } } } } });
    }
    return route.fallback();
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.getByText(sceneName, { exact: true })).toBeVisible({ timeout: 30000 });
  return { saves, errors };
}

test('room scenes, readable names, inline status and automation menu', async ({ page }, info) => {
  const { errors } = await openHome(page);
  const room = page.locator('[data-room-name="Living Room"]');
  await expect(room.getByText(sceneName, { exact: true })).toBeVisible();
  const wholeHome = page.locator('[data-room-container]').filter({ has: page.getByText('Good night everywhere', { exact: true }) });
  await expect(wholeHome.getByRole('button', { name: /^Scenes/ })).toBeVisible();
  const text = room.getByText(sceneName, { exact: true });
  expect(await text.evaluate(el => el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)).toBe(true);
  await expect.poll(async () => page.locator('[data-scene-tile-content]').evaluateAll(nodes => {
    const heights = nodes.map(node => node.parentElement!.getBoundingClientRect().height);
    return Math.max(...heights) - Math.min(...heights);
  })).toBeLessThanOrEqual(1);
  const status = page.locator('[aria-label="Status"]').first();
  await expect(status).toBeVisible();
  expect((await status.getByRole('button').first().boundingBox())!.height).toBeLessThanOrEqual(30);
  await status.getByRole('button').first().click();
  await expect(page.getByRole('tooltip').first()).toBeVisible();
  await page.mouse.move(0, 0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await page.screenshot({ path: `test-results/room-scenes-${info.project.name}.png`, fullPage: true });
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Automations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();
  await expect(page.getByText('Motion Light - Living Room', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `test-results/automations-${info.project.name}.png` });
  expect(errors).toEqual([]);
});

test('scene location changes the grid without changing its targets', async ({ page }) => {
  const { saves } = await openHome(page);
  await page.getByText(sceneName, { exact: true }).click();
  await page.getByLabel('Scene location').selectOption('room-bedroom');
  await expect.poll(() => saves.length).toBeGreaterThan(0);
  const saved = saves.find(s => JSON.stringify(s.variables).includes('sceneRooms'));
  expect(JSON.stringify(saved.variables)).toContain('room-bedroom');
});


test('touch editing can hide and restore an in-room scene', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone', 'Touch editing');
  const { saves } = await openHome(page);
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout', exact: true }).click();
  await page.getByRole('button', { name: `Hide ${sceneName}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Unhide ${sceneName}`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Unhide ${sceneName}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Hide ${sceneName}`, exact: true })).toBeVisible();
  const layouts = saves.map(s => JSON.parse(s.variables.layoutJson));
  expect(layouts.some(l => l.visibility?.hiddenScenes?.includes('room-scene'))).toBe(true);
  expect(layouts.at(-1).visibility.hiddenScenes).toEqual([]);
});

for (const grouped of [true, false]) test(`desktop scenes reorder in ${grouped ? 'rooms' : 'the ungrouped home'}`, async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'Mouse drag');
  const { saves } = await openHome(page, grouped);
  const source = page.getByText(sceneName, { exact: true });
  const target = page.locator(grouped ? '[data-room-name="Living Room"]' : '[data-room-name="All Accessories"]').getByRole('heading', { name: 'Ceiling Light', exact: true });
  await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!;
  const to = (await target.boundingBox())!;
  await page.mouse.move(from.x + 20, from.y + 8);
  await page.mouse.down();
  await page.mouse.move(from.x + 40, from.y + 8, { steps: 5 });
  await page.mouse.move(to.x + 20, to.y + 8, { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => saves.some(s => s.variables.entityId === (grouped ? 'room-living-room' : HOME_ID))).toBe(true);
  const layout = JSON.parse(saves.find(s => s.variables.entityId === (grouped ? 'room-living-room' : HOME_ID)).variables.layoutJson);
  const order = grouped ? layout.itemOrder : layout.dashboardItemOrder.all;
  expect(order.indexOf('scene:room-scene')).toBeLessThan(order.indexOf('acc-lr-ceiling'));
});
