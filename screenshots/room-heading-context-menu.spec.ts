/**
 * The home view's room heading offers Hide Room from Home on right-click.
 *
 * `room-visibility-surfaces.spec.ts` seeds a stored layout and reads the screen
 * back, which proves the Dashboard *reads* the right surface. It cannot prove a
 * control *writes* the right one — and that is the whole risk here, because the
 * two neighbouring routes write different surfaces: the sidebar row writes
 * `menu`, the room view's own heading writes both. A menu item that quietly
 * wrote either of those would look correct on the home view and be wrong.
 *
 * So these drive the real menu and then check both surfaces.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const KITCHEN = 'room-kitchen';

/** Seed the home's stored layout before the app loads it. */
function seedLayout(visibility: Record<string, unknown>) {
  overrideEntityLayouts({ [`home:${HOME_ID}`]: { visibility } });
}

/**
 * The `?home=` parameter selects the home on its own — deliberately no click on
 * the sidebar, which would collapse the room list and empty the `aside` that
 * half of these assertions read.
 */
async function gotoMyHome(page: Page) {
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForTimeout(3500);
  await expect(page.locator('aside').getByRole('button', { name: 'My Home', exact: true }).first())
    .toBeVisible();
}

/**
 * The heading of one room's section on the home view.
 *
 * Addressed through `[data-room-container]` rather than by role and name: the
 * left menu carries a button with the same room name, and the heading is the
 * one inside the section.
 */
const heading = (page: Page, room: string) =>
  page.locator(`[data-room-container][data-room-name="${room}"] button`).first();

const homeSection = (page: Page, room: string) =>
  page.locator(`[data-room-container][data-room-name="${room}"]`);

const menuRow = (page: Page, name: string) =>
  page.locator('aside').getByRole('button', { name, exact: true });

const menuItem = (page: Page, name: string) =>
  page.getByRole('menuitem', { name, exact: true });

test.describe('desktop', () => {
  test.skip(({ isMobile }) => !!isMobile, 'context menus are desktop-only by design');

  test('right-click offers Hide Room from Home, and it hides only the home view', async ({ page }) => {
    seedLayout({ hiddenRoomsHome: [], hiddenRoomsMenu: [] });
    await setupMocks(page);
    await gotoMyHome(page);

    // Present on both surfaces to start with, so neither assertion below can
    // pass because the room was never there.
    await expect(homeSection(page, 'Kitchen')).toHaveCount(1);
    await expect(menuRow(page, 'Kitchen').first()).toBeVisible();

    await heading(page, 'Kitchen').click({ button: 'right' });
    await expect(menuItem(page, 'Hide Room from Home')).toBeVisible();
    await menuItem(page, 'Hide Room from Home').click();

    // Gone from the home view...
    await expect(homeSection(page, 'Kitchen')).toHaveCount(0);
    // ...and still in the left menu. This is the half that fails if the item
    // writes `menu` or both surfaces instead of `home`.
    await expect(menuRow(page, 'Kitchen').first()).toBeVisible();

    // The absence has to be about Kitchen, not about an emptied screen.
    await expect(homeSection(page, 'Garden')).toHaveCount(1);
  });

  test('a room already hidden from the home view offers Show Room on Home', async ({ page }) => {
    // Hidden from the home view only. Its heading reaches the screen because
    // hidden items are being shown — the round trip the ⋮ menu opens.
    seedLayout({ hiddenRoomsHome: [KITCHEN], hiddenRoomsMenu: [] });
    await setupMocks(page);
    await gotoMyHome(page);

    await expect(homeSection(page, 'Kitchen')).toHaveCount(0);
    await page.locator('[data-tour="header-menu"]').click();
    await page.getByRole('menuitem', { name: 'Show Hidden Items' }).click();
    await expect(homeSection(page, 'Kitchen')).toHaveCount(1);

    await heading(page, 'Kitchen').click({ button: 'right' });
    // The label reads the stored state, not the fact that it is on screen.
    await expect(menuItem(page, 'Show Room on Home')).toBeVisible();
    await expect(menuItem(page, 'Hide Room from Home')).toHaveCount(0);
  });

  test('a room hidden this way is still reachable, and still has its contents', async ({ page }) => {
    // The surface split from the user's side rather than the DOM's: hiding a
    // room from the home view must not amount to hiding the room. If the item
    // ever wrote both surfaces, the row it is clicked from would disappear too
    // and there would be no way back to what is inside.
    seedLayout({ hiddenRoomsHome: [], hiddenRoomsMenu: [] });
    await setupMocks(page);
    await gotoMyHome(page);

    await heading(page, 'Kitchen').click({ button: 'right' });
    await menuItem(page, 'Hide Room from Home').click();
    await expect(homeSection(page, 'Kitchen')).toHaveCount(0);

    // Still in the menu to be clicked...
    await expect(menuRow(page, 'Kitchen').first()).toBeVisible();

    // ...and its own view still has what is in it. Navigated by URL rather than
    // by clicking the row, so this asserts the room's contents rather than the
    // sidebar's click handling, which is not what this change touches.
    await page.goto(`/portal?home=${HOME_ID}&room=${KITCHEN}`);
    await page.waitForTimeout(3500);
    await expect(page.locator('main').getByText('Coffee Maker', { exact: true }).first())
      .toBeVisible();
  });
});

test.describe('touch', () => {
  test.skip(({ isMobile }) => !isMobile, 'this is about what touch must NOT get');

  test('no context menu on the room heading', async ({ page }) => {
    // CLAUDE.md: touch has no context menus at all. Radix opens one on its own
    // 700ms hold as well as on `contextmenu`, and an open menu puts
    // `pointer-events: none` on the body — so the trigger must not be rendered,
    // not merely be hard to reach.
    seedLayout({ hiddenRoomsHome: [], hiddenRoomsMenu: [] });
    await setupMocks(page);
    // Not `gotoMyHome`: there is no `aside` at this width, so its guard would
    // fail before the test ran.
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(homeSection(page, 'Kitchen')).toHaveCount(1, { timeout: 15_000 });

    const box = await heading(page, 'Kitchen').boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;

    // A real hold, well past Radix's 700ms timer.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await page.waitForTimeout(1100);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);

    await expect(page.locator('[role="menu"]')).toHaveCount(0);
  });
});
