import { test, expect } from '@playwright/test';
import { setupMocks, waitForDashboard, overrideEntityLayouts } from './mocks';
import { HOME_ID, SHARED_HOME_ID } from './fixtures';

for (const target of [
  { id: HOME_ID, other: SHARED_HOME_ID, name: 'My Home', accessory: 'Coffee Maker' },
  { id: SHARED_HOME_ID, other: HOME_ID, name: 'Beach House', accessory: 'Air Conditioner' },
  { id: 'removed-home', other: SHARED_HOME_ID, name: 'My Home', accessory: 'Coffee Maker' },
]) test(target.id === 'removed-home'
  ? 'replaces a removed home after the home list arrives'
  : `keeps ${target.name} from the URL while the first home list is loading`, async ({ page }) => {
  overrideEntityLayouts({});
  await setupMocks(page);
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
        if (typeof data === 'string' && JSON.parse(data).action === 'homes.list') {
          setTimeout(() => super.send(data), 750);
        } else {
          super.send(data);
        }
      }
    };
  });
  // Give the other home the saved preference: the explicit link must win.
  await page.addInitScript(id => localStorage.setItem('homecast-selected-home', id), target.other);
  await page.goto(`/portal?home=${target.id}`);
  await waitForDashboard(page);

  await expect(page.locator('main').getByRole('heading', { name: new RegExp(`^${target.name}`) })).toBeVisible();
  await expect(page.locator('main').getByText(target.accessory, { exact: true })).toBeVisible();
});
