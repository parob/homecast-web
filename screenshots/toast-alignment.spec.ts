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
   * The phone with a notch — the case the report on homecast-cloud#59 was filed
   * from, and the one every other test here misses because a desktop Chromium
   * has no safe area to get wrong.
   *
   * `isInMobileApp` arrives a render late (Dashboard seeds it `false` and flips
   * it in an effect), so the header's first layout has no `safe-area-top`
   * padding and its row sits at the very top of the viewport. That is the layout
   * AppHeader measures and publishes as `--top-row-center`. When the flag lands
   * the row slides down by the inset — at constant height, and the inset arrives
   * as the header's `padding-top`, so neither a ResizeObserver on the row nor a
   * default (content-box) one on the header sees anything happen. The toaster
   * goes on aiming at the line the row has left: on the reporter's iPhone that
   * put the pill at y=20–61, under a ~62pt status bar.
   */
  test('a one-line toast is centred on the header row under a notch', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone geometry — the header row is 80px there');

    await page.addInitScript(() => {
      (window as Window & { isHomecastIOSApp?: boolean }).isHomecastIOSApp = true;
      // Chromium reports no inset, so stand one in the way the Android shell
      // does. 59px is an iPhone 16 Pro Max's. This runs at document-start,
      // before <html> exists, so it has to wait for it — and it must land
      // before React mounts, which is the whole point: the inset is there from
      // the first layout, and it is the *flag* that arrives late.
      const apply = () => {
        if (document.documentElement) {
          document.documentElement.style.setProperty('--safe-area-top', '59px');
        } else {
          setTimeout(apply, 0);
        }
      };
      apply();
    });
    await setupMocks(page);
    await page.goto(`/portal?home=${HOME_ID}`);
    await expect(headerBurger(page)).toBeVisible({ timeout: 20000 });

    // Both measured after the toast has landed. The header itself moves once
    // the app works out it is in a native shell, so a burger read at first
    // paint is read from a layout that no longer exists.
    await raiseToast(page, 'Sent as #36. Thank you.');
    const burger = await centreY(headerBurger(page));
    const toast = await centreY(toastPill(page));
    const pill = await toastPill(page).boundingBox();

    expect(pill!.y, `pill top is ${pill!.y.toFixed(1)}px — inside the 59px status bar`).toBeGreaterThanOrEqual(59);
    expect(
      Math.abs(toast - burger),
      `toast centre is ${(burger - toast).toFixed(1)}px above the menu button's`,
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
