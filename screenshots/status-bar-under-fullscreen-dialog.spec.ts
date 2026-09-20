/**
 * Who owns the strip under the iOS status bar.
 *
 * parob/homecast-cloud#155: on an iPhone home-screen web app, opening the
 * automation editor made the status bar (clock, signal, battery) vanish.
 *
 * In a standalone web app the page is drawn UNDER the status bar — that is
 * what `env(safe-area-inset-top)` is for — and iOS draws only the glyphs, in
 * whichever of black or white contrasts with `meta[name=theme-color]`. So the
 * page makes two separate statements about the top of the screen: the colour
 * it paints there, and the colour it declares. When those disagree, iOS picks
 * glyphs for the declaration and draws them over the paint, and the two cancel.
 *
 * The app shells and the phone browser each have an answer already — the
 * native bar keys off `coverAppearance`, and iOS Safari samples the page's own
 * top paint, which the dialog covers. A home-screen web app has neither, and
 * `useCanvasTint` skips the meta there, so `theme-color` never moves off the
 * `#333333` index.html ships. This is that mode.
 *
 * This is geometry and painted pixels, so it needs a browser; jsdom lays
 * nothing out and `elementFromPoint` would answer nothing. Chromium cannot draw
 * an iOS status bar, so `drawStatusBarSim` puts one in the page in the colour
 * iOS would choose from the declaration — a simulation, and labelled as one on
 * the captures. The assertions do not depend on it.
 *
 *   npx playwright test status-bar-under-fullscreen-dialog.spec.ts --project=iphone-screenshots
 *
 * Captures land in the gitignored `output/status-bar/`; the pair that ends up
 * in the pull request is copied into `evidence/issue-155/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts, overrideSettings, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.STATUS_BAR_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'status-bar');

/** The device the report came from — an iPhone 16 Pro Max, per its context blob. */
test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
});

/** The inset an iPhone 16 Pro Max reports in portrait. Chromium reports none. */
const SAFE_AREA_TOP = 59;

function luminance(rgb: string): number {
  const [r, g, b] = (rgb.match(/[\d.]+/g) ?? ['255', '255', '255']).map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** What iOS would draw the glyphs in, given a declared theme colour. */
function glyphColour(declared: string): 'white' | 'black' {
  return luminance(declared) < 0.5 ? 'white' : 'black';
}

/** The colour `meta[name=theme-color]` currently declares, as rgb(). */
async function declaredThemeColour(page: Page): Promise<string> {
  return page.evaluate(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    const probe = document.createElement('div');
    probe.style.color = meta?.content || 'rgb(255, 255, 255)';
    document.body.appendChild(probe);
    const resolved = getComputedStyle(probe).color;
    probe.remove();
    return resolved;
  });
}

/**
 * The colour actually painted where the glyphs land — measured in pixels.
 *
 * Not computed style: the wallpaper is a fixed layer and a sibling of the
 * content, so no ancestor of the element at that point carries its colour.
 * Walking the DOM answers `bg-background` (white) on a black wallpaper. The
 * page is screenshotted and the strip averaged instead, which is what a viewer
 * actually sees. The band avoids the corners, where the glyphs sit.
 */
async function paintedUnderStatusBar(page: Page): Promise<string> {
  const shot = await page.screenshot({ clip: { x: 150, y: 0, width: 140, height: 12 } });
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < data.length; i += 4) { r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = data.length / 4;
    return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
  }, `data:image/png;base64,${shot.toString('base64')}`);
}

/** A stand-in for the glyphs iOS draws, in the colour the declaration implies. */
async function drawStatusBarSim(page: Page, inset: number) {
  await page.evaluate(({ inset, declared }) => {
    document.getElementById('ios-status-bar-sim')?.remove();
    const lum = (() => {
      const [r, g, b] = (declared.match(/[\d.]+/g) ?? [255, 255, 255]).map(Number);
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    })();
    const bar = document.createElement('div');
    bar.id = 'ios-status-bar-sim';
    bar.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', `height:${inset}px`,
      'display:flex', 'align-items:center', 'justify-content:space-between',
      'padding:0 30px 0 34px', 'font:600 17px system-ui,sans-serif',
      `color:${lum < 0.5 ? '#ffffff' : '#000000'}`,
      'z-index:2147483647', 'pointer-events:none',
    ].join(';');
    bar.innerHTML = '<span>9:41</span><span style="letter-spacing:2px">▮▮▮ ᯤ ▰</span>';
    document.body.appendChild(bar);
  }, { inset, declared: await declaredThemeColour(page) });
}

async function openStandaloneDashboard(page: Page) {
  // A dark wallpaper, as the reporter has: it is what makes white glyphs the
  // right choice everywhere else, and so what the editor then contradicts.
  overrideSettings({ homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: 'solid-black', brightness: 50 } },
  });
  await setupMocks(page);
  // `navigator.standalone` is what the app reads to know the page owns the
  // safe areas; Chromium has no such mode, so it is declared before boot.
  await page.addInitScript(() => {
    Object.defineProperty(window.navigator, 'standalone', { value: true, configurable: true });
  });
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.addStyleTag({
    content: `:root{--safe-area-top:${SAFE_AREA_TOP}px;--safe-area-bottom:34px;}`,
  });
  await page.waitForTimeout(400);
}

async function openEditor(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Automations', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Automations', exact: true })).toBeVisible();
  await page.getByText('Motion Light - Living Room', { exact: true }).click();
  await expect(page.getByTestId('automation-editor')).toBeVisible();
  await page.waitForTimeout(600);
}

async function capture(page: Page, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await drawStatusBarSim(page, SAFE_AREA_TOP);
  await page.screenshot({
    path: path.join(OUT, `${name}-${LABEL}.png`),
    clip: { x: 0, y: 0, width: 440, height: 320 },
  });
  await page.evaluate(() => document.getElementById('ios-status-bar-sim')?.remove());
}

test.describe('Status bar under a full-screen dialog', () => {
  test('the dashboard declares the colour it paints under the status bar', async ({ page }) => {
    await openStandaloneDashboard(page);
    const declared = await declaredThemeColour(page);
    const painted = await paintedUnderStatusBar(page);
    await capture(page, 'dashboard');
    expect(
      Math.abs(luminance(declared) - luminance(painted)),
      `declared ${declared} (glyphs ${glyphColour(declared)}) over painted ${painted}`,
    ).toBeLessThan(0.4);
  });

  test('the automation editor declares the colour it paints under the status bar', async ({ page }) => {
    await openStandaloneDashboard(page);
    await openEditor(page);
    const declared = await declaredThemeColour(page);
    const painted = await paintedUnderStatusBar(page);
    await capture(page, 'editor');
    expect(
      Math.abs(luminance(declared) - luminance(painted)),
      `declared ${declared} (glyphs ${glyphColour(declared)}) over painted ${painted}`,
    ).toBeLessThan(0.4);
  });

  test('closing the editor hands the declaration back', async ({ page }) => {
    await openStandaloneDashboard(page);
    const onDashboard = await declaredThemeColour(page);
    await openEditor(page);
    await page.getByTestId('close-editor-button').click();
    await expect(page.getByTestId('automation-editor')).not.toBeVisible();
    await page.waitForTimeout(400);
    expect(await declaredThemeColour(page)).toBe(onDashboard);
  });
});
