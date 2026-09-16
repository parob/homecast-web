import { test, expect } from '@playwright/test';

test('camera previews use normal tile height and never overlap labels, age or controls', async ({ page }) => {
  for (const compact of [true, false]) {
    await page.goto(`/screenshots/fixtures/camera-tile-layout.html?compact=${compact ? 1 : 0}`);
    await expect(page.locator('[data-layout-tile] h3')).toHaveCount(3);
    for (const fontSize of [16, 20]) {
      for (const width of [150, 240]) {
        await page.evaluate(({ fontSize, width }) => {
          document.documentElement.style.fontSize = `${fontSize}px`;
          document.documentElement.style.setProperty('--tile-width', `${width}px`);
        }, { fontSize, width });
        const geometry = await page.evaluate(() => [...document.querySelectorAll('[data-layout-tile]')].map(tile => {
          const box = (el: Element) => {
            const r = el.getBoundingClientRect();
            return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
          };
          const caption = tile.querySelector('[data-camera-tile-caption]');
          const control = tile.querySelector('button');
          return { tile: box(tile), title: box(tile.querySelector('h3')!), status: box(tile.querySelector('p')!),
            caption: caption && box(caption), control: control && box(control) };
        }));
        const overlaps = (a: typeof geometry[number]['title'], b: typeof a) =>
          a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        for (const tile of geometry.slice(1)) {
          expect(tile.tile.height, `compact=${compact}, font=${fontSize}, width=${width}`).toBeCloseTo(geometry[0].tile.height, 0);
          expect(tile.caption).not.toBeNull();
          expect(overlaps(tile.caption!, tile.title)).toBe(false);
          expect(overlaps(tile.caption!, tile.status)).toBe(false);
          expect(tile.status.top).toBeGreaterThanOrEqual(tile.title.bottom);
          expect(tile.caption!.bottom).toBeLessThanOrEqual(tile.tile.bottom);
          if (tile.control) expect(overlaps(tile.caption!, tile.control)).toBe(false);
        }
      }
    }
  }
});
