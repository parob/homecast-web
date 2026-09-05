/**
 * The automation dialogs close from the top right, like every other dialog.
 *
 * `DialogContent` draws a ✕ at `right-[13px] top-[16px]` unless the caller
 * suppresses it, and almost every dialog in the app takes it. The two
 * automation dialogs used to opt out (`[&>button]:hidden`) and put the dismiss
 * in the footer instead — a "Close" button at the bottom LEFT of the detail
 * dialog, which is the one users reach for and the one place the app puts it
 * somewhere else.
 *
 * Geometry, not a snapshot: the assertions are that the ✕ exists, that it sits
 * in the top-right quadrant of the dialog, and that the enable Switch beside it
 * does not overlap it. The captures are for the eye.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = (name: string) => path.resolve(__dirname, 'output', name);

const dialog = (page: Page) => page.locator('[role="dialog"]').last();
const closeX = (page: Page) => dialog(page).locator('button:has(> span.sr-only)').first();

async function openAutomationDetail(page: Page) {
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.locator('text=Automations').first().click();
  await page.getByTestId('automation-hk-auto-1').click();
  await expect(dialog(page)).toBeVisible({ timeout: 20000 });
  // The dialog zooms in; measure once it has landed.
  await page.waitForTimeout(500);
}

async function box(locator: ReturnType<typeof dialog>) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('element has no box');
  return b;
}

test.describe('Automation dialogs close from the top right', () => {
  test('detail dialog: ✕ top right, no footer Close', async ({ page }, testInfo) => {
    await openAutomationDetail(page);
    await dialog(page).screenshot({ path: out(`automation-detail-${testInfo.project.name}.png`) });

    const d = await box(dialog(page));
    const x = await box(closeX(page));

    // Top-right quadrant of the dialog.
    expect(x.x + x.width / 2).toBeGreaterThan(d.x + d.width / 2);
    expect(x.y + x.height / 2).toBeLessThan(d.y + d.height / 2);

    // The enable switch shares that corner and must not sit under the ✕.
    const s = await box(dialog(page).locator('button[role="switch"]').first());
    expect(s.x + s.width).toBeLessThan(x.x);
    // …and shares its centre line, so the corner reads as one row.
    expect(Math.abs((s.y + s.height / 2) - (x.y + x.height / 2))).toBeLessThanOrEqual(1);

    // The dismiss lives in one place only. The ✕ names itself "Close" through
    // an sr-only span, so this counts the controls a screen reader hears —
    // exactly one, and it is the ✕ measured above.
    const closes = dialog(page).getByRole('button', { name: 'Close', exact: true });
    await expect(closes).toHaveCount(1);
    expect(await closes.first().boundingBox()).toEqual(x);
  });

  test('form dialog: ✕ top right', async ({ page }, testInfo) => {
    await openAutomationDetail(page);
    await dialog(page).getByRole('button', { name: 'Edit' }).click();
    await page.waitForTimeout(600);
    await dialog(page).screenshot({ path: out(`automation-form-${testInfo.project.name}.png`) });

    const d = await box(dialog(page));
    const x = await box(closeX(page));
    expect(x.x + x.width / 2).toBeGreaterThan(d.x + d.width / 2);
    expect(x.y + x.height / 2).toBeLessThan(d.y + d.height / 2);
  });
});
