import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const evidence = (name: string) => path.join(__dirname, 'evidence', 'issue-154', name);


/**
 * A resized camera tile has to do two separate things, and the second is the
 * one that actually breaks: claim a bigger grid area, AND fill it with a
 * bigger picture. A tile can reserve 2×2 and keep drawing the same small card
 * in the corner of it — which is what `h-fit` on the wrapper did, and what a
 * pure "does it span" assertion would have let through.
 */
async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const box = (el: Element | null) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { width: r.width, height: r.height, area: r.width * r.height, left: r.left, top: r.top };
    };
    const tile = (name: string) => document.querySelector(`[data-tile="${name}"]`);
    const camera = tile('camera')!;
    // The radius of the surface actually painted — the blur layer, which is
    // what you see. The Card above it is `!bg-transparent`.
    const radius = (el: Element) => {
      const glass = el.querySelector('.backdrop-blur-xl') ?? el;
      return getComputedStyle(glass).borderTopLeftRadius;
    };
    return {
      camera: box(camera)!,
      // The picture itself, not the card: the thing the user asked to be bigger.
      preview: box(camera.querySelector('[data-camera-tile-preview]')),
      lights: box(tile('lights'))!,
      lock: box(tile('lock'))!,
      thermostat: box(tile('thermostat'))!,
      cameraRadius: radius(camera),
      lightsRadius: radius(tile('lights')!),
      gap: parseFloat(getComputedStyle(document.querySelector('[data-size-grid]')!).rowGap),
    };
  });
}

test.describe('camera tile sizes', () => {
  test('Large claims four cells and fills them with a bigger picture', async ({ page }) => {
    await page.goto('/screenshots/fixtures/widget-sizes.html?size=regular');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
    const before = await measure(page);
    await page.locator('[data-size-grid]').screenshot({ path: evidence('widget-size-regular.png') });

    await page.goto('/screenshots/fixtures/widget-sizes.html?size=large');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
    const after = await measure(page);
    await page.locator('[data-size-grid]').screenshot({ path: evidence('widget-size-large.png') });

    // Two columns of a two-column grid, so full width plus the gap.
    expect(after.camera.width).toBeCloseTo(before.camera.width * 2 + after.gap, 0);
    // EXACTLY two ordinary tiles tall, gap included — not "bigger", and not an
    // aspect ratio that happens to land near it at this one column width.
    expect(after.camera.height).toBeCloseTo(after.lights.height * 2 + after.gap, 0);

    // The picture grew with the tile. This is the assertion that fails if the
    // card reserves the area and does not stretch into it.
    expect(after.preview).not.toBeNull();
    expect(after.preview!.area).toBeGreaterThan(before.preview!.area * 3);
    // And it really is filling the card, not floating in a corner of it.
    expect(after.preview!.height).toBeGreaterThan(after.camera.height * 0.8);

    // The tiles that were not resized are untouched.
    expect(after.lights.width).toBeCloseTo(before.lights.width, 0);
    expect(after.lights.height).toBeCloseTo(before.lights.height, 0);
  });

  test('Tall keeps one column and takes two rows', async ({ page }) => {
    await page.goto('/screenshots/fixtures/widget-sizes.html?size=regular&portrait=1');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
    const before = await measure(page);
    await page.locator('[data-size-grid]').screenshot({ path: evidence('widget-size-regular-portrait.png') });

    await page.goto('/screenshots/fixtures/widget-sizes.html?size=tall&portrait=1');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
    const after = await measure(page);
    await page.locator('[data-size-grid]').screenshot({ path: evidence('widget-size-tall.png') });

    // One column: the same width it always had.
    expect(after.camera.width).toBeCloseTo(before.camera.width, 0);
    // Exactly two ordinary tiles tall, gap included.
    expect(after.camera.height).toBeCloseTo(after.lights.height * 2 + after.gap, 0);
    expect(after.lights.height).toBeCloseTo(before.lights.height, 0);

    expect(after.preview!.area).toBeGreaterThan(before.preview!.area * 1.5);
    expect(after.preview!.height).toBeGreaterThan(after.camera.height * 0.8);
  });

  test('a Regular tile renders exactly as it did before sizes existed', async ({ page }) => {
    // The guard on the blast radius. Every grid in the app runs this path, and
    // a size feature that shifts untouched tiles by a pixel is a regression
    // dressed as a feature.
    await page.goto('/screenshots/fixtures/widget-sizes.html?size=regular');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
    const m = await measure(page);

    // All four tiles are one column, in two rows of two.
    expect(m.camera.width).toBeCloseTo(m.lights.width, 0);
    expect(m.camera.top).toBeCloseTo(m.lights.top, 0);
    expect(m.lock.top).toBeGreaterThan(m.camera.top);
    expect(m.lock.left).toBeCloseTo(m.camera.left, 0);
    expect(m.thermostat.left).toBeCloseTo(m.lights.left, 0);

    // No span style is emitted at all for a regular tile.
    const style = await page.getAttribute('[data-tile="camera"]', 'style');
    expect(style ?? '').not.toContain('grid-column');
  });

  test('the desktop context menu offers all three sizes with the current one marked', async ({ page }) => {
    // Question 1 on the issue was where the control goes, given EditActions
    // has no room for a third badge. This is the desktop half of the answer;
    // the touch half is the round Size button in the expanded action cluster,
    // which cycles.
    await page.goto('/screenshots/fixtures/widget-sizes.html?size=large');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
    await page.locator('[data-tile="camera"]').click({ button: 'right', position: { x: 40, y: 40 } });

    const menu = page.locator('[role="menu"]');
    await expect(menu).toBeVisible();
    await expect(menu.getByText('Regular', { exact: true })).toBeVisible();
    await expect(menu.getByText('Large', { exact: true })).toBeVisible();
    await expect(menu.getByText('Tall', { exact: true })).toBeVisible();
    await page.screenshot({ path: evidence('widget-size-menu.png'), clip: { x: 0, y: 0, width: 640, height: 560 } });
  });

  test('a sized tile keeps the same corner radius as every other widget', async ({ page }) => {
    // Asked for on review, on the reading that the Large tile looked rounder.
    // It measures identical — 28px on every painted layer of both — and the
    // pixels agree: walking down the left edge of each tile's top-left corner
    // gives the same inset curve to within one pixel of antialiasing. A dark
    // tile's corners simply read rounder than a pale one's at the same radius.
    // Guarding it so a future change to the sized path cannot drift it.
    for (const q of ['size=regular', 'size=large', 'size=tall&portrait=1']) {
      await page.goto(`/screenshots/fixtures/widget-sizes.html?${q}`);
      await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();
      const m = await measure(page);
      expect(m.cameraRadius, q).toBe(m.lightsRadius);
    }
  });

  test('Edit Layout carries a resize badge beside Hide and Pin, and it is properly tappable', async ({ page }) => {
    // Asked for on review: "you can fit the expand/collapse button on the tile
    // next to hide and pin — just have a small circle with the expand and
    // contract icons in the top right next to the other bubbles". I had argued
    // a third badge would not fit; a circle does, which is why this one is a
    // glyph where every other badge is a word.
    await page.goto('/screenshots/fixtures/widget-sizes.html?size=regular&edit=1');
    await expect(page.locator('[data-camera-tile-preview] img')).toBeVisible();

    const camera = page.locator('[data-tile="camera"]');
    const resize = camera.getByRole('button', { name: /^Resize/ });
    await expect(resize).toBeVisible();
    // Next to Hide, not instead of it.
    await expect(camera.getByRole('button', { name: /Hide/ })).toBeVisible();

    const m = await page.evaluate(() => {
      const tile = document.querySelector('[data-tile="camera"]')!;
      const btn = (re: RegExp) => [...tile.querySelectorAll('button')]
        .find(b => re.test(b.getAttribute('aria-label') ?? ''))!;
      const r = btn(/^Resize/), h = btn(/Hide/);
      const box = (el: Element) => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
      return { resize: box(r), hide: box(h), cameraTop: tile.getBoundingClientRect().top };
    });

    // A circle: square, and the same height as the word badges beside it, or the
    // cluster looks ragged.
    expect(m.resize.w).toBeCloseTo(m.resize.h, 0);
    expect(m.resize.h).toBeCloseTo(m.hide.h, 0);
    // Top-right corner, on the same line as Hide, and to its left so Hide and
    // Pin do not move from where muscle memory puts them.
    expect(m.resize.y).toBeCloseTo(m.hide.y, 0);
    expect(m.resize.x).toBeLessThan(m.hide.x);
    // Same hit-slop contract `edit-badge-hit-target.spec.ts` holds the others
    // to: the paint is small, the target must not be.
    const slop = await page.evaluate(() => {
      const tile = document.querySelector('[data-tile="camera"]')!;
      const btn = [...tile.querySelectorAll('button')]
        .find(b => /^Resize/.test(b.getAttribute('aria-label') ?? ''))!;
      const paint = btn.getBoundingClientRect();
      const before = getComputedStyle(btn, '::before');
      return { paint: { w: paint.width, h: paint.height }, insetY: before.top, content: before.content };
    });
    expect(slop.content).not.toBe('none');   // the pseudo-element target exists

    await page.locator('[data-size-grid]').screenshot({ path: evidence('widget-size-edit-badges.png') });
  });
});
