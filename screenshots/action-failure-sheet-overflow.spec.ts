/**
 * The failure sheet stays inside the screen when a whole home fails at once.
 *
 * A Hue bridge dropping takes every bulb behind it down together, so "All
 * lights" can come back with 130 failures rather than the two the sheet was
 * drawn for. The bottom sheet has no height of its own — it is `bottom-0` with
 * as many rows as it was handed — so at that length it grows several thousand
 * pixels UPWARDS, off the top of the screen, with nothing to scroll: the panel
 * is not a scroller, and Radix locks the body while a dialog is open.
 *
 * That takes the header, the title and the ✕ with it, and because the panel now
 * covers the whole viewport the overlay behind it cannot be tapped either — so
 * on a phone, with no Esc key, the sheet cannot be closed at all.
 *
 * Only a real browser can show any of this: every assertion here is about
 * rendered geometry, which jsdom does not have.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

const HOW_MANY = 130;

const panel = (page: Page) => page.locator('[role="dialog"]', { hasText: 'Didn’t respond' });
const closeButton = (page: Page) => panel(page).getByRole('button', { name: /close/i });

/**
 * Open the sheet through the app's own store — the same call the partial-run
 * toast's Details button makes. Vite serves the source module, and it is the
 * same module instance the mounted `<ActionFailureSheet/>` subscribes to.
 */
async function openFailures(page: Page, count: number) {
  await page.evaluate(async (n) => {
    const mod = await import('/src/components/actions/action-failures.ts');
    mod.openActionFailures({
      id: 'lights:1',
      actionLabel: 'All lights',
      at: Date.now(),
      failures: Array.from({ length: n }, (_, i) => ({
        accessoryId: `hue-${i}`,
        name: `Hue ambiance spot ${i + 1}`,
        reason: `Hue ambiance spot ${i + 1} didn’t respond in time.`,
        write: {
          accessoryId: `hue-${i}`,
          characteristicType: 'power_state',
          reportedCharacteristicType: 'power_state',
          value: true,
          previousValue: false,
        },
      })),
      retry: () => {},
    });
  }, count);
  await expect(panel(page)).toBeVisible();
  // It slides in from the bottom; measure once it has landed.
  await page.waitForTimeout(700);
}

test.describe('Action failure sheet, at scale', () => {
  test('a home-sized failure list stays on screen and scrolls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry is where it runs out of room');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForSelector('[data-tour="sidebar-menu"]', { timeout: 20000 });

    await openFailures(page, HOW_MANY);

    const viewport = page.viewportSize()!;
    const box = (await panel(page).boundingBox())!;

    await page.screenshot({
      path: testInfo.outputPath('failure-sheet-130.png'),
      animations: 'disabled',
    });

    // 1. The panel fits the screen it is drawn on.
    expect(
      box.height,
      `sheet is ${Math.round(box.height)}px tall in a ${viewport.height}px viewport`,
    ).toBeLessThanOrEqual(viewport.height);

    // 2. Its top edge — the title, and the ✕ anchored to it — is on screen.
    expect(box.y, `sheet top edge is at y=${Math.round(box.y)}`).toBeGreaterThanOrEqual(0);
    await expect(closeButton(page)).toBeInViewport();

    // 3. The list scrolls, rather than the rows simply running off the top.
    const scroller = panel(page).locator('[data-testid="failure-list"]');
    const scrolled = await scroller.evaluate((el) => {
      el.scrollTop = 400;
      return el.scrollTop;
    });
    expect(scrolled, 'the list did not scroll').toBeGreaterThan(0);

    // 4. Retry all is reachable without scrolling to the end of 130 rows.
    await expect(
      panel(page).getByRole('button', { name: `Retry all ${HOW_MANY}` }),
    ).toBeInViewport();
  });

  test('can still be dismissed with a tap outside it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry is where it runs out of room');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForSelector('[data-tour="sidebar-menu"]', { timeout: 20000 });

    await openFailures(page, HOW_MANY);

    // A phone has no Esc key and this sheet has no swipe-to-close, so the
    // overlay and the ✕ are the only ways out. A panel taller than the screen
    // covers both, which is the difference between a long list and a trap.
    await page.mouse.click(10, 10);
    await expect(panel(page)).toBeHidden({ timeout: 3000 });
  });
});
