import { test, expect, type Page } from '@playwright/test';
import { setupMocks, waitForDashboard, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

const panels = (page: Page) => page.locator('[data-expandable-widget]');
const pageScroll = (page: Page) => page.evaluate(() => ({ document: window.scrollY, inner: document.querySelector('[data-page-scroller]')!.scrollTop }));
async function open(page: Page, inner = false, initialScroll = 0) {
  await page.goto(`/screenshots/fixtures/expanded-overlay.html${inner ? '?inner' : ''}`);
  await expect(page.getByRole('button', { name: 'Open widget', exact: true })).toBeVisible();
  await page.evaluate(({ inner, initialScroll }) => {
    if (inner) document.querySelector('[data-page-scroller]')!.scrollTop = initialScroll;
    else window.scrollTo({ top: initialScroll, behavior: 'instant' });
  }, { inner, initialScroll });
  await expect.poll(async () => { const p = await pageScroll(page); return p.document + p.inner; }).toBe(initialScroll);
  await page.getByRole('button', { name: 'Open widget', exact: true }).click();
  await expect(panels(page)).toHaveCount(1);
  await page.waitForTimeout(300);
}

for (const inner of [false, true]) {
  test(`locks the ${inner ? 'shell' : 'document'} behind a scrollable widget and restores it on close`, async ({ page }) => {
    await open(page, inner, 100);
    const initial = await pageScroll(page);
    expect(initial).toEqual(inner ? { document: 0, inner: 100 } : { document: 100, inner: 0 });
    const content = page.locator('[data-panel-content]');
    const scroller = content.locator('..');
    await content.hover({ position: { x: 50, y: 150 } });
    await page.mouse.wheel(0, 350);
    await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
    await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; });
    await page.mouse.wheel(0, 800);
    await page.waitForTimeout(300);
    expect(await pageScroll(page)).toEqual(initial);
    await page.mouse.move(5, 180);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    expect(await pageScroll(page)).toEqual(initial);
    await expect(panels(page)).toHaveCount(1);
    await scroller.evaluate(el => { el.scrollTop = 0; });
    await page.getByRole('button', { name: 'Close widget', exact: true }).click();
    await expect(panels(page)).toHaveCount(0);
    expect(await pageScroll(page)).toEqual(initial);
    await page.mouse.move(5, 180);
    await page.mouse.wheel(0, 500);
    await expect.poll(async () => { const p = await pageScroll(page); return p.document + p.inner; }).toBeGreaterThan(initial.document + initial.inner);
  });
}

for (const name of ['Home title', 'Header menu']) {
  test(`${name} dismisses the widget without swallowing its menu interaction`, async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('menuitem', { name: `${name} action` })).toBeVisible();
    await expect(panels(page)).toHaveCount(0);
  });
}

test('nested widgets and dialogs remain scrollable without unlocking the page', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Open nested widget' }).click();
  await expect(panels(page)).toHaveCount(2);
  const nestedScroll = page.getByRole('button', { name: 'Close nested widget' }).locator('../..');
  await nestedScroll.hover({ position: { x: 50, y: 180 } });
  await page.mouse.wheel(0, 200);
  await expect.poll(() => nestedScroll.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  await nestedScroll.evaluate(el => { el.scrollTop = 0; });
  await page.getByRole('button', { name: 'Close nested widget' }).click();
  await expect(panels(page)).toHaveCount(1);
  await page.getByRole('button', { name: 'Open dialog' }).click();
  const dialog = page.locator('[data-dialog-scroll]');
  await dialog.hover();
  await page.mouse.wheel(0, 250);
  await expect.poll(() => dialog.evaluate(el => el.scrollTop)).toBeGreaterThan(0);
  expect(await pageScroll(page)).toEqual({ document: 0, inner: 0 });
  await expect(panels(page)).toHaveCount(1);
});

test('keyboard scroll stays off the background and keyboard menu activation closes the widget', async ({ page }) => {
  await open(page, true);
  await page.keyboard.press('PageDown');
  await page.keyboard.press('End');
  expect(await pageScroll(page)).toEqual({ document: 0, inner: 0 });
  await page.getByRole('button', { name: 'Header menu', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: 'Header menu action' })).toBeVisible();
  await expect(panels(page)).toHaveCount(0);
});

test('touch scrolling cannot move the page behind a widget', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch viewport only');
  await open(page, true);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 5, y: 650 }] });
  for (let y = 620; y >= 350; y -= 30) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 5, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  expect(await pageScroll(page)).toEqual({ document: 0, inner: 0 });
  await expect(panels(page)).toHaveCount(1);
  await cdp.detach();
  await page.touchscreen.tap(5, 180);
  await expect(panels(page)).toHaveCount(0);
});

test('real dashboard header menu dismisses an ordinary expanded widget', async ({ page }) => {
  overrideSettings({ display: { compactMode: true }, developerMode: true });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.locator('main').getByText('Ceiling Fan', { exact: true }).first().click();
  const panel = page.locator('[data-expanded-overlay="open"]');
  await expect(panel).toHaveCount(1);
  await page.locator('[data-tour="header-menu"]').click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(panel).toHaveCount(0);
});

test('real dashboard home title dismisses an ordinary expanded widget', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone home-title menu');
  overrideSettings({ display: { compactMode: true }, developerMode: true });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.locator('main').getByText('Ceiling Fan', { exact: true }).first().click();
  const panel = page.locator('[data-expanded-overlay="open"]');
  await expect(panel).toHaveCount(1);
  await page.locator('main').getByRole('heading', { name: /^My Home/ }).getByRole('button', { name: 'My Home', exact: true }).click();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(panel).toHaveCount(0);
});
