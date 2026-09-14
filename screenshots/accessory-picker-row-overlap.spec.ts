/**
 * The accessory picker's rows must not overlap each other.
 *
 * parob/homecast-cloud#121: in the picker list, a row's background paints over
 * the bottom of the row above it, clipping that row's subtitle mid-glyph.
 *
 * The cause is geometric, not cosmetic: the list is virtualized, and every row
 * is absolutely positioned at a multiple of `ROW_HEIGHT`. When the row's own
 * content is taller than `ROW_HEIGHT`, each row spills into the slot of the
 * next one. So the check is arithmetic — the rendered height of a row against
 * the distance to the next row's top — and it holds whatever the host dialog
 * is, because every caller renders the same `AccessoryPicker`.
 *
 *   npx playwright test accessory-picker-row-overlap.spec.ts \
 *     --config=playwright.local.config.ts --project=screenshots
 *
 * Pictures land in the gitignored `output/picker-overlap/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.PICKER_OVERLAP_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'picker-overlap');

/**
 * Open the collection's "Select Accessories" dialog — the same one the report
 * was filed from.
 */
async function openPicker(page: Page) {
  const collection = page
    .locator('button, div[class*="cursor"]')
    .filter({ hasText: 'All Lights' })
    .first();
  await collection.click({ force: true });
  await page.waitForTimeout(600);
  await collection.click({ button: 'right', force: true });
  await page.waitForTimeout(500);
  await page.getByRole('menuitem', { name: 'Select Accessories' }).first().click();
  await page.waitForTimeout(1200);

  const dialog = page.locator('[role="dialog"]').last();
  await expect(dialog.getByPlaceholder('Search accessories...')).toBeVisible();
  return dialog;
}

type RowGeometry = {
  name: string;
  slotHeight: number;
  contentHeight: number;
  top: number;
  bottom: number;
};

/**
 * Measure each rendered row: the height of the virtualizer's slot, and the
 * height the row's own content actually takes.
 */
async function measureRows(page: Page): Promise<RowGeometry[]> {
  return page.evaluate(() => {
    const dialogs = document.querySelectorAll('[role="dialog"]');
    const dialog = dialogs[dialogs.length - 1] as HTMLElement;
    const slots = Array.from(
      dialog.querySelectorAll<HTMLElement>('div[style*="translateY"]')
    ).filter((slot) => slot.querySelector('button'));

    return slots
      .map((slot) => {
        const button = slot.querySelector('button') as HTMLElement;
        const box = button.getBoundingClientRect();
        return {
          name: (button.textContent || '').trim().slice(0, 40),
          slotHeight: slot.getBoundingClientRect().height,
          contentHeight: box.height,
          top: box.top,
          bottom: box.bottom,
        };
      })
      .sort((a, b) => a.top - b.top);
  });
}

test.describe('accessory picker rows', () => {
  test.beforeEach(async ({ page }) => {
    await setupMocks(page);
    await page.goto('/portal');
    await page.waitForTimeout(2000);
  });

  test('no row overlaps the row below it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Measured once, on the desktop viewport');

    const dialog = await openPicker(page);
    const rows = await measureRows(page);
    expect(rows.length).toBeGreaterThan(3);

    // Hovering paints the row's background, which is what makes the overlap
    // visible: it covers the tail of the row above.
    await dialog.locator('div[style*="translateY"] > button').nth(3).hover();
    await page.waitForTimeout(250);

    fs.mkdirSync(OUT, { recursive: true });
    await dialog.screenshot({ path: path.join(OUT, `picker-${LABEL}.png`) });

    const overlaps = rows.slice(0, -1).map((row, i) => ({
      above: row.name,
      below: rows[i + 1].name,
      // > 0 means the row extends into the next row's slot
      overlapPx: Number((row.bottom - rows[i + 1].top).toFixed(2)),
    }));
    const worst = Math.max(...overlaps.map((o) => o.overlapPx));

    console.log(
      JSON.stringify(
        {
          slotHeight: rows[0].slotHeight,
          contentHeight: rows[0].contentHeight,
          worstOverlapPx: worst,
          overlaps: overlaps.slice(0, 5),
        },
        null,
        2
      )
    );

    // Sub-pixel rounding is fine; a whole pixel of overlap is the bug.
    expect(worst).toBeLessThanOrEqual(0.5);
    // And the slot must be able to hold what the row draws.
    expect(rows[0].contentHeight).toBeLessThanOrEqual(rows[0].slotHeight);
  });
});
