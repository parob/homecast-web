/** Room visibility is independent between the home grid and navigation menu. */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, waitForDashboard, overrideEntityLayouts, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

const KITCHEN = 'room-kitchen';
const GARDEN = 'room-garden';

const cases = [
  { name: 'hidden from the home only', visibility: { hiddenRoomsHome: [KITCHEN], hiddenRoomsMenu: [] }, home: ['Garden'], menu: ['Kitchen', 'Garden'] },
  { name: 'hidden from the menu only', visibility: { hiddenRoomsHome: [], hiddenRoomsMenu: [KITCHEN] }, home: ['Kitchen', 'Garden'], menu: ['Garden'] },
  { name: 'different rooms hidden on each surface', visibility: { hiddenRoomsHome: [KITCHEN], hiddenRoomsMenu: [GARDEN] }, home: ['Garden'], menu: ['Kitchen'] },
  { name: 'legacy layout still hides on both surfaces', visibility: { hiddenRooms: [KITCHEN] }, home: ['Garden'], menu: ['Garden'] },
];

async function checkHome(page: Page, expected: string[]) {
  for (const name of ['Kitchen', 'Garden']) {
    const heading = page.locator('main').getByRole('button', { name, exact: true });
    if (expected.includes(name)) await expect(heading).toBeVisible();
    else await expect(heading).toHaveCount(0);
  }
  // Absences must describe hidden rooms, not an empty home.
  await expect(page.locator('main').getByRole('button', { name: 'Bedroom', exact: true })).toBeVisible();
}

async function checkMenu(page: Page, expected: string[]) {
  const narrow = (page.viewportSize()?.width ?? 1280) < 768;
  if (narrow) {
    await page.locator('main').getByRole('heading', { name: /^My Home/ })
      .getByRole('button', { name: 'My Home', exact: true }).click();
    await expect(page.getByRole('menu')).toBeVisible();
  }
  const surface = narrow ? page.getByRole('menu') : page.locator('aside');
  const row = (name: string) => surface.getByRole(narrow ? 'menuitem' : 'button', { name, exact: true });
  for (const name of ['Kitchen', 'Garden']) {
    if (expected.includes(name)) await expect(row(name)).toBeVisible();
    else await expect(row(name)).toHaveCount(0);
  }
  await expect(row('Bedroom')).toBeVisible();
  if (narrow) {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }
}

for (const scenario of cases) {
  test(scenario.name, async ({ page }) => {
    overrideSettings({});
    overrideEntityLayouts({ [`home:${HOME_ID}`]: { visibility: scenario.visibility } });
    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await waitForDashboard(page);
    await expect(page.locator('main').getByRole('heading', { name: /^My Home/ })).toBeVisible();
    await checkHome(page, scenario.home);
    await checkMenu(page, scenario.menu);
    await checkHome(page, scenario.home);
  });
}
