import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidence = (name: string) => path.join(__dirname, 'evidence', 'issue-162', name);
const evidence173 = (name: string) => path.join(__dirname, 'evidence', 'issue-173', name);

/**
 * The expanded panel's action cluster, as reported in homecast-cloud#162:
 * "Remove the expand button from this view … the buttons on the screen are just
 * icons it's not clear enough what they'll do." — and again in #173: "Remove pin
 * from the options when you expand any widget … this should only be accessible
 * in editing mode and that's enough".
 *
 * Three separate claims, so three separate guards.
 *
 * The first two are that Size and Pin are gone from the panel. Each is asserted
 * with the thing ON OFFER — the three sizes through `?sizes=1`, pinning through
 * the fixture's `PinnedTabsProvider` — because the interesting failure is not
 * "a tile that can't resize has no size button", it is a tile that can, and
 * still doesn't offer it here. The routes that remain are Edit Layout's badge
 * (`edit-badge-hit-target.spec.ts` guards it, and `edit-mode-tile.test.tsx`
 * asserts Pin is on it), the tab bar's own unpin badge
 * (`tab-bar-unpin-badge.spec.ts`), and, for Size, the desktop context menu.
 *
 * The third is that each button says what it does in a word. A label is worth
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
    expect(names).toEqual(['Analytics', 'Edit', 'Share', 'Delete Virtual Accessory']);
    await frame(page).screenshot({ path: evidence('panel-after.png') });
  });

  test('the panel offers no Pin button even though pinning is on offer', async ({ page }) => {
    // The fixture wraps the card in a `PinnedTabsProvider` with `enabled: true`,
    // which is what used to put `Pin` in this row — so an empty cluster or a
    // missing provider cannot be what makes this pass. homecast-cloud#173.
    await open(page, 'sizes=1&virtual=1');
    const names = await buttons(page).evaluateAll(els => els.map(e => e.getAttribute('aria-label')));
    expect(names.some(n => /pin/i.test(n ?? ''))).toBe(false);
    expect(names).toEqual(['Analytics', 'Edit', 'Share', 'Delete Virtual Accessory']);
    await frame(page).screenshot({ path: evidence173('panel-after.png') });
  });

  test('every action reads as a word, uncut, inside the panel', async ({ page }) => {
    await open(page, 'sizes=1&virtual=1');
    const { pills, cardLeft, cardRight } = await cluster(page);
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Edit', 'Share', 'Delete']);
    for (const pill of pills) {
      expect(pill.clipped, `${pill.word} is cut off`).toBe(false);
      expect(pill.left, `${pill.word} starts outside the panel`).toBeGreaterThanOrEqual(cardLeft);
      expect(pill.right, `${pill.word} runs past the panel`).toBeLessThanOrEqual(cardRight);
    }
    // The long phrasing is not lost, it moves to the accessible name.
    expect(pills.find(p => p.word === 'Delete')?.name).toBe('Delete Virtual Accessory');
  });

  // Asked on review of #210: "in the example it wraps to two lines is this
  // defo necessary?" — a fair question, because the example was `?virtual=1`,
  // the widest the cluster ever gets. These three pin the answer so nobody has
  // to re-measure it: an ordinary accessory never wraps; the widest one still
  // cannot fit 320px; and since #173 took Pin off the row, the widest one no
  // longer wraps at the 440px the panel was reported from. The first two are
  // asserted at 320px, the narrowest phone width there is, because that is
  // where an answer of "it fits" would fail.
  test('an ordinary accessory keeps its actions on one row, down to 320px', async ({ page }) => {
    await open(page, 'sizes=1&w=320');
    const { pills, rows, cardRight } = await cluster(page);
    // What the reported doorbell actually offers: no Edit and no Delete,
    // because those are a virtual accessory's and a camera is never one — and
    // no Pin, which #173 took off this row.
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Share']);
    expect(rows).toBe(1);
    for (const pill of pills) expect(pill.right).toBeLessThanOrEqual(cardRight);
  });

  test('the widest cluster still wraps at 320px — the narrowest phone there is', async ({ page }) => {
    await open(page, 'sizes=1&virtual=1&w=320');
    const { pills, rows, cardLeft, cardRight } = await cluster(page);
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Edit', 'Share', 'Delete']);
    expect(rows).toBeGreaterThan(1);
    // The arithmetic behind that, measured rather than asserted as a constant
    // so a future change to the pills re-measures itself: the four words and
    // their gaps are wider than the panel's content box, so they cannot share
    // a line whatever the padding is.
    const wanted = pills.reduce((sum, p) => sum + p.width, 0) + (pills.length - 1) * 6;
    expect(wanted).toBeGreaterThan(cardRight - cardLeft);
  });

  test('at the reported 440px the widest cluster now fits on one row', async ({ page }) => {
    // It did not before #173 — five pills measured 377px against a ~368px
    // content box, which is the wrap that was queried on review of #210.
    // Dropping Pin takes the widest case to 314px, so it fits with room over.
    await open(page, 'sizes=1&virtual=1');
    const { pills, rows, cardRight } = await cluster(page);
    expect(pills.map(p => p.word)).toEqual(['Analytics', 'Edit', 'Share', 'Delete']);
    expect(rows).toBe(1);
    for (const pill of pills) {
      expect(pill.clipped, `${pill.word} is cut off`).toBe(false);
      expect(pill.right, `${pill.word} runs past the panel`).toBeLessThanOrEqual(cardRight);
    }
    // No separate capture: this is the same fixture state as the no-Pin test
    // above, which already writes `issue-173/panel-after.png`.
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
