/**
 * What colour the page canvas takes behind a wallpaper whose top is sky.
 *
 * parob/homecast-cloud#157: on an iPhone in Safari the bands above and below
 * the page — the status bar, the URL bar, and the scrims the wallpaper fades
 * into at both its edges — came out bright blue over a wallpaper that is
 * otherwise dark. The canvas is sampled from the wallpaper's top 5%, and on a
 * photograph of a building against the sky that strip is the sky alone.
 *
 * The bug is a colour, so the check is a colour: the canvas luminance against
 * the wallpaper's own. Measured from the reporter's screenshot, the bands were
 * luminance 169 against a page body of 90 — 1.9× as bright as what they border.
 *
 * `EDGE_COLOUR_LABEL` names the side being captured, so before and after can be
 * filed side by side from two checkouts:
 *
 *   EDGE_COLOUR_LABEL=before npx playwright test wallpaper-edge-colour.spec.ts --project=screenshots
 *
 * Captures land in the gitignored `output/`; the pair in the pull request is
 * copied into `evidence/issue-157/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.EDGE_COLOUR_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-157');

/** The reporter's device, from the context blob on the issue. */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';

test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: IPHONE_UA,
});

/** Same-origin so the sampler's canvas is not tainted, as a real upload is. */
const WALLPAPER_URL = 'http://localhost:8080/__fixture/sky-over-dark-house.png';

function luminance(colour: string): number {
  const m = colour.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) throw new Error(`not an rgb colour: ${colour}`);
  const [r, g, b] = m.map(Number);
  return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1);
}

async function openDashboard(page: Page) {
  overrideSettings({
    theme: 'dark',
    homeOrder: [HOME_ID],
    lastView: { type: 'home', homeId: HOME_ID },
  });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: {
      background: { type: 'custom', customUrl: WALLPAPER_URL, blur: 0, brightness: 50 },
    },
  });
  await page.route(WALLPAPER_URL, route =>
    route.fulfill({
      contentType: 'image/png',
      body: fs.readFileSync(path.join(HERE, 'fixtures', 'sky-over-dark-house.png')),
    }));
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  // The tint lands only once the image has decoded and been sampled.
  await page.waitForFunction(() => {
    const t = getComputedStyle(document.documentElement).getPropertyValue('--canvas-tint');
    return !!t && t.trim() !== '';
  }, undefined, { timeout: 20000 });
  await page.waitForTimeout(800);
}

test('the canvas behind a sky-topped wallpaper', async ({ page }) => {
  await openDashboard(page);

  const measured = await page.evaluate(async (url) => {
    const root = getComputedStyle(document.documentElement);
    // The wallpaper's own luminance, as displayed: the same average over the
    // whole image that the page's dark/light decision uses.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 60; c.height = 80;
    const x = c.getContext('2d')!;
    x.drawImage(img, 0, 0, 60, 80);
    const whole = x.getImageData(0, 0, 60, 80).data;
    const top = x.getImageData(0, 0, 60, 4).data;
    const mean = (d: Uint8ClampedArray) => {
      let r = 0, g = 0, b = 0; const n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
      return [r / n, g / n, b / n] as const;
    };
    const lum = ([r, g, b]: readonly number[]) => +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1);
    return {
      canvas: root.backgroundColor,
      tintVar: root.getPropertyValue('--canvas-tint').trim(),
      wallpaperWhole: lum(mean(whole)),
      wallpaperTopStrip: lum(mean(top)),
    };
  }, WALLPAPER_URL);

  const canvasLum = luminance(measured.canvas);
  const ratio = +(canvasLum / measured.wallpaperWhole).toFixed(2);

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, `${LABEL}.json`),
    JSON.stringify({ ...measured, canvasLum, wallpaperRatio: ratio }, null, 2),
  );
  await page.screenshot({ path: path.join(OUT, `${LABEL}.png`) });
  await page.screenshot({
    path: path.join(OUT, `${LABEL}-top.png`),
    clip: { x: 0, y: 0, width: 440, height: 260 },
  });

  // The end of the page, where the bottom scrim reaches the canvas colour
  // outright: this is the band iOS 26 Safari draws its URL bar over.
  await page.evaluate(() => {
    const scroller = document.scrollingElement || document.documentElement;
    scroller.scrollTop = scroller.scrollHeight;
  });
  await page.waitForTimeout(900);
  await page.screenshot({
    path: path.join(OUT, `${LABEL}-bottom.png`),
    clip: { x: 0, y: 956 - 220, width: 440, height: 220 },
  });

  // eslint-disable-next-line no-console
  console.log(`[${LABEL}]`, JSON.stringify({ ...measured, canvasLum, wallpaperRatio: ratio }));

  // The wallpaper here is a bright sky over a dark building: its top strip is
  // far brighter than the picture as a whole. That is the input condition —
  // if it stops being true the fixture has drifted and the test proves nothing.
  expect(measured.wallpaperTopStrip).toBeGreaterThan(measured.wallpaperWhole + 40);

  // What the fix is: the canvas is in the wallpaper's own register, not the
  // sky's. Not 1.0 — `SAMPLED_TINT_LIFT` still nudges the band towards white
  // so it does not read as a shadow, which lands this at about 1.33. The bar
  // is set at 1.5 so it guards the regression (the reported value was 1.9,
  // and this fixture reproduced it at 2.0) without failing on a lift that is
  // retuned by a pixel.
  expect(ratio).toBeLessThanOrEqual(1.5);
});
