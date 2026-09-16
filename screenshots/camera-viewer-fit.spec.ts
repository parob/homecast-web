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
  await expect(close).toHaveText('');
  // Use the visible card edge, excluding the overlay's invisible 10px hit ring.
  await expect.poll(() => close.evaluate(button =>
    button.closest('[data-expanded-overlay-scroll]')!.getBoundingClientRect().right - button.getBoundingClientRect().right
  )).toBeLessThanOrEqual(26);
  const controls = await close.evaluate(button => ({
    height: button.getBoundingClientRect().height,
    bottom: button.getBoundingClientRect().bottom,
    topGap: button.getBoundingClientRect().top - button.closest('[data-expanded-overlay-scroll]')!.getBoundingClientRect().top,
    toolbarTop: document.querySelector('[data-camera-toolbar]')!.getBoundingClientRect().top,
  }));
  expect(controls.height).toBeGreaterThanOrEqual(44);
  expect(controls.topGap).toBeLessThanOrEqual(30);
  expect(controls.bottom).toBeLessThanOrEqual(controls.toolbarTop);
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
  const smallImageHeight = await page.locator('[data-camera-frame]').evaluate(el => el.getBoundingClientRect().height);
  // A height-only expansion changes the cap without changing the card's
  // current size, so a ResizeObserver on that card alone cannot see it.
  await page.setViewportSize({ width: 700, height: 800 });
  await expect.poll(() => page.locator('[data-camera-frame]').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThan(smallImageHeight + 100);
  await expectFitted(page, 800, 34);
});

test('queued camera uses a short status and an obvious close control', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&phase=queued');
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByText('Queued · 2', { exact: true })).toBeVisible();
  await expect(page.getByText(/Up to two|camera slot|Last image:/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close camera' })).toHaveText('');
  await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(el => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(2);
});

for (const [phase, label] of [['queued', 'Queued · 2'], ['paused', 'Paused'], ['error', 'Relay changed'], ['snapshot', 'Snapshots only']] as const) {
  test(`${phase} status is one line inside the feed, with its original image age`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 760 });
    await page.goto(`/screenshots/fixtures/camera-live.html?overlay&cached&phase=${phase}`);
    await page.getByRole('button', { name: 'Open camera' }).click();
    const frame = page.locator('[data-camera-frame]');
    const toolbar = frame.locator('[data-camera-toolbar]');
    await expect(toolbar.getByText(label, { exact: true })).toBeVisible();
    await expect(toolbar.locator('time')).toBeVisible();
    await expect(toolbar.locator('time')).toHaveText(/\d+s ago/);
    const geometry = await toolbar.evaluate(el => {
      const row = el.querySelector('[data-camera-status-row]')!;
      const frame = el.closest('[data-camera-frame]')!.getBoundingClientRect();
      const r = row.getBoundingClientRect();
      const label = row.querySelector('[data-camera-status-label]')!;
      const time = row.querySelector('time')!;
      return { inside: r.top >= frame.top && r.bottom <= frame.bottom + 1 && r.left >= frame.left && r.right <= frame.right + 1,
        overflow: row.scrollWidth - row.clientWidth,
        labelLines: label.getBoundingClientRect().height / parseFloat(getComputedStyle(label).lineHeight),
        timeLines: time.getBoundingClientRect().height / parseFloat(getComputedStyle(time).lineHeight),
        sameLine: Math.abs(label.getBoundingClientRect().top - time.getBoundingClientRect().top),
        background: getComputedStyle(el).backgroundImage };
    });
    expect(geometry.inside).toBe(true);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.labelLines).toBeLessThanOrEqual(1);
    expect(geometry.timeLines).toBeLessThanOrEqual(1);
    expect(geometry.sameLine).toBeLessThanOrEqual(1);
    expect(geometry.background).toContain('linear-gradient');

    if (phase === 'paused' || phase === 'error') {
      const resume = toolbar.getByRole('button', { name: 'Resume live view' });
      await expect(resume).toBeVisible();
      await resume.click();
      await expect(toolbar.getByText('Live · No audio', { exact: true })).toBeVisible();
    } else if (phase === 'snapshot') {
      const requests = Number(await page.locator('html').getAttribute('data-snapshot-requests'));
      await toolbar.getByRole('button', { name: 'Refresh snapshot' }).click();
      await expect.poll(async () => Number(await page.locator('html').getAttribute('data-snapshot-requests'))).toBeGreaterThan(requests);
    }
  });
}

test('a narrow portrait feed keeps status and controls on one line without spilling out', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&cached&phase=paused');
  await page.getByRole('button', { name: 'Open camera' }).click();
  const frame = page.locator('[data-camera-frame]');
  await expect(frame.getByText('Paused', { exact: true })).toBeVisible();
  await expect(frame.locator('time')).toBeHidden();
  const resume = frame.getByRole('button', { name: 'Resume live view' });
  await expect(resume).toBeVisible();
  await expect.poll(() => resume.evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
  const geometry = await resume.evaluate(button => {
    const b = button.getBoundingClientRect();
    const f = button.closest('[data-camera-frame]')!.getBoundingClientRect();
    const row = button.closest('[data-camera-status-row]')!;
    return { width: b.width, height: b.height, inside: b.left >= f.left && b.right <= f.right && b.bottom <= f.bottom,
      overflow: row.scrollWidth - row.clientWidth };
  });
  expect(geometry.width).toBeGreaterThanOrEqual(44);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
  expect(geometry.inside).toBe(true);
  expect(geometry.overflow).toBeLessThanOrEqual(1);
  await expectFitted(page, 500);
});
