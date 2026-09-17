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

// #153: a phone held sideways. The frame takes its width from the leftover
// height, and the card's chrome had eaten most of it, so the live view came out
// 212x119 inside a 944px card — a stamp in an empty band. The card now lays its
// chrome ON the image and gives the image the whole card.
for (const [route, inset] of [['from the tab bar', 141], ['from a dashboard tile', 0]] as const) {
  test(`a phone held sideways gives the camera the whole card, ${route}`, async ({ page }) => {
    await page.setViewportSize({ width: 956, height: 440 });
    await page.goto(`/screenshots/fixtures/camera-live.html?overlay&landscape&inset=${inset}`);
    await page.getByRole('button', { name: 'Open camera' }).click();
    await expect(page.getByAltText('Front Door live view')).toBeVisible();
    await expectFitted(page, 440, inset);

    // The image IS the card — no band of card around it in either direction.
    await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(card => {
      const frame = card.querySelector('[data-camera-frame]')!.getBoundingClientRect();
      const c = card.getBoundingClientRect();
      return Math.round(Math.max(c.width - frame.width, c.height - frame.height));
    })).toBeLessThanOrEqual(2);

    // ...and it is worth looking at. Before this it was 119px tall.
    await expect.poll(() => page.locator('[data-camera-frame]').evaluate(frame =>
      Math.round(frame.getBoundingClientRect().height))).toBeGreaterThan(240);

    // The chrome rides on the image rather than above it, and the name does not
    // land on the status line at the bottom.
    const chrome = await page.locator('[data-expanded-overlay-scroll]').evaluate(card => {
      const frame = card.querySelector('[data-camera-frame]')!.getBoundingClientRect();
      const name = card.querySelector('h3')!.getBoundingClientRect();
      const close = card.querySelector('[aria-label="Close camera"]')!.getBoundingClientRect();
      const status = card.querySelector('[data-camera-status-row]')!.getBoundingClientRect();
      const inside = (r: DOMRect) => r.top >= frame.top - 1 && r.bottom <= frame.bottom + 1
        && r.left >= frame.left - 1 && r.right <= frame.right + 1;
      return { nameInside: inside(name), closeInside: inside(close), clear: status.top - name.bottom };
    });
    expect(chrome.nameInside).toBe(true);
    expect(chrome.closeInside).toBe(true);
    expect(chrome.clear).toBeGreaterThan(0);

    // The accessory's type disc is not drawn on top of its own live picture.
    await expect(page.locator('[data-expanded-overlay-scroll] svg.lucide-video')).toHaveCount(0);
  });
}

test('turning the phone back upright returns the stacked card', async ({ page }) => {
  await page.setViewportSize({ width: 956, height: 440 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&landscape');
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByAltText('Front Door live view')).toBeVisible();
  // Immersive: no type disc, image is the card.
  await expect(page.locator('[data-expanded-overlay-scroll] svg.lucide-video')).toHaveCount(0);
  await page.setViewportSize({ width: 440, height: 956 });
  // Upright there is height to spend, so the header comes back above the image
  // rather than sitting on it.
  await expect(page.locator('[data-expanded-overlay-scroll] svg.lucide-video')).toHaveCount(1);
  await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(card => {
    const frame = card.querySelector('[data-camera-frame]')!.getBoundingClientRect();
    return Math.round(card.getBoundingClientRect().height - frame.height);
  })).toBeGreaterThan(80);
  await expectFitted(page, 956);
});

test('a long name settles rather than hunting, and keeps the close control in its corner', async ({ page }) => {
  // The stacked card sizes itself to the image, so a wrapped name could shrink
  // the height budget, which narrows the card, which wraps the name further.
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&landscape');
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByAltText('Front Door live view')).toBeVisible();
  await page.evaluate(() => {
    const name = [...document.querySelectorAll('[data-expanded-overlay-scroll] *')]
      .find(node => node.textContent?.trim() === 'Front Door' && node.children.length === 0);
    if (name) name.textContent = 'Back Garden Side Entrance Doorbell Camera Number Four';
  });
  const widths: number[] = [];
  for (let i = 0; i < 8; i++) {
    await page.waitForTimeout(150);
    widths.push(await page.locator('[data-expanded-overlay-scroll]').evaluate(card => Math.round(card.getBoundingClientRect().width)));
  }
  expect(new Set(widths.slice(-4)).size).toBe(1);
  await expect.poll(() => page.getByRole('button', { name: 'Close camera' }).evaluate(button =>
    button.getBoundingClientRect().top - button.closest('[data-expanded-overlay-scroll]')!.getBoundingClientRect().top
  )).toBeLessThanOrEqual(30);
  // Still no band: the stacked card is sized to the image it can show.
  await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(card => {
    const frame = card.querySelector('[data-camera-frame]')!.getBoundingClientRect();
    return Math.round(card.getBoundingClientRect().width - frame.width);
  })).toBeLessThanOrEqual(42);
});

test('a tall window still gives the camera the full-width card', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/screenshots/fixtures/camera-live.html?overlay&landscape');
  await page.getByRole('button', { name: 'Open camera' }).click();
  await expect(page.getByAltText('Front Door live view')).toBeVisible();
  // Height is no longer the binding constraint, so the card keeps its preferred
  // 960 and the image fills it — neither shrinking nor going immersive.
  await expect.poll(() => page.locator('[data-expanded-overlay-scroll]').evaluate(card =>
    Math.round(card.getBoundingClientRect().width))).toBe(960);
  await expect.poll(() => page.locator('[data-camera-frame]').evaluate(frame =>
    Math.round(frame.getBoundingClientRect().width))).toBe(920);
  await expect(page.locator('[data-expanded-overlay-scroll] svg.lucide-video')).toHaveCount(1);
});
