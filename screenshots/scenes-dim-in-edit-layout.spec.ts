/**
 * What Edit Layout does to the Scenes grid.
 *
 * parob/homecast-cloud#158: on an iPhone, entering Edit Layout left the Scenes
 * section washed out — "not really visible … they look different from
 * everything else" — while the tiles, the status row and the Automation cards
 * beside it stayed solid.
 *
 * `ActionCard` folds `editMode` into `inert`, and `inert` is what picks the
 * card's dimming: every shortcut card therefore drops to `opacity-50` for the
 * whole of the mode. Nothing else on the dashboard does that. It also collapses
 * the one distinction the mode exists to show — a hidden card is `opacity-40`,
 * which against a dimmed visible one is a difference of 0.1.
 *
 * Opacity is measured, not read off a class, because the question is what the
 * screen shows: `opacity-50` on an ancestor of the card's `backdrop-blur-xl`
 * layer also takes the glass off it, which is the other half of "different from
 * everything else".
 *
 *   npx playwright test scenes-dim-in-edit-layout.spec.ts --project=iphone-screenshots
 *
 * Captures land in the gitignored `output/scenes-dim/`; the pair that ends up in
 * the pull request is copied into `evidence/issue-158/`. Set SCENES_DIM_LABEL to
 * name the run (`before` on the old code, `after` on the fix).
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.SCENES_DIM_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'scenes-dim');

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

/** The painted opacity of one card, as the compositor resolves it. */
const opacityOf = (page: Page, id: string) =>
  page.locator(`[data-testid="action-${id}"]`)
    .evaluate(el => parseFloat(getComputedStyle(el).opacity));

test.describe('the Scenes grid in Edit Layout', () => {
  test.beforeEach(() => {
    // A wallpaper, because that is the mode the report is in: the cards are
    // glass over a picture, and half opacity over a picture is where they
    // disappear. Everything painted here is the dark-background branch.
    overrideEntityLayouts({
      [`home:${HOME_ID}`]: {
        background: { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 },
        // One shortcut hidden, so the capture shows both states side by side —
        // the distinction the dimming was flattening.
        visibility: { hiddenActions: ['locks'] },
      },
    });
  });

  test('leaves a visible shortcut card at full strength', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await waitForDashboard(page);

    const before = await opacityOf(page, 'lights');
    expect(before, 'a shortcut card is solid before the mode is entered').toBe(1);

    await enterEditLayout(page);

    const lights = await opacityOf(page, 'lights');
    const locks = await opacityOf(page, 'locks');

    fs.mkdirSync(OUT, { recursive: true });
    // The section carries no testid, so the crop is the union of the shortcut
    // cards' own boxes — which is exactly the region the report points at.
    await page.locator('[data-testid="action-lights"]').scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const box = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('[data-testid^="action-"]'))
        .filter(el => !el.getAttribute('data-testid')!.startsWith('action-panel-'));
      const rects = cards.map(el => el.getBoundingClientRect());
      const left = Math.min(...rects.map(r => r.left));
      const top = Math.min(...rects.map(r => r.top));
      const right = Math.max(...rects.map(r => r.right));
      const bottom = Math.max(...rects.map(r => r.bottom));
      return { x: left - 12, y: top - 44, width: right - left + 24, height: bottom - top + 56 };
    });
    await page.screenshot({ path: path.join(OUT, `scenes-${LABEL}.png`), clip: box });
    await page.screenshot({ path: path.join(OUT, `dashboard-${LABEL}.png`) });
    fs.writeFileSync(
      path.join(OUT, `opacity-${LABEL}.json`),
      JSON.stringify({ label: LABEL, visible: lights, hidden: locks }, null, 2),
    );

    // Editing stops the card firing; it does not make it something you can
    // barely see. Nothing else on the dashboard fades for the mode.
    expect(lights, 'a visible shortcut card stays solid while editing').toBe(1);
    // And the one card that SHOULD read as different still does, by a margin
    // you can see rather than 0.1.
    expect(locks, 'a hidden card is still dimmed').toBeLessThan(0.6);
    expect(lights - locks, 'hidden and visible are told apart').toBeGreaterThan(0.3);
  });
});
