/**
 * Leaving Edit Layout should put the revealed items away, not blink them out.
 *
 * Editing reveals every hidden tile, room and home so they can be brought back.
 * Hitting Done takes them away again — and it used to do it in a single frame:
 * `setShowHiddenItems(false)` unmounts them, so half the screen vanishes
 * between one paint and the next. The edit bar directly above them already
 * animates out on the same tap, which is what made the cut so obvious.
 *
 * What both tests below assert is the shape of the fix rather than a number:
 * that there exists a frame where the thing is STILL THERE and PART WAY GONE.
 * A cut has no such frame — it is present, then absent — so this fails on the
 * old code for the right reason, and it cannot be satisfied by a marker that is
 * merely present.
 *
 * Sampled per animation frame from inside the page, never as a `waitForTimeout`
 * at a chosen instant. Two things make a fixed instant wrong: the whole exit is
 * 260ms, less than a locator round trip; and React's own commit puts a variable
 * ~100ms between the tap and the transition starting, so the one instant you
 * picked lands before it as often as during it.
 *
 * A real browser, not jsdom, which has neither transitions nor a computed style
 * to read one from.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const LIVING_ROOM = 'room-living-room';
const CEILING_LIGHT = 'acc-lr-ceiling';

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

/**
 * Tap Done and watch one element leave, frame by frame.
 *
 * `find` runs in the page and returns the element to watch, or null if it is
 * not there — which is itself the answer on the old code, where nothing is ever
 * marked. Returns every opacity seen while it was still in the document.
 */
async function opacitiesWhileLeaving(page: Page, find: string) {
  return page.evaluate(async (findSrc: string) => {
    const locate = new Function(`return (${findSrc})`)() as () => HTMLElement | null;
    const done = Array.from(document.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Done') as HTMLButtonElement | undefined;
    if (!done) throw new Error('no Done button — is Edit Layout running?');

    const seen: number[] = [];
    const t0 = performance.now();
    done.click();
    await new Promise<void>(resolve => {
      const step = () => {
        const el = locate();
        if (el && document.body.contains(el)) seen.push(parseFloat(getComputedStyle(el).opacity));
        // Generous: 260ms of transition after a commit that can take ~100ms,
        // and a slow CI runner stretches both.
        if (performance.now() - t0 < 1500) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return { seen, stillThere: !!locate() };
  }, find);
}

test.describe('hidden items on the way out of Edit Layout', () => {
  test('Done fades the revealed tile away instead of cutting it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts({
      [`room:${LIVING_ROOM}`]: { visibility: { hiddenAccessoriesHome: [CEILING_LIGHT], hiddenAccessoriesRoom: [] } },
    });
    await setupMocks(page);

    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    // Fail loudly if the home never rendered, rather than reading an empty
    // screen as "the accessory was hidden".
    await expect(tile(page, 'Coffee Maker')).toBeVisible();
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);

    await enterEditLayout(page);
    await expect(tile(page, 'Ceiling Light')).toBeVisible();

    /*
     * The layer that actually paints the tile, not the Card.
     *
     * WidgetWrapper draws the coloured glass in a SIBLING of the content, and
     * the Card inside is `!bg-transparent` — so watching the Card would report
     * a clean fade while the coloured rectangle sat there at full strength
     * until React took it away. That was the first version of this fix, and
     * this is the assertion that would have caught it.
     */
    const { seen, stillThere } = await opacitiesWhileLeaving(page, `() => {
      const label = Array.from(document.querySelectorAll('main h3'))
        .find(n => n.textContent?.trim() === 'Ceiling Light');
      const content = label?.closest('[data-hidden-item="true"]');
      // WidgetWrapper's first child IS the glass. Reached positionally and then
      // checked for the marker, rather than by querying for the marker: a query
      // would happily return the content layer and report a clean fade of the
      // writing on a tile that never went anywhere.
      const glass = content?.parentElement?.firstElementChild;
      return glass?.matches('[data-hidden-item="true"]') ? glass : null;
    }`);

    expect(seen.length, 'the revealed tile was never on screen after Done').toBeGreaterThan(0);
    expect(
      seen.some(o => o > 0.02 && o < 0.98),
      `the tile should be caught part way gone; saw ${JSON.stringify(seen)}`,
    ).toBe(true);
    expect(stillThere, 'and it has to actually leave').toBe(false);
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);
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

    const { seen, stillThere } = await opacitiesWhileLeaving(
      page,
      `() => document.querySelector('main [data-room-name="Kitchen"][data-hidden-item="true"]')`,
    );

    expect(seen.length, 'the revealed room was never on screen after Done').toBeGreaterThan(0);
    expect(
      seen.some(o => o > 0.02 && o < 0.98),
      `the room should be caught part way gone; saw ${JSON.stringify(seen)}`,
    ).toBe(true);
    expect(stillThere, 'and it has to actually leave').toBe(false);
    await expect(tileCount(page, 'Coffee Maker')).toHaveCount(0);
  });
});
