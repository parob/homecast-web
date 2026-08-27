/**
 * Hidden tiles come back at the lift, and the drop still lands where the finger is.
 *
 * Entering Edit Layout by holding a tile is already a drag, so revealing hidden
 * tiles then registers new sortables into a live `SortableContext`. That is why
 * the reveal used to wait for the drop, and why moving it to the lift cannot be
 * argued — it has to be driven.
 *
 * jsdom cannot answer it. `rectSortingStrategy` moves the other tiles with CSS
 * transforms while you drag, and dnd-kit chooses a drop target from the rects
 * those transforms produce; jsdom has neither, so a stubbed-rect version of this
 * test reports whatever the stub says and changes its answer when you move the
 * stub. Hence a real browser, a real long press, and a real touch drag through
 * CDP — Playwright's touchscreen can tap but not hold and drag.
 *
 * Two things are asserted, and the second is the one that carries the risk:
 *   1. the hidden tile is on screen while the finger is still down
 *   2. dropping on a neighbour reorders onto that neighbour, not one past it
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const LIVING_ROOM = 'room-living-room';
/**
 * The HomePod, because it is a tile in its own right. The Living Room's lights
 * are inside the "All Lights" service group, so hiding one removes nothing from
 * the grid — the group tile stays either way, and there is nothing to reveal.
 */
const HOMEPOD = 'acc-lr-speaker';

/** The tiles the Living Room renders, in the order it renders them. */
const TILES = ['All Lights', 'Thermostat', 'HomePod'];

/** Long enough to beat LIFT_DELAY_IDLE (500ms) with room to spare. */
const HOLD_MS = 900;

const tile = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true }).first();

/** The order the room's tiles are actually rendered in. */
async function tileOrder(page: Page, names: string[]) {
  return page.evaluate((wanted: string[]) => {
    const seen: string[] = [];
    const walk = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent || '').trim();
        if (wanted.includes(t) && !seen.includes(t)) seen.push(t);
        return;
      }
      node.childNodes.forEach(walk);
    };
    walk(document.querySelector('main')!);
    return seen;
  }, names);
}

/**
 * A real finger: press, hold past the long-press, drag in steps, release.
 *
 * Stepped rather than teleported because dnd-kit tracks deltas — one jump reads
 * as a single enormous move and collision detection never sees the intervening
 * rows.
 */
async function pressHoldDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  opts: { duringHold?: () => Promise<void> } = {},
) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (x: number, y: number) => [{ x, y, radiusX: 10, radiusY: 10, force: 1 }];

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(from.x, from.y) });
  await page.waitForTimeout(HOLD_MS);
  if (opts.duringHold) await opts.duringHold();

  const STEPS = 12;
  for (let i = 1; i <= STEPS; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: touch(
        from.x + ((to.x - from.x) * i) / STEPS,
        from.y + ((to.y - from.y) * i) / STEPS,
      ),
    });
    await page.waitForTimeout(40);
  }

  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(600);
  await cdp.detach();
}

async function centreOf(page: Page, name: string) {
  const box = await tile(page, name).boundingBox();
  if (!box) throw new Error(`no box for ${name}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/**
 * A finger that stays down, so the caller can measure between the hold and the
 * drag. `pressHoldDrag` cannot: its `duringHold` runs before any movement, and
 * the home-view case needs the target re-measured after the reveal has landed.
 */
async function finger(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const touch = (x: number, y: number) => [{ x, y, radiusX: 10, radiusY: 10, force: 1 }];
  let at = { x: 0, y: 0 };
  return {
    async press(p: { x: number; y: number }) {
      at = p;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch(p.x, p.y) });
      await page.waitForTimeout(HOLD_MS);
    },
    async dragTo(p: { x: number; y: number }) {
      const STEPS = 14;
      for (let i = 1; i <= STEPS; i++) {
        await cdp.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: touch(at.x + ((p.x - at.x) * i) / STEPS, at.y + ((p.y - at.y) * i) / STEPS),
        });
        await page.waitForTimeout(40);
      }
      at = p;
    },
    async release() {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(800);
      await cdp.detach();
    },
  };
}

test.describe('revealing hidden tiles at the lift', () => {
  test.beforeEach(() => {
    // One hidden tile in the Living Room, so there is something to reveal.
    overrideEntityLayouts({ [`room:${LIVING_ROOM}`]: { visibility: { hiddenAccessories: [HOMEPOD] } } });
  });

  test('the hidden tile appears while the finger is still down', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — the lift is a touch gesture');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}&room=${LIVING_ROOM}`);
    await expect(tile(page, 'Thermostat')).toBeVisible({ timeout: 20000 });
    await expect(page.locator('main').getByText('HomePod', { exact: true })).toHaveCount(0);

    const from = await centreOf(page, 'Thermostat');
    let visibleDuringHold: number | null = null;

    await pressHoldDrag(page, from, { x: from.x, y: from.y + 40 }, {
      duringHold: async () => {
        // Still pressed, still dragging — this is the whole point of the change.
        visibleDuringHold = await page.locator('main').getByText('HomePod', { exact: true }).count();
      },
    });

    expect(visibleDuringHold, 'hidden tile was not revealed during the hold').toBeGreaterThan(0);
  });

  test('the drop lands on the tile under the finger, not one past it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — the lift is a touch gesture');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}&room=${LIVING_ROOM}`);
    await expect(tile(page, 'Thermostat')).toBeVisible({ timeout: 20000 });

    const before = await tileOrder(page, TILES);
    test.skip(before.length < 2, 'needs at least two visible tiles in the room');

    const [first, second] = before;
    // Drag the second onto the first: they should simply swap.
    const from = await centreOf(page, second);
    const to = await centreOf(page, first);

    await pressHoldDrag(page, from, to);

    const after = await tileOrder(page, TILES);

    // Dropping the first onto the second swaps exactly those two. Landing one
    // past — the failure the deferred reveal existed to prevent — puts `first`
    // after the revealed tile instead, which this catches.
    expect(after.slice(0, 2), `order went ${before.join(',')} -> ${after.join(',')}`)
      .toEqual([second, first]);
  });
});

/**
 * The home view stacks every room as its own grid, so a room ABOVE the drag can
 * grow when its hidden tiles come back — and then the whole page moves under the
 * finger. "Hidden items sort to the end" is a per-grid argument and says nothing
 * about this.
 *
 * Re-measuring cannot fix it: dnd-kit captures the active item's rect once at
 * drag start and derives its position from that plus the pointer delta, so a page
 * that moves takes the drag's own frame of reference with it. The fix is to not
 * let the page move — compensate the scroll by however much grew above.
 */
test.describe('revealing a room above the drag', () => {
  const BEDROOM_FAN = 'acc-br-fan';

  test.beforeEach(() => {
    // The Bedroom sits above the Living Room on the home view.
    overrideEntityLayouts({ 'room:room-bedroom': { visibility: { hiddenAccessories: [BEDROOM_FAN] } } });
  });

  async function openHomeViewAtLivingRoom(page: Page) {
    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(tile(page, 'Thermostat')).toBeVisible({ timeout: 20000 });
    // The Living Room is the last section, far below the fold. A touch at an
    // off-viewport coordinate hits nothing, so scroll it into view first.
    await tile(page, 'Thermostat').scrollIntoViewIfNeeded();
    await page.waitForTimeout(900);
  }

  test('the tile under the finger does not move when a room above reveals', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — the lift is a touch gesture');

    await openHomeViewAtLivingRoom(page);

    const held = await tile(page, 'Thermostat').boundingBox();
    const hand = await finger(page);
    await hand.press({ x: held!.x + held!.width / 2, y: held!.y + held!.height / 2 });

    // The reveal has landed by now; the held tile must still be where it was.
    const revealed = await page.locator('main').getByText('Ceiling Fan', { exact: true }).count();
    const nowAt = await tile(page, 'Thermostat').boundingBox();
    await hand.release();

    expect(revealed, 'the room above never revealed, so this proves nothing').toBeGreaterThan(0);
    expect(
      Math.abs(nowAt!.y - held!.y),
      `the held tile moved ${Math.round(nowAt!.y - held!.y)}px when the room above revealed`,
    ).toBeLessThanOrEqual(2);
  });

  test('the drop lands where the finger is, with a room above revealing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — the lift is a touch gesture');

    await openHomeViewAtLivingRoom(page);

    const before = await tileOrder(page, ['Ceiling Light', 'Thermostat']);
    expect(before, 'expected both Living Room tiles on screen').toEqual(['Ceiling Light', 'Thermostat']);

    const held = await tile(page, 'Thermostat').boundingBox();
    const hand = await finger(page);
    await hand.press({ x: held!.x + held!.width / 2, y: held!.y + held!.height / 2 });

    // Aim at where the target is NOW — after any reveal — because that is what
    // the person holding the phone can see and aim at.
    const target = await tile(page, 'Ceiling Light').boundingBox();
    await hand.dragTo({ x: target!.x + target!.width / 2, y: target!.y + target!.height / 2 });
    await hand.release();

    const after = await tileOrder(page, ['Ceiling Light', 'Thermostat']);
    expect(after, `order went ${before.join(',')} -> ${after.join(',')}`)
      .toEqual(['Thermostat', 'Ceiling Light']);
  });
});
