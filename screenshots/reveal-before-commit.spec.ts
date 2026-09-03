/**
 * A press is not a promise.
 *
 * The hold that enters Edit Layout reveals hidden items at `LIFT_REVEAL_DELAY`
 * (250ms), a beat before dnd-kit's sensor fires at `LIFT_DELAY_IDLE` (500ms) —
 * `reveal-during-lift.spec.ts` is why that ordering cannot move. The cost was
 * that the reveal *appeared* at 250ms while the thing it announced only
 * happened at 500ms, so letting go in between put hidden tiles on screen and
 * took them straight back off. It fired on any tap held past a quarter of a
 * second, not just an abandoned lift (parob/homecast-cloud#60).
 *
 * The fix separates mounting from appearing: the items take their space, which
 * is all the measurement needs, and stay at `opacity: 0` until the lift
 * commits. So the assertion here is not "is it in the DOM" — it was before and
 * is now — but "is it painted", which is the thing that actually changed.
 *
 * A real browser and a real finger through CDP, for the same reason
 * `reveal-during-lift.spec.ts` gives: jsdom has neither the timers nor the
 * computed styles to answer this, and Playwright's touchscreen can tap but not
 * hold.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const LIVING_ROOM = 'room-living-room';
/** A tile in its own right — the Living Room's lights are inside a group, so
 *  hiding one removes nothing from the grid. */
const HOMEPOD = 'acc-lr-speaker';

/** Past LIFT_REVEAL_DELAY (250ms), short of LIFT_DELAY_IDLE (500ms). */
const RELEASE_EARLY_MS = 350;
/** Comfortably past both. */
const HOLD_THROUGH_MS = 900;

/** The bar is always mounted and slid off-screen; `aria-hidden` tracks the mode. */
const editBarOn = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"][aria-hidden="false"]');

const tile = (page: Page, name: string) =>
  page.locator('main').getByText(name, { exact: true }).first();

/**
 * Mounted is not painted, and the whole fix is the difference.
 *
 * The mark is on the widget inside the draggable, which is also the element the
 * pending rule holds at zero — so this reads the same node the stylesheet does.
 */
async function homePodPaint(page: Page) {
  return page.evaluate(() => {
    const el = Array.from(document.querySelectorAll('[data-hidden-item="true"]'))
      .find(e => (e.textContent || '').includes('HomePod')) as HTMLElement | undefined;
    if (!el) return { mounted: false, opacity: null as string | null };
    return { mounted: true, opacity: getComputedStyle(el).opacity };
  });
}

/** A finger that presses for exactly `holdMs`, with a look part way through. */
async function pressFor(
  page: Page,
  at: { x: number; y: number },
  holdMs: number,
  mid?: () => Promise<void>,
) {
  const cdp = await page.context().newCDPSession(page);
  const pt = (x: number, y: number) => [{ x, y, radiusX: 10, radiusY: 10, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(at.x, at.y) });
  await page.waitForTimeout(holdMs);
  if (mid) await mid();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

async function openLivingRoom(page: Page) {
  overrideEntityLayouts({ [`room:${LIVING_ROOM}`]: { visibility: { hiddenAccessories: [HOMEPOD] } } });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}&room=${LIVING_ROOM}`);
  await expect(tile(page, 'Thermostat')).toBeVisible({ timeout: 20000 });
  const box = await tile(page, 'Thermostat').boundingBox();
  if (!box) throw new Error('no box for Thermostat');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('a reveal held back until the lift commits', () => {
  test('a press released before the lift never paints anything', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — the lift is a touch gesture');

    const at = await openLivingRoom(page);
    await expect(page.locator('main').getByText('HomePod', { exact: true })).toHaveCount(0);

    let duringHold: Awaited<ReturnType<typeof homePodPaint>> | null = null;
    await pressFor(page, at, RELEASE_EARLY_MS, async () => { duringHold = await homePodPaint(page); });
    await page.waitForTimeout(1200);

    // Mounted, so the page has grown and dnd-kit would measure it settled —
    // this is the half that must NOT change, or reveal-during-lift.spec.ts goes.
    expect(duringHold!.mounted, 'the reveal never fired at all, so this proves nothing').toBe(true);
    // …and never painted, which is the half that was the bug.
    expect(duringHold!.opacity, 'the hidden tile was painted before the lift committed').toBe('0');

    // Nothing was shown, so nothing had to be taken back, and no mode was entered.
    await expect(page.locator('main').getByText('HomePod', { exact: true })).toHaveCount(0);
    await expect(editBarOn(page)).toHaveCount(0);
  });

  test('and held through the lift, it does paint', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — the lift is a touch gesture');

    const at = await openLivingRoom(page);
    await pressFor(page, at, HOLD_THROUGH_MS);
    await page.waitForTimeout(1200);

    await expect(editBarOn(page)).toHaveCount(1);
    // The other side of the same coin: holding it back is only right if
    // committing still lets it through.
    expect((await homePodPaint(page)).opacity, 'the committed reveal never painted').toBe('1');
  });
});
