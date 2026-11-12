import { expect, test, type Page } from '@playwright/test';

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

/** WCAG contrast of `colour` composited over the painted glass of a tile. */
function contrastOn(colour: string, fillCss: string, backdrop: readonly number[]) {
  const fill = fillCss.match(/[\d.]+/g)!.map(Number);
  const alpha = fill[3] ?? 1;
  const painted = backdrop.map((channel, i) => fill[i] * alpha + channel * (1 - alpha));
  const ink = colour.match(/[\d.]+/g)!.map(Number);
  const inkAlpha = ink[3] ?? 1;
  const paintedInk = painted.map((c, i) => ink[i] * inkAlpha + c * (1 - inkAlpha));
  const [high, low] = [luminance(paintedInk), luminance(painted)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

/**
 * homecast-cloud#258. Off and dimmed tiles take the page's ink — white unless
 * the app calls the wallpaper light — so one screen never mixes white and black
 * names over the same wallpaper. A fully-on pale tile is still chosen by
 * contrast. This deliberately replaced #232's 4.5:1 guarantee for every tile.
 */
async function names(page: Page) {
  return Object.fromEntries(await page.locator('[data-tile]').evaluateAll(tiles => tiles.map(tile => [
    tile.getAttribute('data-tile'),
    {
      name: getComputedStyle(tile.querySelector('h3')!).color,
      state: getComputedStyle(tile.querySelector('p')!).color,
      fill: getComputedStyle(tile.querySelector('.backdrop-blur-xl')!).backgroundColor,
    },
  ]))) as Record<'Off' | 'Dimmed' | 'On', { name: string; state: string; fill: string }>;
}

const WHITE = 'rgb(255, 255, 255)';
const BLACK = 'rgb(0, 0, 0)';

for (const [preset, backdrop] of [
  ['solid-test-mid', [187, 187, 187]],
  ['gradient-test-mid', [187, 187, 187]],
  ['image-test-mid', [187, 187, 187]],
  ['solid-blue', [59, 130, 246]],
  ['solid-green', [34, 197, 94]],
  ['solid-black', [10, 10, 10]],
] as const) {
  test(`off and dimmed tiles share the page's ink on ${preset}; a lit tile keeps its contrast`, async ({ page }) => {
    await open(page, preset);
    const tiles = await names(page);
    await page.screenshot({ path: test.info().outputPath(`${preset}.png`) });
    // Every one of these the app calls dark, so the page's ink is white.
    expect(Number(await page.locator('main').getAttribute('data-luminance'))).toBeLessThan(0.8);
    expect(tiles.Off.name, `${preset} Off`).toBe(WHITE);
    expect(tiles.Dimmed.name, `${preset} Dimmed`).toBe(WHITE);
    for (const colour of [tiles.On.name, tiles.On.state]) {
      expect(contrastOn(colour, tiles.On.fill, backdrop), `${preset} On: ${colour} over ${tiles.On.fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test('off tiles go black only once the wallpaper is very light', async ({ page }) => {
  await open(page, 'solid-test-light');
  expect(Number(await page.locator('main').getAttribute('data-luminance'))).toBeGreaterThanOrEqual(0.8);
  const tiles = await names(page);
  expect(tiles.Off.name).toBe(BLACK);
  expect(tiles.Dimmed.name).toBe(BLACK);
  expect(tiles.On.name).toBe(BLACK);
});

test('photo and gradient wallpapers never mix inks across off tiles', async ({ page }) => {
  for (const preset of ['gradient-ocean', 'gradient-night', 'nature-beach', 'nature-forest']) {
    await open(page, preset);
    await expect(page.getByRole('heading', { name: 'Living room light' })).toHaveCount(3);
    await page.screenshot({ path: test.info().outputPath(`${preset}.png`) });
    const tiles = await names(page);
    expect(tiles.Dimmed.name, preset).toBe(tiles.Off.name);
  }
});

test('ink stays put as a tile scrolls from bright sand onto dark water', async ({ page }) => {
  await open(page, 'nature-beach&scroll=1');
  const name = page.locator('[data-tile="Off"] h3');
  const before = await name.evaluate(el => getComputedStyle(el).color);
  await page.evaluate(() => scrollTo(0, innerHeight * 0.6));
  await page.waitForTimeout(600);
  await expect(name).toHaveCSS('color', before);
});
