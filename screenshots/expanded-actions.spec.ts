import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidence = (name: string) => path.join(__dirname, 'evidence', 'issue-162', name);

/**
 * The expanded panel's action cluster, as reported in homecast-cloud#162:
 * "Remove the expand button from this view … the buttons on the screen are just
 * icons it's not clear enough what they'll do."
 *
 * Two separate claims, so two separate guards.
 *
 * The first is that Size is gone from the panel. Asserted with the three sizes
 * ON OFFER (`?sizes=1`), because the interesting failure is not "a tile that
 * can't resize has no size button" — it is a tile that can, and still doesn't
 * offer it here. Edit Layout's badge and the desktop context menu are the two
 * routes that remain, and `edit-badge-hit-target.spec.ts` guards the first.
 *
 * The second is that each button says what it does in a word. A label is worth
 * nothing if the panel then cuts it in half, so the words are measured for
 * clipping and the cluster for overflow rather than merely being present in the
 * DOM — `textContent` would pass on a pill one character wide.
 */

const frame = (page: Page) => page.locator('[data-panel-frame]');
const buttons = (page: Page) => page.locator('[data-panel-frame] button');

async function open(page: Page, query: string) {
  await page.goto(`/screenshots/fixtures/expanded-actions.html?${query}`);
  await expect(buttons(page).first()).toBeVisible();
  await page.waitForTimeout(200);
}

/** Every action pill: its word, whether that word is cut off, and where it sits. */
function cluster(page: Page) {
  return page.evaluate(() => {
    const card = document.querySelector('[data-panel-frame] [class*="rounded"]')!.getBoundingClientRect();
    const pills = [...document.querySelectorAll('[data-panel-frame] button')]
      .filter(b => b.textContent?.trim())
      .map(b => {
        const r = b.getBoundingClientRect();
        return {
          word: b.textContent!.trim(),
          name: b.getAttribute('aria-label'),
          // A pill whose text does not fit is the failure this change was made
          // to prevent, so it is measured rather than assumed.
          clipped: b.scrollWidth > b.clientWidth + 1,
          left: r.left,
          right: r.right,
          top: r.top,
          width: r.width,
        };
      });
    const title = document.querySelector('[data-panel-frame] h3');
    return {
      pills,
      // How many lines the cluster occupies, by distinct pill top edge.
      rows: new Set(pills.map(p => Math.round(p.top))).size,
      cardLeft: card.left,
      cardRight: card.right,
      titleWidth: title ? title.getBoundingClientRect().width : 0,
      titleClipped: title ? title.scrollWidth > title.clientWidth + 1 : false,
    };
  });
}

test.describe('expanded panel actions', () => {
  test('the panel offers no Size button even when the tile can be resized', async ({ page }) => {
    await open(page, 'sizes=1&virtual=1');
    const names = await buttons(page).evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    expect(names).not.toContain(expect.stringContaining('Size'));
    expect(names.some(n => /size/i.test(n ?? ''))).toBe(false);
    // The actions it does keep, so a future edit cannot satisfy this by
    // emptying the cluster.
    expect(names).toEqual(['Analytics', 'Edit', 'Share', 'Pin to Tab Bar', 'Delete Virtual Accessory']);
    await frame(page).screenshot({ path: evidence('panel-after.png') });
  });

  test('every action reads as a word, uncut, inside the panel', async ({ page }) => {
    await open(page, 'sizes=1&virtual=1');
    const { pills, cardLeft, cardRight } = await cluster(page);
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Edit', 'Share', 'Pin', 'Delete']);
    for (const pill of pills) {
      expect(pill.clipped, `${pill.word} is cut off`).toBe(false);
      expect(pill.left, `${pill.word} starts outside the panel`).toBeGreaterThanOrEqual(cardLeft);
      expect(pill.right, `${pill.word} runs past the panel`).toBeLessThanOrEqual(cardRight);
    }
    // The long phrasing is not lost, it moves to the accessible name.
    expect(pills.find(p => p.word === 'Pin')?.name).toBe('Pin to Tab Bar');
    expect(pills.find(p => p.word === 'Delete')?.name).toBe('Delete Virtual Accessory');
  });

  // Asked on review of #210: "in the example it wraps to two lines is this
  // defo necessary?" — a fair question, because the example was `?virtual=1`,
  // the widest the cluster ever gets. These two pin the answer so nobody has
  // to re-measure it: an ordinary accessory never wraps, and the widest one
  // cannot be made to fit. Both are asserted at 320px, the narrowest phone
  // width there is, because that is where an answer of "it fits" would fail.
  test('an ordinary accessory keeps its actions on one row, down to 320px', async ({ page }) => {
    await open(page, 'sizes=1&w=320');
    const { pills, rows, cardRight } = await cluster(page);
    // What the reported doorbell actually offers: no Edit and no Delete,
    // because those are a virtual accessory's and a camera is never one.
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Share', 'Pin']);
    expect(rows).toBe(1);
    for (const pill of pills) expect(pill.right).toBeLessThanOrEqual(cardRight);
  });

  test('the widest cluster has to wrap — no phone is wide enough for it', async ({ page }) => {
    // `?pinned=1` for `Unpin`, which is 14px wider than `Pin`. The worst case
    // is the one the layout has to survive, not the tidiest one.
    await open(page, 'sizes=1&virtual=1&pinned=1&w=320');
    const { pills, rows } = await cluster(page);
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Edit', 'Share', 'Unpin', 'Delete']);
    expect(rows).toBeGreaterThan(1);
    // The arithmetic behind that, so a future attempt to tighten the pills
    // back onto one line can see what it is up against before trying: even
    // with no padding and no icons at all, five words do not fit 320px.
    const widest = pills.reduce((sum, p) => sum + p.width, 0) + (pills.length - 1) * 6;
    expect(widest).toBeGreaterThan(360);
  });

  test('a landscape camera keeps its name beside the words', async ({ page }) => {
    // 568 is the narrowest landscape a phone actually reports, and this fixture
    // carries MORE pills than an immersive camera can (a camera is never a
    // virtual accessory, so Edit and Delete are not on offer there) — so it
    // fails before the real thing would.
    await open(page, 'sizes=1&virtual=1&immersive=1&w=568');
    const { pills, cardRight, titleWidth, titleClipped } = await cluster(page);
    expect(pills.length).toBeGreaterThan(0);
    for (const pill of pills) {
      expect(pill.right, `${pill.word} runs past the panel`).toBeLessThanOrEqual(cardRight);
      expect(pill.clipped, `${pill.word} is cut off`).toBe(false);
    }
    expect(titleClipped).toBe(false);
    expect(titleWidth).toBeGreaterThan(60);
    await frame(page).screenshot({ path: evidence('immersive-after.png') });
  });
});
