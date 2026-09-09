/**
 * The status popover fits on the phone it is opened on.
 *
 * Reported on parob/homecast-cloud#103, from an iPhone at 440×956: the panel
 * ran off the bottom of the screen and its last third — the identity note and
 * the automations line — could not be reached at all. `PopoverContent` sets no
 * `max-height` and no `overflow`, so everything past the viewport is clipped by
 * it and there is nothing to scroll.
 *
 * The state is the reporter's: Homecast unreachable, the relay offline for an
 * hour, Local Mode serving the home from the phone, 728 of 751 accessories
 * matched. That combination is the panel at its longest on a phone, which is
 * exactly the case a popover with no height budget has to survive.
 *
 * Only a real browser can show this. The height is the sum of what a font
 * actually rendered at, and the cap is a Radix custom property resolved against
 * a measured viewport — jsdom has neither.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

const badge = (page: Page) => page.locator('header button[aria-label^="Local Mode"]');
const panel = (page: Page) => page.locator('[data-testid="status-panel"]');

/** The reporter's phone. */
const REPORTED = { width: 440, height: 956 };
test.use({ viewport: REPORTED });

/**
 * Put the controller into the reported Local Mode state and stop it deciding
 * otherwise. `emit` is the controller's own path to its listeners, so what is
 * under test is the real component tree reacting to a real state object — only
 * the HomeKit bridge that would have produced it is missing, and no browser
 * has one.
 */
async function engageLocalMode(page: Page) {
  await page.evaluate(async () => {
    const mod = await import('/src/server/local-mode-controller.ts');
    const c = mod.controller as unknown as {
      emit(s: unknown): void;
      tick: ReturnType<typeof setInterval> | null;
    };
    if (c.tick) { clearInterval(c.tick); c.tick = null; }
    c.emit({
      active: true,
      reason: 'relay-offline',
      identityState: 'partial',
      matched: 728,
      reported: 751,
      bridgeReady: true,
      blocked: null,
      status: { ready: true, authorized: true, restricted: false, determined: true, homeCount: 3 },
    });
  });
}

async function openPanel(page: Page) {
  await page.addInitScript(() => {
    const w = window as Window & { isHomeKitLocalCapable?: boolean; isHomecastIOSApp?: boolean };
    w.isHomeKitLocalCapable = true;
    w.isHomecastIOSApp = true;
    // Chromium reports no inset, so stand one in — 59px is an iPhone 16 Pro
    // Max's, the phone the report came from. It matters here for the same
    // reason it did in toast-alignment.spec.ts: the header row starts that far
    // down, and the popover hangs off the header.
    const apply = () => {
      if (document.documentElement) {
        document.documentElement.style.setProperty('--safe-area-top', '59px');
      } else {
        setTimeout(apply, 0);
      }
    };
    apply();
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.locator('[data-tour="sidebar-menu"]')).toBeVisible({ timeout: 20000 });

  await engageLocalMode(page);
  await expect(badge(page)).toBeVisible();
  await badge(page).click();
  await expect(panel(page)).toBeVisible();
  // Radix measures and positions after mount; the zoom-in also animates.
  await page.waitForTimeout(500);
}

test.describe('Status panel height', () => {
  test('the whole panel is reachable on a 440×956 phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry');

    await openPanel(page);
    const vh = page.viewportSize()!.height;
    const box = (await panel(page).boundingBox())!;

    await page.screenshot({ path: testInfo.outputPath('status-panel.png') });

    expect(
      Math.round(box.y + box.height),
      `panel is ${Math.round(box.height)}px tall and ends ${Math.round(box.y + box.height)}px down a ${vh}px screen`,
    ).toBeLessThanOrEqual(vh);
  });

  /**
   * Capping the height is only half an answer — a panel that fits by hiding
   * its last section is the same bug with better manners. Whatever does not
   * fit has to be reachable by scrolling, which is the part that was missing:
   * nothing in the popover had `overflow`, so the overflow was clipped by the
   * viewport rather than parked in a scroller.
   */
  test('whatever does not fit can be scrolled to', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry');

    await openPanel(page);

    const result = await panel(page).evaluate((el) => {
      // The scroller, if there is one: the panel or anything between it and
      // the popper wrapper that actually overflows.
      let scroller: HTMLElement | null = null;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 1) { scroller = n; break; }
        if (n.hasAttribute('data-radix-popper-content-wrapper')) break;
      }
      scroller?.scrollTo({ top: scroller.scrollHeight });
      const last = el.lastElementChild as HTMLElement;
      return {
        scrolls: scroller !== null,
        lastBottom: Math.round(last.getBoundingClientRect().bottom),
        vh: window.innerHeight,
      };
    });

    expect(
      result.lastBottom,
      result.scrolls
        ? 'the panel scrolls but its last section still ends below the screen'
        : 'the panel does not scroll, so its last section is unreachable',
    ).toBeLessThanOrEqual(result.vh);
  });

  /**
   * Condensing bought headroom on one phone; the cap is what makes the panel
   * correct on every other one. A 640px-tall window is a small phone in
   * landscape, an iPad split view, or a relay Mac — which adds a whole Relay
   * section on top of everything measured here. The panel must give way rather
   * than run off, and it must still be readable to the end.
   */
  test('a window too short for it caps and scrolls instead of overflowing', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry');

    await page.setViewportSize({ width: REPORTED.width, height: 640 });
    await openPanel(page);
    await page.screenshot({ path: testInfo.outputPath('status-panel-640.png') });

    const r = await panel(page).evaluate((el) => {
      let scroller: HTMLElement | null = null;
      for (let n: HTMLElement | null = el; n; n = n.parentElement) {
        if (n.scrollHeight > n.clientHeight + 1) { scroller = n; break; }
        if (n.hasAttribute('data-radix-popper-content-wrapper')) break;
      }
      scroller?.scrollTo({ top: scroller.scrollHeight });
      const last = el.lastElementChild as HTMLElement;
      const content = scroller ?? el;
      return {
        scrolls: scroller !== null,
        bottom: Math.round(content.getBoundingClientRect().bottom),
        lastBottom: Math.round(last.getBoundingClientRect().bottom),
        vh: window.innerHeight,
      };
    });

    expect(r.scrolls, 'the panel is taller than a 640px window but does not scroll').toBe(true);
    expect(r.bottom, 'the capped panel still ends below the window').toBeLessThanOrEqual(r.vh);
    expect(r.lastBottom, 'scrolled to the end, the last section is still off screen').toBeLessThanOrEqual(r.vh);
  });
});
