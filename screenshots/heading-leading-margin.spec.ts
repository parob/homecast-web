/**
 * The home name and the room name start on the header row's leading margin.
 *
 * parob/homecast-cloud#163: on a phone the web's big heading sat ~5px left of
 * the back chevron above it, where the native iOS build has the two flush.
 *
 * Native draws the back button and the large title from ONE leading margin
 * (`NativeHeaderBar.swift`: `let leading = max(view.layoutMargins.left, 16)`,
 * and UIKit puts the back button on that same margin). The web drew them from
 * two: the header row's `px-4` and the page container's `px-3`.
 *
 * What is asserted is the RELATIONSHIP, not a pixel constant — the heading's
 * text starts where the header row's content starts. Retune either gutter and
 * this still holds; reintroduce a second gutter and it fails.
 *
 * The page's own gutter is deliberately NOT part of it: the tile grid stays on
 * `px-3`. Native steps the title in while the content beneath keeps the page
 * margin, and the reporter's two screenshots agree on the grid to the pixel —
 * widening the container would move every tile and lose a match that is
 * currently exact. The third assertion is what pins that down.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(HERE, 'evidence', 'issue-163');
/**
 * Regenerate the committed before/after pair:
 *   H163_LABEL=before npx playwright test heading-leading-margin.spec.ts --project=screenshots
 * (with the fix stashed), then again with the default label.
 */
const LABEL = process.env.H163_LABEL || 'after';

/** The reporter's device, from the context blob on the issue. */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';

test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: IPHONE_UA,
});

type Probe = {
  headerContentLeft: number;
  headingTextLeft: number;
  gridLeft: number | null;
  pageGutterLeft: number;
};

/**
 * Geometry in CSS px. The heading's figure is the left edge of its first real
 * glyph, not the element box: the title button carries `px-3 -mx-3`, so its
 * box starts a gutter to the left of the text and measuring it would compare
 * the wrong two things.
 */
async function probe(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const textLeft = (el: Element | null): number => {
      if (!el) throw new Error('no element to measure');
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let best = Infinity;
      let n: Node | null;
      while ((n = walker.nextNode())) {
        if (!n.textContent || !n.textContent.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        const b = r.getBoundingClientRect();
        if (b.width > 0) best = Math.min(best, b.left);
      }
      if (best === Infinity) throw new Error('no text found');
      return best;
    };

    // The header row: the element inside <header> that actually carries the
    // row's gutter. Found by its padding rather than its class, so a rename
    // does not silently turn this assertion off.
    const header = document.querySelector('header');
    if (!header) throw new Error('no header');
    const row = Array.from(header.querySelectorAll<HTMLElement>('div')).find(
      (d) => parseFloat(getComputedStyle(d).paddingLeft) > 0 && d.getBoundingClientRect().width > 300,
    );
    if (!row) throw new Error('no padded header row');
    const rowRect = row.getBoundingClientRect();
    const headerContentLeft = rowRect.left + parseFloat(getComputedStyle(row).paddingLeft);

    const h2 = document.querySelector('h2');
    if (!h2) throw new Error('no heading');

    const page = h2.closest<HTMLElement>('.px-3');
    if (!page) throw new Error('no page container');
    const pageRect = page.getBoundingClientRect();

    const tile = document.querySelector('main [class*="grid"] > *');

    return {
      headerContentLeft,
      headingTextLeft: textLeft(h2),
      gridLeft: tile ? tile.getBoundingClientRect().left : null,
      pageGutterLeft: pageRect.left + parseFloat(getComputedStyle(page).paddingLeft),
    };
  });
}

async function openHome(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  // At the top deliberately: a scrolled page collapses the header to its
  // compact title, which is a different bar from the one under test.
  await page.evaluate(() => {
    const s = document.scrollingElement || document.documentElement;
    s.scrollTop = 0;
  });
  await page.waitForTimeout(700);
}

for (const where of ['home', 'room'] as const) {
  test(`the ${where} heading starts on the header row's leading margin`, async ({ page }) => {
    await openHome(page);
    if (where === 'room') {
      await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
      await expect(page.getByRole('heading', { name: /Bedroom/ })).toBeVisible();
      await page.evaluate(() => {
        const s = document.scrollingElement || document.documentElement;
        s.scrollTop = 0;
      });
      await page.waitForTimeout(700);
    }

    const m = await probe(page);
    console.log(`[${where}] ` + JSON.stringify(m));

    // 1. The whole point: one leading margin, as native has.
    expect(Math.round(m.headingTextLeft)).toBe(Math.round(m.headerContentLeft));

    // 2. The heading is stepped in from the page's own gutter, not flush with
    //    it — i.e. this was fixed by moving the title, not by widening the page.
    expect(m.headingTextLeft).toBeGreaterThan(m.pageGutterLeft);

    // 3. And the grid did not move with it.
    if (m.gridLeft !== null) {
      expect(Math.round(m.gridLeft)).toBe(Math.round(m.pageGutterLeft));
    }
  });
}

test('the room page keeps the heading flush with the back chevron', async ({ page }) => {
  await openHome(page);
  await page.locator('main').getByRole('button', { name: 'Bedroom', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: /Bedroom/ })).toBeVisible();
  await page.evaluate(() => {
    const s = document.scrollingElement || document.documentElement;
    s.scrollTop = 0;
  });
  await page.waitForTimeout(700);

  // The reported comparison, made directly: the chevron's own glass container
  // sits on the header row's margin, so the heading must line up with it.
  const chevron = await page.evaluate(() => {
    const back = document.querySelector('[data-testid="header-back"]');
    if (!back) throw new Error('no back button');
    const glass = back.closest('div');
    return (glass ?? back).getBoundingClientRect().left;
  });
  const m = await probe(page);
  console.log('[chevron] ' + JSON.stringify({ chevron, heading: m.headingTextLeft }));
  expect(Math.abs(m.headingTextLeft - chevron)).toBeLessThanOrEqual(1);

  // The picture, with a guide drawn on the margin the title should start on.
  // A number in a log line does not show a reviewer the thing the reporter saw.
  fs.mkdirSync(OUT, { recursive: true });
  await page.evaluate((x) => {
    const g = document.createElement('div');
    g.style.cssText =
      `position:fixed;left:${x}px;top:0;width:1px;height:100vh;` +
      'background:#ff2d55;z-index:2147483647;pointer-events:none';
    document.body.appendChild(g);
  }, chevron);
  await page.waitForTimeout(150);
  await page.screenshot({
    path: path.join(OUT, `room-heading-${LABEL}.png`),
    clip: { x: 0, y: 0, width: 440, height: 300 },
  });
});
