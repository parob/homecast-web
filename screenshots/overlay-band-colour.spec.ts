/**
 * What colour the browser's bars take while an overlay is open.
 *
 * parob/homecast-cloud#165: on an iPhone in Safari, opening the dashboard's
 * status panel left the status-bar band and the URL-bar band at the
 * wallpaper's own brightness while the page behind them went dark. Measured
 * from the reporter's capture: both bands rgb(37,166,185) against a page of
 * rgb(22,98,108) immediately beneath them — 1.7× as bright as what they
 * border.
 *
 * iOS 26 Safari fills those bands from the page's own PLAIN paint, and past
 * the ends of a scroll-locked document that paint is the root element's
 * colour. Chromium has no such sampler and cannot draw an iOS bar, so this
 * spec does what `status-bar-under-fullscreen-dialog.spec.ts` does: it reads
 * the colour Safari WOULD fill from — the root's computed background — and
 * paints a stand-in band in it, labelled as a simulation on the capture. The
 * numbers are real; the bars are drawn.
 *
 * `BAND_LABEL` names the side being captured, so before and after can be filed
 * side by side from two checkouts:
 *
 *   BAND_LABEL=before npx playwright test overlay-band-colour.spec.ts --project=iphone-screenshots
 *
 * Captures land in the gitignored `output/`; the pair in the pull request is
 * copied into `evidence/issue-165/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.BAND_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-165');

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

/** The bands iOS 26 Safari draws over the page, on the reporter's phone. */
const STATUS_BAR = 59;
const URL_BAR = 100;

/**
 * The wallpaper whose top strip is far brighter than the picture — the one
 * built for #157 and the condition that makes this fault visible, because it
 * is what puts a bright colour on the canvas in the first place.
 */
const WALLPAPER = 'sky-over-dark-house';
const wallpaperUrl = `http://localhost:8080/__fixture/${WALLPAPER}.png`;

function luminance(colour: string): number {
  const m = colour.match(/(\d+(?:\.\d+)?)/g);
  if (!m || m.length < 3) throw new Error(`not an rgb colour: ${colour}`);
  const [r, g, b] = m.map(Number);
  return +(0.2126 * r + 0.7152 * g + 0.0722 * b).toFixed(1);
}

async function openDashboard(page: Page) {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: { background: { type: 'custom', customUrl: wallpaperUrl, blur: 0, brightness: 50 } },
  });
  await page.route(wallpaperUrl, route =>
    route.fulfill({
      contentType: 'image/png',
      body: fs.readFileSync(path.join(HERE, 'fixtures', `${WALLPAPER}.png`)),
    }));
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.waitForFunction(() => {
    const t = getComputedStyle(document.documentElement).getPropertyValue('--canvas-tint');
    return !!t && t.trim() !== '';
  }, undefined, { timeout: 20000 });
  await page.waitForTimeout(800);
}

/** The status reading the report was taken on — the temperature pill. */
async function openStatusPanel(page: Page) {
  const pill = page.locator('button[aria-expanded]').filter({ hasText: /°/ }).first();
  await expect(pill).toBeVisible({ timeout: 15000 });
  await pill.click();
  await expect(page.locator('[role="tooltip"]').first()).toBeVisible({ timeout: 10000 });
  await page.waitForTimeout(600);
}

/**
 * Two stand-in bands in the colour Safari would fill them with, plus the
 * numbers, so a reader can see the step rather than take it on trust.
 */
async function drawBandSim(page: Page, band: string, page_: string) {
  await page.evaluate(({ band, page_, STATUS_BAR, URL_BAR, bandLum, pageLum, ratio }) => {
    document.getElementById('band-sim')?.remove();
    const host = document.createElement('div');
    host.id = 'band-sim';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none';
    const strip = (where: string, h: number, text: string) => {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute', 'left:0', 'right:0', where, `height:${h}px`,
        `background:${band}`, 'display:flex', 'align-items:center',
        'justify-content:center', 'gap:10px',
        'font:600 12px system-ui,sans-serif', 'color:#fff',
        'text-shadow:0 1px 2px rgba(0,0,0,.6)',
      ].join(';');
      el.textContent = text;
      return el;
    };
    host.appendChild(strip('top:0', STATUS_BAR, `SIMULATED iOS band — ${band} (lum ${bandLum})`));
    host.appendChild(strip('bottom:0', URL_BAR, `SIMULATED iOS band — ${band} · page ${page_} (lum ${pageLum}) · ${ratio}×`));
    document.body.appendChild(host);
  }, {
    band, page_, STATUS_BAR, URL_BAR,
    bandLum: luminance(band), pageLum: luminance(page_),
    ratio: +(luminance(band) / luminance(page_)).toFixed(2),
  });
}

test.describe('The bands while the status panel is open', () => {
  test('are in the same register as the page they border', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'The bands are a phone-browser surface');

    await openDashboard(page);

    const atRest = await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);

    await openStatusPanel(page);

    const measured = await page.evaluate(() => {
      // What Safari fills the bands from: the page's own plain paint, which
      // past the ends of the document is the root element's colour.
      const band = getComputedStyle(document.documentElement).backgroundColor;
      // What the viewer actually sees — the scrimmed page, sampled through
      // the scrim's own stack rather than guessed at from a class name.
      const scrim = document.querySelector<HTMLElement>('.fixed-full-screen');
      const dim = scrim ? getComputedStyle(scrim).backgroundColor : 'rgba(0, 0, 0, 0)';
      return { band, dim };
    });

    // The page under the scrim = the wallpaper with the scrim's black over it.
    const scrimAlpha = Number(measured.dim.match(/[\d.]+\)$/)?.[0].slice(0, -1) ?? 0);
    const pageUnderScrim = (() => {
      const [r, g, b] = atRest.match(/\d+/g)!.map(Number);
      const keep = 1 - scrimAlpha;
      return `rgb(${Math.round(r * keep)}, ${Math.round(g * keep)}, ${Math.round(b * keep)})`;
    })();

    const record = {
      wallpaper: WALLPAPER,
      canvasAtRest: atRest,
      scrim: measured.dim,
      bandWhileOpen: measured.band,
      pageUnderScrim,
      bandLum: luminance(measured.band),
      pageLum: luminance(pageUnderScrim),
      ratio: +(luminance(measured.band) / luminance(pageUnderScrim)).toFixed(2),
    };

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, `status-panel-${LABEL}.json`), JSON.stringify(record, null, 2));

    await drawBandSim(page, measured.band, pageUnderScrim);
    await page.screenshot({ path: path.join(OUT, `status-panel-${LABEL}.png`) });
    await page.evaluate(() => document.getElementById('band-sim')?.remove());

    // eslint-disable-next-line no-console
    console.log(`[${LABEL}]`, JSON.stringify(record));

    // The fixture has to put a BRIGHT colour on the canvas, or there is no
    // step for the scrim to open up and this proves nothing.
    expect(luminance(atRest)).toBeGreaterThan(80);

    // The rule: the band is the page's colour, not the undimmed wallpaper's.
    // Reported at 1.7×; the bar is 1.15 to allow for rounding in the mix.
    expect(record.ratio).toBeLessThanOrEqual(1.15);
  });
});
