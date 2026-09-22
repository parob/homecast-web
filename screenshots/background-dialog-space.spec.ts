/**
 * The Home Background dialog's picker gets the room the sliders were wasting.
 *
 * parob/homecast-cloud#178, asks 2 and 3: "there is not enough visibility of
 * the background options. This the scroll view should be taller so maybe make
 * the blur title and other title in line with the bars to adjust them and make
 * this so that it's more space efficient in general."
 *
 * The picker was pinned at `h-[280px]` inside a `flex-1` parent, so it never
 * took the space it was given, and each slider stacked its name above its bar.
 *
 *   npx playwright test background-dialog-space.spec.ts --project=screenshots
 *   BG_DIALOG_LABEL=before npx playwright test background-dialog-space.spec.ts --project=screenshots
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';
const CAPTURE = process.env.BG_DIALOG_LABEL || '';
const OUT = 'output/issue-178';

test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: IPHONE_UA,
});

async function openBackgroundDialog(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);

  const menu = page.locator('[data-tour="header-menu"]').first();
  await expect(menu).toBeVisible();
  await menu.tap();

  const item = page.getByRole('menuitem', { name: 'Background', exact: true }).first();
  await expect(item).toBeVisible();
  await item.click();

  await expect(page.getByRole('dialog').last()).toBeVisible();
  // Wait for the dialog to have SETTLED at its height rather than sleeping and
  // hoping: it animates in, and measuring mid-animation is how a geometry spec
  // becomes flaky on a slow runner. Two equal reads a frame apart mean it has
  // stopped moving.
  await expect
    .poll(async () => {
      const h = await page.getByRole('dialog').last().evaluate((el) => el.getBoundingClientRect().height);
      await new Promise((r) => setTimeout(r, 120));
      const again = await page.getByRole('dialog').last().evaluate((el) => el.getBoundingClientRect().height);
      return h > 0 && Math.abs(h - again) < 1 ? Math.round(h) : -1;
    }, { message: 'the dialog settles at a height', timeout: 15_000 })
    .toBeGreaterThan(0);
}

test('the picker fills the space the dialog has', async ({ page }) => {
  await openBackgroundDialog(page);

  const dialog = page.getByRole('dialog').last();
  // The viewport's boundingBox is its CONTENT box (Radix lays the child out as
  // a table), so it reports the height of everything scrollable. `clientHeight`
  // is the visible window, which is what "how much can I see" means here.
  const viewport = dialog.locator('[data-radix-scroll-area-viewport]').first();
  const visible = await viewport.evaluate((el) => el.clientHeight);
  const content = await viewport.evaluate((el) => el.scrollHeight);
  const dialogBox = await dialog.boundingBox();
  console.log(`[#178] dialog ${Math.round(dialogBox!.height)}px · picker visible ${visible}px of ${content}px of options`);

  if (CAPTURE) {
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: `${OUT}/${CAPTURE}.png` });
  }

  // Measured on main: the wrapper was 235px and the ScrollArea inside it was a
  // fixed 280px, so it OVERFLOWED and was clipped — about 225px of list was
  // reachable and the box's bottom border was cut off. Anything comfortably
  // past that is the improvement; 280 is chosen to be clear of the old value
  // without sitting on a knife-edge.
  expect(visible, 'the picker shows meaningfully more than the ~225px main managed').toBeGreaterThan(280);

  // The regression this nearly shipped with: sizing the ScrollArea by a
  // percentage of a flex parent made it overflow its wrapper instead of
  // clipping, so it stopped scrolling and everything past the fold became
  // unreachable. Taller is only an improvement if it still scrolls.
  expect(content, 'there is more to scroll to than fits').toBeGreaterThan(visible);
  const reach = await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(reach, 'the picker can actually be scrolled to its end').toBeGreaterThan(0);
});

test('each slider puts its name, bar and value on one line', async ({ page }) => {
  await openBackgroundDialog(page);

  const rows = await page.evaluate(() => {
    const out: { name: string; rowHeight: number; childCount: number; labelMid: number; barMid: number; barX: number; barWidth: number }[] = [];
    document.querySelectorAll('label').forEach((lbl) => {
      const name = (lbl.textContent || '').trim();
      if (name !== 'Blur' && name !== 'Brightness') return;
      const row = lbl.parentElement!;
      const rowRect = row.getBoundingClientRect();
      const labelRect = lbl.getBoundingClientRect();
      // The bar is the row's middle child: name, bar, value.
      const bar = (row.children[1] as HTMLElement).getBoundingClientRect();
      out.push({
        name,
        rowHeight: Math.round(rowRect.height),
        childCount: row.children.length,
        labelMid: labelRect.y + labelRect.height / 2,
        barMid: bar.y + bar.height / 2,
        barX: Math.round(bar.x),
        barWidth: Math.round(bar.width),
      });
    });
    return out;
  });

  expect(rows.map((r) => r.name)).toEqual(['Blur', 'Brightness']);

  for (const row of rows) {
    console.log(`[#178] ${row.name}: row ${row.rowHeight}px · ${row.childCount} children · bar x ${row.barX} w ${row.barWidth} · label mid ${Math.round(row.labelMid)} · bar mid ${Math.round(row.barMid)}`);
    // name, bar, value — the bar is IN the row, not stacked underneath it.
    // Stacked, the row held only the name and the value, so its middle child
    // was the ~50px value rather than a full-width bar.
    expect(row.childCount, `${row.name}'s row holds name, bar and value`).toBe(3);
    expect(row.barWidth, `${row.name}'s bar is in the row, not below it`).toBeGreaterThan(100);
    // Stacked, a slider's name sat on its own line above the bar and the pair
    // was ~55px tall. In line, the row is one line.
    expect(row.rowHeight, `${row.name} should be a single line`).toBeLessThan(40);
    expect(Math.abs(row.labelMid - row.barMid), `${row.name}'s name should sit on the same line as its bar`).toBeLessThan(8);
  }

  // A fixed-width name column, so the two bars start together rather than
  // stepping with the length of the word beside them.
  expect(rows[0].barX, 'both bars start on the same x').toBe(rows[1].barX);
});
