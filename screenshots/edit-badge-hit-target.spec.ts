/**
 * The Hide and Pin badges have to be hittable with a thumb.
 *
 * Edit Layout is a touch mode, and its only controls are these two badges. They
 * were drawn for a mouse: 40x20 CSS px, well under the 44px minimum a finger
 * needs, sitting 4px apart in a tile corner — reported from a phone as "make
 * the hide and pin buttons bigger/easier to hit".
 *
 * Only a real browser can answer this. The visual box is one number and the
 * *hit* box is another — a badge can carry invisible slop — so this probes
 * `elementFromPoint` outward from each badge's centre and measures the region
 * that actually resolves to it. jsdom has no layout and no hit testing, so a
 * unit test here would assert class strings and pass whatever was written.
 */
import { test, expect, type Page, type Locator } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

/** iOS HIG minimum; Material asks for 48. */
const MIN_TARGET = 44;

async function enterEditLayout(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(page.locator('[data-testid="edit-layout-bar"]')).toBeVisible();
  await page.waitForTimeout(600);
}

/**
 * How far a press can land from the badge's centre and still reach the badge.
 *
 * Walks out one pixel at a time in each direction, asking the document what is
 * under that point, and stops at the first pixel that is something else. That
 * is the number a thumb actually experiences, pseudo-element slop included.
 */
async function hitBox(badge: Locator) {
  // Measure and probe in one frame: the tile keeps wiggling while editing.
  return badge.evaluate(el => {
    const box = el.getBoundingClientRect();
    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    const owns = (x: number, y: number) => {
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === el || el.contains(hit) || hit.contains(el) === false && hit.closest('button') === el);
    };
    const walk = (dx: number, dy: number) => {
      let n = 0;
      while (n < 80 && owns(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    return {
      width: walk(-1, 0) + walk(1, 0) + 1,
      height: walk(0, -1) + walk(0, 1) + 1,
    };
  });
}

test.describe('the Edit Layout badges', () => {
  test('a tile’s Hide and Pin are big enough for a thumb', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 20000 });
    await enterEditLayout(page);

    const hide = page.getByRole('button', { name: 'Hide Ceiling Fan' });
    const pin = hide.locator('xpath=..').getByRole('button', { name: /Pin/ });
    // Edit-mode wiggle never becomes stable; scroll the real tile directly.
    await hide.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(250);
    await expect(hide).toBeVisible();
    await expect(pin).toBeVisible();

    const hideBox = await hitBox(hide);
    const pinBox = await hitBox(pin);
    console.log('hit target — Hide:', JSON.stringify(hideBox), 'Pin:', JSON.stringify(pinBox));

    expect(hideBox.height, `Hide is ${hideBox.height}px tall to a finger`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(pinBox.height, `Pin is ${pinBox.height}px tall to a finger`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(hideBox.width, `Hide is ${hideBox.width}px wide to a finger`).toBeGreaterThanOrEqual(MIN_TARGET);
    expect(pinBox.width, `Pin is ${pinBox.width}px wide to a finger`).toBeGreaterThanOrEqual(MIN_TARGET);
  });

  /**
   * Slop that spills into the neighbour is worse than no slop: the two badges
   * sit 4px apart, so an over-generous target makes Pin swallow the right edge
   * of Hide and the wrong thing happens on a press that looked accurate.
   */
  test('neither badge steals the other’s presses', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 20000 });
    await enterEditLayout(page);

    const hide = page.getByRole('button', { name: 'Hide Ceiling Fan' });
    const pin = hide.locator('xpath=..').getByRole('button', { name: /Pin/ });

    // Edit-mode wiggle never becomes stable; scroll the real tile directly.
    await hide.evaluate(el => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
    await page.waitForTimeout(250);
    await expect(hide).toBeVisible();
    await expect(pin).toBeVisible();

    const owner = await page.evaluate(([h, p]) => {
      const probe = (el: Element, fx: number) => {
        const r = el.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x + r.width * fx, r.y + r.height / 2);
        return hit?.closest('button')?.getAttribute('aria-label') ?? null;
      };
      return {
        hideLeft: probe(h!, 0.04), hideRight: probe(h!, 0.96),
        pinLeft: probe(p!, 0.04), pinRight: probe(p!, 0.96),
      };
    }, [await hide.elementHandle(), await pin.elementHandle()]);

    console.log('edge ownership:', JSON.stringify(owner));
    expect(owner.hideLeft).toMatch(/^Hide /);
    expect(owner.hideRight).toMatch(/^Hide /);
    expect(owner.pinLeft).toBe('Pin to Tab Bar');
    expect(owner.pinRight).toBe('Pin to Tab Bar');
  });

  test('capture', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(page.locator('[data-tour="header-menu"]')).toBeVisible({ timeout: 20000 });
    await enterEditLayout(page);

    // `BADGE_SHOT=before` / `=after` around a checkout of the other side is how
    // the pair on the issue was made.
    const label = process.env.BADGE_SHOT ?? 'badges';
    await page.screenshot({ path: `screenshots/output/edit-badges-${label}-full.png` });
    const tile = page.getByRole('button', { name: 'Hide Ceiling Fan' });
    await tile.scrollIntoViewIfNeeded();
    const box = (await tile.boundingBox())!;
    await page.screenshot({
      path: `screenshots/output/edit-badges-${label}-tile.png`,
      clip: { x: 0, y: Math.max(0, box.y - 120), width: 428, height: 260 },
    });
  });
});
