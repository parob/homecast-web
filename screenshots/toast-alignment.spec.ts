/**
 * A toast lands on the same line as the controls it shares the top of the
 * screen with.
 *
 * The toaster is `top-center` at a 16px offset, so its TOP edge is 16px down
 * and where its middle falls depends on how tall the toast happens to be. The
 * header row is 80px and centres its controls at 40px, so the two only line up
 * for a toast exactly 48px tall — and the one-line pill is not. It rides a few
 * pixels high, which is invisible until a toast is drawn beside a button, as it
 * is over Edit Layout's bar (burger on the left, Done on the right).
 *
 * Only a real browser can show this: the offset is a `calc()` resolved against
 * a rendered toast's own height, and jsdom has no layout to resolve it against.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

const headerBurger = (page: Page) => page.locator('[data-tour="sidebar-menu"]');
const editBarBurger = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"] button[aria-label="Open menu"]');
const doneButton = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"] button', { hasText: 'Done' });
const toastPill = (page: Page) => page.locator('[data-sonner-toast]');

async function centreY(locator: ReturnType<typeof headerBurger>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y + box.height / 2;
}

/**
 * Raise a real toast through the app's own toaster. Vite serves the source
 * module, and it is the same instance the mounted `<Toaster/>` listens to, so
 * this is the same call every `toast.success(...)` in the app makes.
 */
async function raiseToast(page: Page, message: string) {
  await page.evaluate(async (text) => {
    const mod = await import('/src/components/ui/sonner.tsx');
    mod.toast.success(text);
  }, message);
  await expect(toastPill(page)).toBeVisible();
  // Sonner mounts at its final offset and animates in; measure once it lands.
  await page.waitForTimeout(600);
}

test.describe('Toast alignment', () => {
  test('a one-line toast is centred on the header row', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry — the header row is 80px there');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(headerBurger(page)).toBeVisible({ timeout: 20000 });

    const burger = await centreY(headerBurger(page));
    await raiseToast(page, 'Sent as #36. Thank you.');
    const toast = await centreY(toastPill(page));

    expect(
      Math.abs(toast - burger),
      `toast centre is ${(burger - toast).toFixed(1)}px above the menu button's`,
    ).toBeLessThanOrEqual(1);
  });

  test('a one-line toast is centred on Edit Layout’s bar', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(headerBurger(page)).toBeVisible({ timeout: 20000 });

    await page.locator('[data-tour="header-menu"]').click();
    await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
    await expect(editBarBurger(page)).toBeVisible();
    await page.waitForTimeout(500);

    const burger = await centreY(editBarBurger(page));
    const done = await centreY(doneButton(page));
    await raiseToast(page, 'Sent as #36. Thank you.');
    const toast = await centreY(toastPill(page));

    expect(
      Math.abs(toast - burger),
      `toast centre is ${(burger - toast).toFixed(1)}px above the menu button's`,
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs(toast - done),
      `toast centre is ${(done - toast).toFixed(1)}px above Done's`,
    ).toBeLessThanOrEqual(1);
  });

  /**
   * The Mac app is the case a better constant would have broken. Its header row
   * starts at the 33px title-bar inset and renders 70px tall rather than the
   * 56px its class asks for — the left cluster sets the height — so the old
   * `16px` offset happened to land within a pixel there while being 4.25px out
   * on a phone. Whatever the toaster is anchored to has to satisfy both.
   */
  test('a one-line toast is centred on the Mac app’s shorter row', async ({ page }, testInfo) => {
    // Runs on the phone project because the burger is `md:hidden` and there is
    // nothing to measure against above 768px. What is under test is the row's
    // vertical geometry — the 33px inset above it and the height its content
    // gives it — which does not depend on the window's width.
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Needs a viewport narrow enough to draw the burger');

    await page.addInitScript(() => {
      (window as Window & { isHomecastMacApp?: boolean }).isHomecastMacApp = true;
    });
    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(headerBurger(page)).toBeVisible({ timeout: 20000 });

    const burger = await centreY(headerBurger(page));
    await raiseToast(page, 'Sent as #36. Thank you.');
    const toast = await centreY(toastPill(page));

    expect(
      Math.abs(toast - burger),
      `toast centre is ${(burger - toast).toFixed(1)}px off the menu button's`,
    ).toBeLessThanOrEqual(1);
  });
});
