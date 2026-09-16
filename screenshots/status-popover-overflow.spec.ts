/**
 * The status popover stays inside the screen it is opened on.
 *
 * `PopoverContent` had no height budget — no `max-height`, no `overflow` —
 * so the answer card was drawn at whatever height its copy came to and the
 * excess simply ran off the bottom of the viewport. Nothing scrolled, so the
 * end of the card was unreachable: on the offline card that is the "Reconnect
 * now" button, which is the one action the panel exists to offer.
 *
 * A landscape phone is where it bites. `Info.plist` declares
 * `UIInterfaceOrientationLandscapeLeft` and `…Right` for iPhone, so this is a
 * supported orientation rather than a hypothetical, and at 375pt tall there is
 * only ~329pt of room under the header for a card that reaches 392pt.
 *
 * The state driven here is `stalled` — the socket is up but the server has
 * stopped answering pings, which is reachable without closing the transport
 * and is one of the six states (of eleven) that overflowed a 375pt screen.
 *
 * Radix already measures the room and publishes it as
 * `--radix-popover-content-available-height`; the fix is to consume it.
 *
 * Only a real browser can show any of this: every assertion here is about
 * rendered geometry, which jsdom does not have.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';

// iPhone SE in landscape — the shortest screen the app supports.
const LANDSCAPE = { width: 667, height: 375 };

const badge = (page: Page) => page.getByRole('button', { name: 'Connection is not responding' });

const ready = waitForDashboard;
const panel = (page: Page) => page.locator('[data-radix-popper-content-wrapper] [class*="w-[280px]"]');

/**
 * Take the socket silent, the way a server that has stopped answering does.
 *
 * The route registered last wins, so this one replaces the mock's pong-ing
 * handler for the *next* connection; `serverConnection.reconnect()` — the same
 * call the popover's own "Reconnect now" button makes — is what opens it. With
 * no pong, `connection-quality` reports `offline` after OFFLINE_AFTER_MS (4s),
 * which is the card's tallest state.
 */
async function goSilent(page: Page) {
  await page.routeWebSocket(/^wss?:\/\/(api\.homecast\.cloud|localhost:8080)\/ws/, (ws) => {
    ws.send(JSON.stringify({ type: 'connected', serverInstanceId: 'mock-silent' }));
    // Deliberately no onMessage handler: pings go unanswered.
  });
  await page.evaluate(async () => {
    const mod = await import('/src/server/connection.ts');
    mod.serverConnection.reconnect();
  });
}

test.describe('Status popover, on a short screen', () => {
  test('fits the screen it is opened on, and scrolls', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry is where it runs out of room');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await ready(page);

    await page.setViewportSize(LANDSCAPE);
    await goSilent(page);

    // The badge turns amber and says "Not responding" once the pings have gone
    // unanswered for long enough.
    await expect(badge(page)).toBeVisible({ timeout: 25000 });
    await badge(page).click();

    const box = (await panel(page).boundingBox())!;
    const viewport = page.viewportSize()!;

    await page.screenshot({
      path: testInfo.outputPath('status-popover-landscape.png'),
      animations: 'disabled',
    });

    // 1. The panel ends on screen. Without a height budget it ran ~63px past
    //    the bottom edge here, taking "Reconnect now" with it.
    expect(
      Math.round(box.y + box.height),
      `panel is ${Math.round(box.height)}px tall and ends ${Math.round(box.y + box.height)}px ` +
      `down a ${viewport.height}px screen`,
    ).toBeLessThanOrEqual(viewport.height);

    // 2. Where it does not fit, it scrolls — the difference between a panel
    //    that is short enough today and one that cannot trap its own content.
    const scrolls = await panel(page).evaluate((el) => {
      if (el.scrollHeight <= el.clientHeight + 1) return null;
      el.scrollTop = 200;
      return el.scrollTop;
    });
    if (scrolls !== null) {
      expect(scrolls, 'the panel has content past its cap but does not scroll').toBeGreaterThan(0);
    }

    // 3. "Reconnect now" is reachable — the one action this card exists to
    //    offer, and the last thing in it. Clipped by the viewport with no
    //    scroller there is no gesture that brings it back, which is the whole
    //    difference between a panel that happens to be short enough today and
    //    one that can trap its own content.
    const reconnect = panel(page).getByRole('button', { name: /Reconnect now/i });
    await reconnect.scrollIntoViewIfNeeded();
    await expect(reconnect).toBeInViewport();
  });
});
