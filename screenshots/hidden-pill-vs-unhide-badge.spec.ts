/**
 * How many times a hidden card says it is hidden.
 *
 * parob/homecast-cloud#160, from an iPhone: "No need for the 'hidden' bubble,
 * the reduced background and unhide button is enough." In Edit Layout every
 * hidden card carried three statements of the same fact — dimmed to 40%, an
 * **Unhide** badge in the corner, and a grey **Hidden** pill centred over it.
 * The pill is centred, so on a ~160px tile it landed across the card's own
 * name: "Open all blinds", "All lights off test" and "Turn off heating &
 * cooling" are each unreadable behind one in the reporter's screenshot.
 *
 * `HiddenLabel` is documented in EditActions.tsx as the fallback for a card you
 * have no way to act on. The accessory tiles honoured that; the scene, shortcut
 * and automation cards rendered it on `isHidden` alone.
 *
 * Captured rather than measured because the complaint is about what the screen
 * shows: that the pill covers the name is not visible in a class list, and the
 * thing being checked is that the card is still legible without it.
 *
 *   npx playwright test hidden-pill-vs-unhide-badge.spec.ts --project=iphone-screenshots
 *
 * Captures land in the gitignored `output/hidden-pill/`; the pair that ends up
 * in the pull request is copied into `evidence/issue-160/`. Set
 * HIDDEN_PILL_LABEL to name the run (`before` on the old code, `after` on the
 * fix); `before` skips the assertions, since on the old code they are the bug.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.HIDDEN_PILL_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'hidden-pill');

/** The device the report came from — an iPhone 16 Pro Max, per its context blob. */
test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
});

const doneButton = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"] button', { hasText: 'Done' });

async function enterEditLayout(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(doneButton(page)).toBeVisible();
  // Long enough for the badges to scale in and the reveal to settle.
  await page.waitForTimeout(900);
}

test.describe('a hidden card in Edit Layout', () => {
  test.beforeEach(() => {
    // The wallpaper matters: these cards are glass over a picture, and the pill
    // is a grey chip on top of that. Same background the report was filed on.
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: {
        background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 },
        // Several hidden and one left visible, so the capture shows both states
        // and the names that the pill was sitting on are in shot.
        visibility: { hiddenActions: ['locks', 'blinds', 'climate-off'] },
      },
    });
  });

  test('says so with the badge and the dimming, not a pill over its name', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await waitForDashboard(page);
    await enterEditLayout(page);

    fs.mkdirSync(OUT, { recursive: true });
    await page.locator('[data-testid="action-lights"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    // The section carries no testid, so the crop is the union of the shortcut
    // cards' own boxes — exactly the region the report points at.
    const box = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="action-"]'))
        .filter(el => !el.getAttribute('data-testid')!.startsWith('action-panel-'));
      const rects = cards.map(el => el.getBoundingClientRect());
      const left = Math.min(...rects.map(r => r.left));
      const top = Math.min(...rects.map(r => r.top));
      const right = Math.max(...rects.map(r => r.right));
      const bottom = Math.max(...rects.map(r => r.bottom));
      return { x: left - 12, y: top - 16, width: right - left + 24, height: bottom - top + 32 };
    });
    await page.screenshot({ path: path.join(OUT, `scenes-${LABEL}.png`), clip: box });
    await page.screenshot({ path: path.join(OUT, `dashboard-${LABEL}.png`) });

    const unhide = page.getByRole('button', { name: /^Unhide / });
    const pills = page.getByText('Hidden', { exact: true });
    fs.writeFileSync(
      path.join(OUT, `counts-${LABEL}.json`),
      JSON.stringify({ label: LABEL, unhideBadges: await unhide.count(), hiddenPills: await pills.count() }, null, 2),
    );

    // On the old code both of these are what the report is about, so the
    // `before` run captures and stops rather than failing.
    test.skip(LABEL === 'before', 'capture-only run against the unfixed code');

    // The precondition: this really is the state the reporter photographed.
    expect(await unhide.count(), 'the hidden cards offer Unhide').toBeGreaterThan(0);
    // And the second and third statements of the same fact are down to one.
    expect(await pills.count(), 'no Hidden pill where an Unhide badge says it').toBe(0);
    // The dimming is untouched — it is half of what the reporter said was enough.
    const dimmed = await page.locator('[data-testid="action-locks"]')
      .evaluate(el => parseFloat(getComputedStyle(el).opacity));
    expect(dimmed, 'a hidden card still reads as hidden').toBeLessThan(0.6);
  });
});
