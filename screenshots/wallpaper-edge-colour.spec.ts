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

/**
 * Three pictures, so the rule is shown working rather than asserted on one.
 * See `fixtures/make-wallpapers.mjs` for what each is built to be.
 */
const WALLPAPERS = [
  {
    key: 'sky-over-dark-house',
    what: 'the reported fault — bright sky over a dark facade',
    // The edge is far brighter than the picture; the band must come down.
    expect: 'edge-brighter-than-picture',
  },
  {
    key: 'even-daylight-room',
    what: 'the control — an evenly lit room, edge and average agree',
    expect: 'edge-matches-picture',
  },
  {
    key: 'dusk-over-water',
    what: 'the awkward one — dark sky at the top, lit water at the foot',
    expect: 'edge-darker-than-picture',
  },
] as const;

/** Same-origin so the sampler's canvas is not tainted, as a real upload is. */
const urlFor = (key: string) => `http://localhost:8080/__fixture/${key}.png`;

function luminance(colour: string): number {
  const m = colour.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) throw new Error(`not an rgb colour: ${colour}`);
  const [r, g, b] = m.map(Number);
  return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1);
}

async function openDashboard(page: Page, key: string) {
  const url = urlFor(key);
  overrideSettings({
    theme: 'dark',
    homeOrder: [HOME_ID],
    lastView: { type: 'home', homeId: HOME_ID },
  });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: {
      background: { type: 'custom', customUrl: url, blur: 0, brightness: 50 },
    },
  });
  await page.route(url, route =>
    route.fulfill({
      contentType: 'image/png',
      body: fs.readFileSync(path.join(HERE, 'fixtures', `${key}.png`)),
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

for (const wallpaper of WALLPAPERS) {
  test(`the canvas behind ${wallpaper.key}`, async ({ page }) => {
    await openDashboard(page, wallpaper.key);

    const measured = await page.evaluate(async (url) => {
      const root = getComputedStyle(document.documentElement);
      // The wallpaper's own luminance: the same whole-image average the
      // page's dark/light decision already runs on.
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = 60; c.height = 80;
      const x = c.getContext('2d')!;
      x.drawImage(img, 0, 0, 60, 80);
      const region = (y: number, h: number) => x.getImageData(0, y, 60, h).data;
      const mean = (d: Uint8ClampedArray) => {
        let r = 0, g = 0, b = 0; const n = d.length / 4;
        for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
        return [r / n, g / n, b / n] as const;
      };
      const lum = ([r, g, b]: readonly number[]) => +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1);
      return {
        canvas: root.backgroundColor,
        wallpaperWhole: lum(mean(region(0, 80))),
        wallpaperTopStrip: lum(mean(region(0, 4))),
        wallpaperBottomStrip: lum(mean(region(76, 4))),
      };
    }, urlFor(wallpaper.key));

    const canvasLum = luminance(measured.canvas);
    const ratio = +(canvasLum / measured.wallpaperWhole).toFixed(2);
    const record = { wallpaper: wallpaper.key, ...measured, canvasLum, wallpaperRatio: ratio };

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `${wallpaper.key}-${LABEL}.json`), JSON.stringify(record, null, 2));
    await page.screenshot({
      path: path.join(OUT, `${wallpaper.key}-${LABEL}-top.png`),
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
      path: path.join(OUT, `${wallpaper.key}-${LABEL}-bottom.png`),
      clip: { x: 0, y: 956 - 220, width: 440, height: 220 },
    });

    // eslint-disable-next-line no-console
    console.log(`[${LABEL}]`, JSON.stringify(record));

    // Each fixture exists to put the rule under a different input. Assert the
    // input first: if a fixture drifts, the test below proves nothing.
    if (wallpaper.expect === 'edge-brighter-than-picture') {
      expect(measured.wallpaperTopStrip).toBeGreaterThan(measured.wallpaperWhole + 40);
    } else if (wallpaper.expect === 'edge-darker-than-picture') {
      expect(measured.wallpaperTopStrip).toBeLessThan(measured.wallpaperWhole - 20);
    } else {
      expect(Math.abs(measured.wallpaperTopStrip - measured.wallpaperWhole)).toBeLessThan(20);
    }

    // And the rule itself, the same for all three: the band is in the
    // picture's register, whatever its edge happens to be. Not 1.0 —
    // `SAMPLED_TINT_LIFT` still nudges it towards white so it does not read as
    // a shadow, which lands these around 1.2-1.4. The bar is 1.5 either side,
    // so it guards the regression (reported at 1.9, reproduced at 2.0)
    // without failing on a lift retuned by a pixel.
    expect(ratio).toBeLessThanOrEqual(1.5);
    expect(ratio).toBeGreaterThanOrEqual(0.67);
  });
}
