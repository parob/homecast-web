/**
 * The home view and a room's own view hide accessories independently.
 *
 * The unit tests in src/lib/__tests__/accessory-visibility.test.ts prove the two
 * lists behave; they cannot prove the Dashboard reads the right one in each
 * place, which is the whole risk in a change that touches five readers. Only
 * driving the real screen shows that, so this asserts what is actually on it.
 *
 * The sibling of screenshots/room-visibility-surfaces.spec.ts, and it exists
 * for the same reason.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const LIVING_ROOM = 'room-living-room';
const CEILING_LIGHT = 'acc-lr-ceiling';
const THERMOSTAT = 'acc-lr-thermo';

/** Seed the Living Room's stored layout before the app loads it. */
function seedLayout(visibility: Record<string, unknown>) {
  overrideEntityLayouts({ [`room:${LIVING_ROOM}`]: { visibility } });
}

/**
 * The home view: every room's section, one after another.
 *
 * `?home=` selects the home on its own; deliberately no `room=`, and no click
 * on the sidebar — clicking an already-selected home collapses its room list.
 */
async function gotoHomeView(page: Page) {
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForTimeout(3500);
  // Fail loudly if the home never rendered, rather than reading an empty screen
  // as "the accessory was hidden".
  await expect(tile(page, 'Coffee Maker')).toBeVisible();
}

/** One room's own view — what you get by tapping it in the left menu. */
async function gotoRoomView(page: Page) {
  await page.goto(`/portal?home=${HOME_ID}&room=${LIVING_ROOM}`);
  await page.waitForTimeout(3500);
  // Same guard, with an accessory of this room that nothing here ever hides.
  await expect(tile(page, 'Thermostat')).toBeVisible();
}

/**
 * A tile in the view, by the name it renders.
 *
 * Scoped to `main`: the left menu carries room names too, and an unscoped
 * query would match whichever it reached first.
 */
const tile = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true }).first();

const tileCount = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true });

test.describe('hiding an accessory from one surface leaves the other alone', () => {
  test('hidden from the home view only: gone from the home view, still in the room', async ({ page }) => {
    // The report, exactly: hide a tile on the home view and it should still be
    // there when you click into that room from the left menu.
    seedLayout({ hiddenAccessoriesHome: [CEILING_LIGHT], hiddenAccessoriesRoom: [] });
    await setupMocks(page);

    await gotoHomeView(page);
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);
    // An accessory nobody hid is untouched.
    await expect(tile(page, 'Thermostat')).toBeVisible();

    await gotoRoomView(page);
    await expect(tile(page, 'Ceiling Light')).toBeVisible();
  });

  test('hidden from the room only: gone from the room, still on the home view', async ({ page }) => {
    seedLayout({ hiddenAccessoriesHome: [], hiddenAccessoriesRoom: [CEILING_LIGHT] });
    await setupMocks(page);

    await gotoRoomView(page);
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);

    await gotoHomeView(page);
    await expect(tile(page, 'Ceiling Light')).toBeVisible();
  });

  test('the two surfaces hide different accessories at the same time', async ({ page }) => {
    seedLayout({ hiddenAccessoriesHome: [CEILING_LIGHT], hiddenAccessoriesRoom: [THERMOSTAT] });
    await setupMocks(page);

    await gotoHomeView(page);
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);
    await expect(tile(page, 'Thermostat')).toBeVisible();

    await page.goto(`/portal?home=${HOME_ID}&room=${LIVING_ROOM}`);
    await page.waitForTimeout(3500);
    await expect(tile(page, 'Ceiling Light')).toBeVisible();
    await expect(tileCount(page, 'Thermostat')).toHaveCount(0);
  });
});

test.describe('a layout written before the split', () => {
  // The migration is a read-time fallback, so this is the case that would
  // silently un-hide every already-hidden accessory if the fallback were wrong.
  test('still hides the accessory on both surfaces', async ({ page }) => {
    seedLayout({ hiddenAccessories: [CEILING_LIGHT] });
    await setupMocks(page);

    await gotoHomeView(page);
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);
    // The absence has to be about Ceiling Light, not about an empty screen.
    await expect(tile(page, 'Thermostat')).toBeVisible();

    await gotoRoomView(page);
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);
    await expect(tile(page, 'Thermostat')).toBeVisible();
  });
});
