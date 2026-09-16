import { test, expect, type Page } from '@playwright/test';

async function expectFitted(page: Page, height: number, inset = 0) {
  await expect.poll(() => page.locator('[data-expanded-overlay="open"]').evaluate(panel => {
    const image = panel.querySelector('img')!;
    const close = panel.querySelector('[aria-label="Close camera"]')!;
    const p = panel.getBoundingClientRect();
    const i = image.getBoundingClientRect();
    const c = close.getBoundingClientRect();
    return Math.max(p.bottom, i.bottom, c.bottom);
  })).toBeLessThanOrEqual(height - inset);
  await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
  const image = page.locator('[data-expanded-overlay="open"] img');
  await expect(image).toBeVisible();
  const dimensions = await image.evaluate(img => {
    const r = img.getBoundingClientRect();
    return { ratio: r.width / r.height, natural: (img as HTMLImageElement).naturalWidth / (img as HTMLImageElement).naturalHeight, height: r.height };
  });
  expect(dimensions.ratio).toBeCloseTo(dimensions.natural, 2);
  expect(dimensions.height).toBeGreaterThan(30);
}

test('camera image and controls fit a short window, including a reserved bottom bar', async ({ page }) => {
  await page.setViewportSize({ width: 700, height: 400 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&phase=paused&inset=60');
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByAltText('Front Door snapshot')).toBeVisible();
  await expectFitted(page, 400, 60);
  const close = page.getByRole('button', { name: 'Close camera' });
  await expect(close).toHaveText('Close');
  const controls = await close.evaluate(button => ({
    height: button.getBoundingClientRect().height,
    bottom: button.getBoundingClientRect().bottom,
    frameTop: document.querySelector('[data-camera-frame]')!.getBoundingClientRect().top,
  }));
  expect(controls.height).toBeGreaterThanOrEqual(44);
  expect(controls.bottom).toBeLessThanOrEqual(controls.frameTop);
  await expect(page.getByText('Paused', { exact: true })).toBeVisible();
  await expect(page.getByText(/Last image:|Resume when|Up to two/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Close camera' }).click();
  await expect(page.locator('[data-expanded-overlay="open"]')).toHaveCount(0);
});

test('an open camera refits when the visible viewport shrinks', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 800 });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: Object.assign(new EventTarget(), {
      width: 900, height: 800, offsetTop: 0, offsetLeft: 0, scale: 1,
    }) });
  });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&landscape');
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByAltText('Front Door live view')).toBeVisible();
  await expectFitted(page, 800);
  // Browser chrome/keyboard can change the visible viewport without changing
  // innerHeight. Keep this independent of Playwright's layout viewport resize.
  await page.evaluate(() => {
    Object.assign(window.visualViewport!, { height: 420 });
    window.visualViewport!.dispatchEvent(new Event('resize'));
  });
  await expectFitted(page, 420);
});

test('camera refits on window resize and keeps clear of device safe areas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay');
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-top', '24px');
    document.documentElement.style.setProperty('--safe-area-bottom', '34px');
  });
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByAltText('Front Door live view')).toBeVisible();
  await expectFitted(page, 700, 34);
  await page.setViewportSize({ width: 700, height: 390 });
  await expectFitted(page, 390, 34);
  const top = await page.locator('[data-expanded-overlay="open"]').evaluate(el => el.getBoundingClientRect().top);
  expect(top).toBeGreaterThanOrEqual(24);
});

test('queued camera uses a short status and an obvious close control', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&phase=queued');
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByText('Queued · 2', { exact: true })).toBeVisible();
  await expect(page.getByText(/Up to two|camera slot|Last image:/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close camera' })).toHaveText('Close');
  await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
});
