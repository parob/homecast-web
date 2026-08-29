/**
 * Leaving Edit Layout should put the revealed items away, not blink them out.
 *
 * Editing reveals every hidden tile, room and home so they can be brought back.
 * Hitting Done takes them away again — and it used to do it in a single frame:
 * `setShowHiddenItems(false)` unmounts them, so half the screen vanishes
 * between one paint and the next. The edit bar directly above them already
 * animates out on the same tap, which is what made the cut so obvious.
 *
 * The assertion that carries this is the one at +80ms: the tile has to still be
 * IN THE DOM after Done, fading, because a thing that is gone cannot animate.
 * It is the exact shape of the fix, and it fails on the old code.
 *
 * A real browser, not jsdom: this is a computed opacity mid-transition, and
 * jsdom neither runs transitions nor computes a style to read one from.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const LIVING_ROOM = 'room-living-room';
const CEILING_LIGHT = 'acc-lr-ceiling';

/** Seed the Living Room's stored layout before the app loads it. */
function seedLayout(visibility: Record<string, unknown>) {
  overrideEntityLayouts({ [`room:${LIVING_ROOM}`]: { visibility } });
}

/** A tile in the view, by the name it renders. Scoped to `main` — the left
 *  menu carries room names too. */
const tile = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true }).first();

const tileCount = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true });

/** Edit Layout is entered by a hold or from the ⋮ menu; the menu is the route
 *  that does not also pick a tile up. */
async function enterEditLayout(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(page.locator('[data-testid="edit-layout-bar"]')).toBeVisible();
  await page.waitForTimeout(500);
}

test.describe('hidden items on the way out of Edit Layout', () => {
  test('Done fades the revealed tile away instead of cutting it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    seedLayout({ hiddenAccessoriesHome: [CEILING_LIGHT], hiddenAccessoriesRoom: [] });
    await setupMocks(page);

    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    // Fail loudly if the home never rendered, rather than reading an empty
    // screen as "the accessory was hidden".
    await expect(tile(page, 'Coffee Maker')).toBeVisible();
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);

    await enterEditLayout(page);
    await expect(tile(page, 'Ceiling Light')).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();

    /*
     * Measured inside the page, in one round trip, and deliberately not as a
     * `waitForTimeout` followed by a locator: the whole exit is 200ms, and
     * resolving a locator from the test process spends an unknown slice of that
     * on the wire. Read from the test side this looked like the tile having
     * already gone — which is the very thing being asserted about.
     */
    const mid = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 80));
      const named = Array.from(document.querySelectorAll('main h3'))
        .filter(n => n.textContent?.trim() === 'Ceiling Light');
      const card = named[0]?.closest('[data-hidden-item="true"]') as HTMLElement | null;
      return {
        onScreen: named.length,
        exiting: document.documentElement.getAttribute('data-hidden-exiting'),
        opacity: card ? parseFloat(getComputedStyle(card).opacity) : null,
      };
    });

    // Still there, still marked, and on its way out rather than solid.
    expect(mid.onScreen, 'the revealed tile should still be mounted, fading').toBe(1);
    expect(mid.exiting).toBe('true');
    expect(mid.opacity, 'the revealed tile should be fading, not solid').not.toBeNull();
    expect(mid.opacity!).toBeLessThan(0.4);

    // …and gone once the animation has run.
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0, { timeout: 2000 });
  });

  /**
   * A revealed hidden ROOM leaves as one thing, heading and tiles together.
   *
   * Its own tiles need not be hidden — hiding the room takes the whole section —
   * so this is not covered by the tile case above, and marking only the heading
   * would fade the words while the widgets under them blinked out.
   */
  test('Done fades a revealed room away with everything in it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts({ [`home:${HOME_ID}`]: { visibility: { hiddenRoomsHome: ['room-kitchen'], hiddenRoomsMenu: [] } } });
    await setupMocks(page);

    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    await expect(tile(page, 'Thermostat')).toBeVisible();
    await expect(tileCount(page, 'Coffee Maker')).toHaveCount(0);

    await enterEditLayout(page);
    await expect(tile(page, 'Coffee Maker')).toBeVisible();

    await page.getByRole('button', { name: 'Done' }).click();

    const mid = await page.evaluate(async () => {
      await new Promise(r => setTimeout(r, 80));
      const section = document.querySelector('main [data-room-name="Kitchen"]') as HTMLElement | null;
      return {
        marked: section?.getAttribute('data-hidden-item') ?? null,
        opacity: section ? parseFloat(getComputedStyle(section).opacity) : null,
      };
    });

    expect(mid.marked, 'the revealed room section should still be there, marked').toBe('true');
    expect(mid.opacity!).toBeLessThan(1);

    await expect(tileCount(page, 'Coffee Maker')).toHaveCount(0, { timeout: 2000 });
  });
});
