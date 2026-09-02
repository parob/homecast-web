/**
 * Entering Edit Layout should bring the hidden items in, not blink them on.
 *
 * The mirror of `hidden-items-exit.spec.ts`. Done fades the revealed tiles away
 * over HIDDEN_EXIT_MS; entering still mounts them in a single frame, at full
 * strength, while the bar above them slides in and every badge on them scales
 * up. Half the screen arrives with no motion at all in the middle of a
 * transition that is otherwise animated.
 *
 * Asserts the same shape as the exit test rather than a number: that there
 * exists a frame where the revealed tile is ALREADY THERE and PART WAY IN. A
 * cut has no such frame — absent, then whole — so this fails on the old code
 * for the right reason.
 *
 * Sampled per animation frame from inside the page, for the reasons the exit
 * test gives: the whole entrance is shorter than a locator round trip, and
 * React's commit puts a variable delay between the tap and the first paint.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const LIVING_ROOM = 'room-living-room';
const CEILING_LIGHT = 'acc-lr-ceiling';

const tile = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true }).first();

const tileCount = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true });

/**
 * Choose Edit Layout and watch one element arrive, frame by frame.
 *
 * The menu is opened by Playwright — it is not part of what is being measured —
 * but the menu item is clicked from inside the page so that sampling starts in
 * the same task as the click. `find` returns the element once it exists, so the
 * frames before it mounts are simply not recorded.
 */
async function opacitiesWhileArriving(page: Page, find: string) {
  return page.evaluate(async (findSrc: string) => {
    const locate = new Function(`return (${findSrc})`)() as () => HTMLElement | null;
    const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
      .find(n => n.textContent?.trim() === 'Edit Layout') as HTMLElement | undefined;
    if (!item) throw new Error('no Edit Layout menu item — is the ⋮ menu open?');

    const seen: number[] = [];
    const t0 = performance.now();
    item.click();
    await new Promise<void>(resolve => {
      const step = () => {
        const el = locate();
        if (el && document.body.contains(el)) seen.push(parseFloat(getComputedStyle(el).opacity));
        if (performance.now() - t0 < 1500) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return { seen, stillThere: !!locate() };
  }, find);
}

/** The layer that actually paints the tile, not the Card — see the exit test. */
const GLASS_OF_CEILING_LIGHT = `() => {
  const label = Array.from(document.querySelectorAll('main h3'))
    .find(n => n.textContent?.trim() === 'Ceiling Light');
  const content = label?.closest('[data-hidden-item="true"]');
  const glass = content?.parentElement?.firstElementChild;
  return glass?.matches('[data-hidden-item="true"]') ? glass : null;
}`;

test.describe('hidden items on the way into Edit Layout', () => {
  test('Edit Layout fades the revealed tile in instead of cutting it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts({
      [`room:${LIVING_ROOM}`]: { visibility: { hiddenAccessoriesHome: [CEILING_LIGHT], hiddenAccessoriesRoom: [] } },
    });
    await setupMocks(page);

    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    await expect(tile(page, 'Coffee Maker')).toBeVisible();
    await expect(tileCount(page, 'Ceiling Light')).toHaveCount(0);

    await page.locator('[data-tour="header-menu"]').click();
    await expect(page.getByRole('menuitem', { name: 'Edit Layout' })).toBeVisible();

    const { seen, stillThere } = await opacitiesWhileArriving(page, GLASS_OF_CEILING_LIGHT);

    expect(seen.length, 'the hidden tile never appeared after Edit Layout').toBeGreaterThan(0);
    expect(
      seen.some(o => o > 0.02 && o < 0.98),
      `the tile should be caught part way in; saw ${JSON.stringify(seen)}`,
    ).toBe(true);
    expect(stillThere, 'and it has to actually stay').toBe(true);
    await expect(page.locator('[data-testid="edit-layout-bar"]')).toBeVisible();
  });

  /**
   * A revealed hidden ROOM arrives as one thing, heading and tiles together —
   * the mirror of the exit test's second case, and not covered by the first:
   * hiding a room takes the whole section, so its own tiles need not be hidden
   * and are marked nowhere.
   */
  test('Edit Layout fades a revealed room in with everything in it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts({ [`home:${HOME_ID}`]: { visibility: { hiddenRoomsHome: ['room-kitchen'], hiddenRoomsMenu: [] } } });
    await setupMocks(page);

    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    await expect(tile(page, 'Thermostat')).toBeVisible();
    await expect(tileCount(page, 'Coffee Maker')).toHaveCount(0);

    await page.locator('[data-tour="header-menu"]').click();
    await expect(page.getByRole('menuitem', { name: 'Edit Layout' })).toBeVisible();

    const { seen, stillThere } = await opacitiesWhileArriving(
      page,
      `() => document.querySelector('main [data-room-name="Kitchen"][data-hidden-item="true"]')`,
    );

    expect(seen.length, 'the hidden room never appeared after Edit Layout').toBeGreaterThan(0);
    expect(
      seen.some(o => o > 0.02 && o < 0.98),
      `the room should be caught part way in; saw ${JSON.stringify(seen)}`,
    ).toBe(true);
    expect(stillThere, 'and it has to actually stay').toBe(true);
    await expect(tile(page, 'Coffee Maker')).toBeVisible();
  });

  /**
   * …and the space they take, which is the other half and a separate mechanism.
   *
   * Two hidden tiles in the FIRST room, so revealing them adds a row to that
   * room's grid and every room below it has to move. Measured on this fixture,
   * that move was 128px in a single frame — the tile faded in politely while
   * four rooms jumped underneath it.
   *
   * The assertion is the same shape as the others: a frame where the room below
   * is neither where it started nor where it ends up. A jump has no such frame.
   */
  test('the rooms below a revealed row move over time, not in one frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts({
      ['room:room-bedroom']: { visibility: { hiddenAccessoriesHome: ['acc-br-blinds', 'acc-br-fan'], hiddenAccessoriesRoom: [] } },
    });
    await setupMocks(page);

    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    // Fail loudly if the home never rendered, rather than reading an empty
    // screen as "the accessories were hidden".
    await expect(page.locator('main [data-room-name="Front Door"]')).toBeVisible();
    await expect(tileCount(page, 'Ceiling Fan')).toHaveCount(0);

    await page.locator('[data-tour="header-menu"]').click();
    await expect(page.getByRole('menuitem', { name: 'Edit Layout' })).toBeVisible();

    // The room directly below the one that grows. Its top is the whole
    // measurement: it starts at one value and ends at another ~128px lower.
    const tops = await page.evaluate(async () => {
      const top = () => {
        const el = document.querySelector('main [data-room-name="Front Door"]');
        return el ? Math.round((el as HTMLElement).getBoundingClientRect().top * 10) / 10 : null;
      };
      const item = Array.from(document.querySelectorAll('[role="menuitem"]'))
        .find(n => n.textContent?.trim() === 'Edit Layout') as HTMLElement | undefined;
      if (!item) throw new Error('no Edit Layout menu item — is the ⋮ menu open?');

      const seen: number[] = [];
      const t0 = performance.now();
      item.click();
      await new Promise<void>(resolve => {
        const step = () => {
          const t = top();
          if (t !== null) seen.push(t);
          if (performance.now() - t0 < 1500) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      return seen;
    });

    expect(tops.length, 'Front Door was never on the page').toBeGreaterThan(0);
    const start = tops[0];
    const end = tops[tops.length - 1];
    expect(end - start, 'the revealed row should have pushed the room below it down').toBeGreaterThan(40);
    expect(
      tops.some(t => t > start + 4 && t < end - 4),
      `the room below should be caught part way down; saw ${JSON.stringify(tops)}`,
    ).toBe(true);
  });
});
