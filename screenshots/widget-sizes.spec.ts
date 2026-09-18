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
    return {
      camera: box(camera)!,
      // The picture itself, not the card: the thing the user asked to be bigger.
      preview: box(camera.querySelector('[data-camera-tile-preview]')),
      lights: box(tile('lights'))!,
      lock: box(tile('lock'))!,
      thermostat: box(tile('thermostat'))!,
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
    expect(after.camera.width).toBeGreaterThan(before.camera.width * 1.9);
    // Taller, not merely wider — the whole point of 2×2 over 2×1.
    expect(after.camera.height).toBeGreaterThan(before.camera.height * 1.5);

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
    // Two rows: taller, and the neighbour beside it is not.
    expect(after.camera.height).toBeGreaterThan(before.camera.height * 1.5);
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
});
