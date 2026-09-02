/**
 * Entering and leaving Edit Layout must not move the page under you.
 *
 * The reveal makes every room that holds a hidden item taller, and Done makes
 * it short again. #38 and #49 animate that height so the rooms *below* slide
 * instead of jumping — but neither corrects for the change happening ABOVE
 * where you are looking, which is the ordinary case: you scroll to the part you
 * want to rearrange, and the reveal touches every room, including the ones you
 * have already scrolled past. The scroll offset does not change, so the whole
 * screen slides by the full distance instead. On the reporter's home that was
 * 173px every time they tapped Done (parob/homecast-cloud#55).
 *
 * Chrome and Firefox correct it themselves — scroll anchoring. Safari has never
 * implemented it, and Safari is what an iPhone runs, so this is the only thing
 * holding your place on the one platform where Edit Layout is the only way to
 * rearrange anything.
 *
 * Which is why these run with `overflow-anchor: none`. Playwright drives
 * Chromium, and Chromium's own anchoring papers over exactly the half of this
 * the reporter cannot get: measured on the old code it corrected the whole
 * 127px on the way out and 48 of 127 on the way in, so without this the exit
 * case would pass on the broken code and prove nothing. Turning it off is not
 * a trick to make the test fail — it is what the reporter's browser does.
 *
 * Set up as the reporter was, and the setup is the test: the room holding the
 * hidden items must end up ABOVE the top of the screen. With it on screen the
 * page grows below the anchor, which is legitimate — you watch the items
 * arrive — and there is nothing to correct.
 *
 * Asserted as a shape, not a number: a room below stays where it is, to within
 * a pixel or two, on EVERY frame — while `scrollHeight` provably changes, so a
 * reveal that silently stopped happening fails rather than passes.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const BEDROOM = 'room-bedroom';
const HIDDEN = ['acc-br-blinds', 'acc-br-fan'];
/** A room below the one that changes, and one that is never itself revealed. */
const LANDMARK = 'main [data-room-name="Front Door"]';

interface Frame { at: number; top: number | null; scrollY: number; docHeight: number }

/**
 * Click something by its label and watch the landmark, frame by frame.
 *
 * Clicked from inside the page so that sampling starts in the same task as the
 * click — the correction lands in the very first frame after the change, and a
 * locator round trip is longer than the whole transition.
 */
async function framesWhile(page: Page, label: string, ms = 1200): Promise<Frame[]> {
  return page.evaluate(async ({ label, ms, LANDMARK }) => {
    const top = () => {
      const el = document.querySelector(LANDMARK) as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().top) : null;
    };
    const target = Array.from(document.querySelectorAll('[role="menuitem"], button'))
      .find(n => n.textContent?.trim() === label) as HTMLElement | undefined;
    if (!target) throw new Error(`no control labelled ${label}`);

    const frames: Array<{ at: number; top: number | null; scrollY: number; docHeight: number }> = [];
    const t0 = performance.now();
    // The baseline is taken BEFORE the click, not from the first sampled frame.
    // When the change is above the anchor it is applied and corrected in one go,
    // so by the first animation frame it is already over — read from there, both
    // the movement and the height change look like they never happened.
    frames.push({
      at: -1,
      top: top(),
      scrollY: Math.round(window.scrollY),
      docHeight: document.documentElement.scrollHeight,
    });
    target.click();
    await new Promise<void>(resolve => {
      const step = () => {
        frames.push({
          at: Math.round(performance.now() - t0),
          top: top(),
          scrollY: Math.round(window.scrollY),
          docHeight: document.documentElement.scrollHeight,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    return frames;
  }, { label, ms, LANDMARK });
}

function heldStill(frames: Frame[], within: number) {
  const tops = frames.map(f => f.top).filter((t): t is number => t !== null);
  expect(tops.length, 'the landmark was never on the page').toBeGreaterThan(10);
  const start = tops[0];
  const drifted = tops.filter(t => Math.abs(t - start) > within);
  expect(
    drifted,
    `the page moved under the viewer; landmark tops were ${JSON.stringify(tops)}`,
  ).toEqual([]);

  const heights = frames.map(f => f.docHeight);
  expect(
    Math.max(...heights) - Math.min(...heights),
    'the page never changed height, so this proved nothing — did the reveal stop happening?',
  ).toBeGreaterThan(40);
}

test.describe('Edit Layout holds your place', () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts({
      [`room:${BEDROOM}`]: { visibility: { hiddenAccessoriesHome: HIDDEN, hiddenAccessoriesRoom: [] } },
    });
    await setupMocks(page);
    // Chromium the way Safari is: see the note at the top of this file.
    await page.addInitScript(() => {
      const style = document.createElement('style');
      style.textContent = '*, *::before, *::after { overflow-anchor: none !important; }';
      document.addEventListener('DOMContentLoaded', () => document.head.appendChild(style));
    });
    await page.goto(`/portal?home=${HOME_ID}`);
    await page.waitForTimeout(3500);
    await expect(page.locator(LANDMARK)).toBeVisible();

    // Short enough that there is room to scroll, then scrolled past Bedroom so
    // the space that opens and closes is off the top of the screen.
    await page.setViewportSize({ width: 428, height: 500 });
    await page.waitForTimeout(500);
    // `instant`, and then settled for a beat: `scroll-behavior: smooth` is set
    // on `html`, so a plain scrollTo here would still be animating when the tap
    // lands — and the anchor lets go the moment the offset moves under it,
    // which is the right thing to do for a viewer's flick and would make this
    // test pass for entirely the wrong reason.
    await page.evaluate(() => window.scrollTo({ top: 700, behavior: 'instant' as ScrollBehavior }));
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => Math.round(window.scrollY))).toBe(700);
  });

  test('entering does not move the page under you', async ({ page }) => {
    await page.locator('[data-tour="header-menu"]').click();
    await expect(page.getByRole('menuitem', { name: 'Edit Layout' })).toBeVisible();
    heldStill(await framesWhile(page, 'Edit Layout'), 2);
  });

  test('and Done puts it back without scrolling you down', async ({ page }) => {
    await page.locator('[data-tour="header-menu"]').click();
    await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
    await expect(page.locator('[data-testid="edit-layout-bar"]')).toBeVisible();
    await page.waitForTimeout(700);

    heldStill(await framesWhile(page, 'Done'), 2);
  });

  /**
   * …including from the end of a long page, which is where it went twice.
   *
   * Scrolled to the bottom, the offset is already as large as the page allows —
   * so when Done takes the revealed items away, the browser has to reduce it by
   * the whole shrink just to keep it in range. That reduction is the correction,
   * made for free and before anything here runs. `unexplainedShift` could not
   * tell it from a viewer's own flick, cancelled it as one, and applied the
   * shrink a second time: measured on the fixture home, 127px of reveal moved
   * the page 254 (parob/homecast-cloud#58). The reporter's home hides enough to
   * make the second one the length of the list, which lands at the top.
   *
   * The scroll is to the very end rather than a number: a clamp only happens
   * against the end of the range, which is exactly what "scrolled down through a
   * long list of rooms" leaves you at.
   */
  test('and Done from the bottom of the page does not scroll you up past it', async ({ page }) => {
    await page.locator('[data-tour="header-menu"]').click();
    await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
    await expect(page.locator('[data-testid="edit-layout-bar"]')).toBeVisible();
    await page.waitForTimeout(700);

    // Reveal grew the page, so the end of it is only known now.
    const atEnd = await page.evaluate(() => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo({ top: max, behavior: 'instant' as ScrollBehavior });
      return max;
    });
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => Math.round(window.scrollY)), 'not at the end of the page')
      .toBe(Math.round(atEnd));

    heldStill(await framesWhile(page, 'Done'), 2);
  });
});
