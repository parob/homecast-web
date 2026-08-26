/**
 * The home view and the left menu hide rooms independently.
 *
 * The unit tests in src/lib/__tests__/room-visibility.test.ts prove the two
 * lists behave; they cannot prove the Dashboard reads the right one in each
 * place, which is the whole risk in a change that touches four readers. Only
 * driving the real screen shows that, so this asserts what is actually on it.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const KITCHEN = 'room-kitchen';
const GARDEN = 'room-garden';

/** Seed the home's stored layout before the app loads it. */
function seedLayout(visibility: Record<string, unknown>) {
  overrideEntityLayouts({ [`home:${HOME_ID}`]: { visibility } });
}

/**
 * The `?home=` parameter selects the home on its own.
 *
 * Deliberately does NOT click the home's own sidebar button the way
 * capture.spec's helper does: clicking an already-selected home *collapses* its
 * room list, emptying the `aside` of every room. Every assertion here about a
 * room being absent from the menu would then pass no matter what the code did.
 */
async function gotoMyHome(page: Page) {
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForTimeout(3500);
  // Fail loudly if the home never rendered, rather than reading an empty menu
  // as "the room was hidden".
  await expect(page.locator('aside').getByRole('button', { name: 'My Home', exact: true }).first())
    .toBeVisible();
}

/**
 * The two surfaces, addressed the way the DOM distinguishes them: the left menu
 * is the `aside` landmark, the home view is `main`. Both render a button
 * carrying the room's name, so an unscoped query matches whichever it reaches
 * first and every assertion below would pass for the wrong reason.
 */
const menuRow = (page: Page, name: string) =>
  page.locator('aside').getByRole('button', { name, exact: true });

const homeSection = (page: Page, name: string) =>
  page.locator('main').getByRole('button', { name, exact: true });

test.describe('hiding a room from one surface leaves the other alone', () => {
  test('hidden from the home view only: gone from the home view, still in the menu', async ({ page }) => {
    seedLayout({ hiddenRoomsHome: [KITCHEN], hiddenRoomsMenu: [] });
    await setupMocks(page);
    await gotoMyHome(page);

    await expect(homeSection(page, 'Kitchen')).toHaveCount(0);
    await expect(menuRow(page, 'Kitchen').first()).toBeVisible();

    // A room nobody hid is untouched on both.
    await expect(homeSection(page, 'Garden').first()).toBeVisible();
    await expect(menuRow(page, 'Garden').first()).toBeVisible();
  });

  test('hidden from the menu only: gone from the menu, still in the home view', async ({ page }) => {
    seedLayout({ hiddenRoomsHome: [], hiddenRoomsMenu: [KITCHEN] });
    await setupMocks(page);
    await gotoMyHome(page);

    await expect(menuRow(page, 'Kitchen')).toHaveCount(0);
    await expect(homeSection(page, 'Kitchen').first()).toBeVisible();

    // Guards the assertion above: an empty menu would satisfy it too.
    await expect(menuRow(page, 'Garden').first()).toBeVisible();
  });

  test('the two surfaces hide different rooms at the same time', async ({ page }) => {
    seedLayout({ hiddenRoomsHome: [KITCHEN], hiddenRoomsMenu: [GARDEN] });
    await setupMocks(page);
    await gotoMyHome(page);

    await expect(homeSection(page, 'Kitchen')).toHaveCount(0);
    await expect(menuRow(page, 'Kitchen').first()).toBeVisible();

    await expect(menuRow(page, 'Garden')).toHaveCount(0);
    await expect(homeSection(page, 'Garden').first()).toBeVisible();
  });
});

test('a layout written before the split still hides on both surfaces', async ({ page }) => {
  // The migration is a read-time fallback, so this is the case that would
  // silently un-hide every already-hidden room if the fallback were wrong.
  seedLayout({ hiddenRooms: [KITCHEN] });
  await setupMocks(page);
  await gotoMyHome(page);

  await expect(homeSection(page, 'Kitchen')).toHaveCount(0);
  await expect(menuRow(page, 'Kitchen')).toHaveCount(0);

  // Both absences have to be about Kitchen, not about an empty screen.
  await expect(homeSection(page, 'Garden').first()).toBeVisible();
  await expect(menuRow(page, 'Garden').first()).toBeVisible();
});
