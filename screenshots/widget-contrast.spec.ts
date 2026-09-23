import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';

async function open(page: Page, preset: string) {
  await page.goto(`/screenshots/fixtures/widget-contrast.html?preset=${preset}`);
  await expect(page.locator('main')).toHaveAttribute('data-luminance', /\d/);
  await page.waitForTimeout(600); // The real background and ink transitions.
}

const luminance = (rgb: number[]) => rgb.map(channel => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}).reduce((sum, c, i) => sum + c * [0.2126, 0.7152, 0.0722][i], 0);

test('identical solid, gradient and image pixels produce the same brightness', async ({ page }) => {
  const values: number[] = [];
  for (const preset of ['solid-test-mid', 'gradient-test-mid', 'image-test-mid']) {
    await open(page, preset);
    values.push(Number(await page.locator('main').getAttribute('data-luminance')));
  }
  for (const value of values) expect(value).toBeCloseTo(luminance([187, 187, 187]), 3);
});

for (const [preset, backdrop] of [
  ['solid-test-mid', [187, 187, 187]],
  ['gradient-test-mid', [187, 187, 187]],
  ['image-test-mid', [187, 187, 187]],
  ['solid-blue', [59, 130, 246]],
  ['solid-green', [34, 197, 94]],
  ['solid-black', [10, 10, 10]],
] as const) {
  test(`tile names and states contrast with their painted glass on ${preset}`, async ({ page }) => {
    await open(page, preset);
    const reports = await page.locator('[data-tile]').evaluateAll(tiles => tiles.map(tile => ({
      label: tile.getAttribute('data-tile'),
      inks: ['h3', 'p'].map(selector => getComputedStyle(tile.querySelector(selector)!).color),
      fill: getComputedStyle(tile.querySelector('.backdrop-blur-xl')!).backgroundColor,
    })));
    await page.screenshot({ path: test.info().outputPath(`${preset}.png`) });
    for (const report of reports) {
      const fill = report.fill.match(/[\d.]+/g)!.map(Number);
      const alpha = fill[3] ?? 1;
      const painted = backdrop.map((channel, i) => fill[i] * alpha + channel * (1 - alpha));
      for (const colour of report.inks) {
        const ink = colour.match(/[\d.]+/g)!.map(Number);
        const inkAlpha = ink[3] ?? 1;
        const paintedInk = painted.map((c, i) => ink[i] * inkAlpha + c * (1 - inkAlpha));
        const [high, low] = [luminance(paintedInk), luminance(painted)].sort((a, b) => b - a);
        expect((high + 0.05) / (low + 0.05), `${preset} ${report.label}: ${colour} over ${report.fill}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
}

test('photo and gradient text contrasts with the pixels actually behind it', async ({ page }) => {
  for (const preset of ['gradient-ocean', 'gradient-night', 'nature-beach', 'nature-forest']) {
    await open(page, preset);
    await expect(page.getByRole('heading', { name: 'Living room light' })).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath(`${preset}.png`) });
    const labels = await page.locator('[data-tile] h3, [data-tile] p').evaluateAll(elements => elements.map(el => {
      const rect = el.getBoundingClientRect();
      const ink = getComputedStyle(el).color;
      (el as HTMLElement).style.visibility = 'hidden';
      return { text: el.textContent, ink, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    }));
    // Read the rendered glass with only the glyphs hidden. This catches wrong
    // crop, wrong region, and wrong CSS composition, independently of helpers.
    const pixels = await page.screenshot({ path: test.info().outputPath(`${preset}-glass.png`) });
    await page.locator('[data-tile] h3, [data-tile] p').evaluateAll(elements => elements.forEach(el => { (el as HTMLElement).style.visibility = ''; }));
    const metadata = await sharp(pixels).metadata();
    const scale = metadata.width! / page.viewportSize()!.width;
    for (const label of labels) {
      const region = await sharp(pixels).extract({ left: Math.round(label.x * scale), top: Math.round(label.y * scale), width: Math.floor(label.width * scale), height: Math.floor(label.height * scale) }).png().toBuffer();
      const stats = await sharp(region).stats();
      const surface = stats.channels.slice(0, 3).map(c => c.mean);
      const ink = label.ink.match(/[\d.]+/g)!.map(Number);
      const alpha = ink[3] ?? 1;
      const painted = surface.map((c, i) => ink[i] * alpha + c * (1 - alpha));
      const [high, low] = [luminance(painted), luminance(surface)].sort((a, b) => b - a);
      expect((high + 0.05) / (low + 0.05), `${preset}: ${label.text} ${label.ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test('ink updates as a tile scrolls from bright sand onto dark water', async ({ page }) => {
  await open(page, 'nature-beach&scroll=1');
  const name = page.locator('[data-tile="Off"] h3');
  await expect(name).toHaveCSS('color', 'rgb(0, 0, 0)');
  await page.evaluate(() => scrollTo(0, innerHeight * 0.6));
  await expect(name).toHaveCSS('color', 'rgb(255, 255, 255)');
});
