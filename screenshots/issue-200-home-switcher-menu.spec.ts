/**
 * homecast-cloud#200: picking a different home from the header title menu
 * closed the whole switcher the instant it was clicked — before the new
 * home's rooms had even arrived — so picking a room right after meant
 * reopening the menu from scratch. The ask is to keep the switcher open
 * across the home change so a room can be picked straight from it too.
 *
 * Two independent things closed it: the `DropdownMenuItem`'s own
 * close-on-select default (fixed in `renderSwitcherItems`, shared by every
 * trigger), and — only for the whole-home heading exercised here — that
 * heading living inside the `key={selectedHomeId-...}` wrapper in
 * `Dashboard.tsx` that intentionally remounts on a home change to reset
 * stale widget state, which tore the open dropdown down with it regardless
 * of the item fix. That second cause needed the switcher's open state lifted
 * above the remount boundary.
 */
import { test, expect } from '@playwright/test';
import { setupMocks, waitForDashboard, overrideEntityLayouts } from './mocks';
import { SHARED_HOME_ID } from './fixtures';

test.describe('Home switcher menu', () => {
  test('stays open across a home switch so a room can be picked next', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'showWebHomeMenu only renders this dropdown on the mobile web layout');
    overrideEntityLayouts({});

    // Hold the new home's rooms back so the assertions below land WHILE the
    // switch is still in flight — the exact moment the report is about, not
    // just the eventual settled state.
    await page.addInitScript((homeId) => {
      const Original = window.WebSocket;
      window.WebSocket = class extends Original {
        send(data: string | ArrayBufferLike | Blob | ArrayBufferView) {
          if (typeof data === 'string') {
            let msg: { action?: string; payload?: { homeId?: string } } | undefined;
            try { msg = JSON.parse(data); } catch { /* not JSON */ }
            if (msg?.action === 'rooms.list' && msg.payload?.homeId === homeId) {
              setTimeout(() => super.send(data), 500);
              return;
            }
          }
          super.send(data);
        }
      };
    }, SHARED_HOME_ID);

    await setupMocks(page);
    await page.goto('/portal');
    await waitForDashboard(page);

    await page.locator('[data-tour="home-selector"]').click();
    const menu = page.locator('[data-tour="home-navigation-menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Beach House', { exact: true })).toBeVisible();
    // "Front Door" only exists on My Home — SHARED_HOME_ROOMS has no room by
    // that name, unlike "Living Room"/"Bedroom"/"Kitchen" which both homes
    // happen to share.
    await expect(menu.getByText('Front Door', { exact: true })).toBeVisible();

    await menu.getByText('Beach House', { exact: true }).click();

    // Beach House's rooms.list is still held back — the menu must still be
    // open right now, not just once things settle.
    await expect(menu).toBeVisible();

    // Once the new home's rooms land, they replace the old list in the
    // still-open menu, so a room can be picked without reopening anything.
    await expect(menu.getByText('Patio', { exact: true })).toBeVisible();
    await expect(menu.getByText('Front Door', { exact: true })).toHaveCount(0);

    await menu.getByText('Patio', { exact: true }).click();
    await expect(menu).toHaveCount(0);
    await expect(page.locator('main').getByRole('heading', { name: 'Patio' })).toBeVisible();
  });
});
