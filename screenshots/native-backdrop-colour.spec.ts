/**
 * The canvas tint has two consumers, and they must not be handed one answer.
 *
 * parob/homecast-cloud#161: on a dark photograph the iOS app grew a band across
 * the top that was 1.54× the luminance of the wallpaper it bordered. Nothing in
 * the app had changed — the web app's iOS 26 Safari bar work had, and the colour
 * it computes for those bars is also the colour it hands the native WKWebView as
 * its backdrop (`useCanvasTint` → `backgroundColor` postMessage →
 * `webView.scrollView.backgroundColor`).
 *
 * The two want different answers. Safari's bar is chrome sitting beside a whole
 * screen of wallpaper, so its colour takes the WHOLE picture's brightness
 * (#157 — otherwise a bright sky puts two bright bars around a dark facade). The
 * shell's backdrop is only ever seen against the wallpaper's own TOP ROWS, so it
 * takes those. On a picture whose top disagrees with its average — which is most
 * photographs — those are visibly different colours, and this spec is that
 * difference, end to end: the real dashboard, the real sampler, the real bridge.
 *
 * The app's WKWebView carries a verbatim Safari user agent (`HomecastApp.swift`),
 * so the shell is told apart by the globals it injects at document start, never
 * by the UA. This spec injects exactly those.
 *
 * Captures land in the gitignored `output/`; the pair in the pull request is
 * copied into `evidence/issue-161/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.NATIVE_BACKDROP_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-161');

/** The reporter's device, from the context blob on the issue. */
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1';

/** One device, used for both passes. */
const DEVICE = {
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent: IPHONE_UA,
} as const;

test.use(DEVICE);

/**
 * Each fixture puts the rule under a different input. `expect` is how the
 * picture's top compares with the picture as a whole, which is what decides
 * which way the two answers should differ.
 */
const WALLPAPERS = [
  { key: 'dusk-over-water', what: 'dark sky at the top, lit water at the foot', backdrop: 'darker' },
  { key: 'sky-over-dark-house', what: 'bright sky over a dark facade — the #157 case', backdrop: 'brighter' },
  { key: 'even-daylight-room', what: 'the control: top and average agree', backdrop: 'same' },
] as const;

/** Same-origin so the sampler's canvas is not tainted, as a real upload is. */
const urlFor = (key: string) => `http://localhost:8080/__fixture/${key}.png`;

function luminance(colour: string): number {
  const m = colour.startsWith('#')
    ? [1, 3, 5].map(i => parseInt(colour.slice(i, i + 2), 16))
    : (colour.match(/\d+(?:\.\d+)?/g) || []).map(Number);
  if (m.length < 3) throw new Error(`not a colour: ${colour}`);
  return +(0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]).toFixed(1);
}

/**
 * Exactly what `HomecastApp.swift` injects for the iOS shell, plus a recorder
 * on the bridge: the colour is only observable as a message, so dropping it
 * would be dropping the evidence.
 */
async function beNativeIOSApp(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isHomecastApp = true;
    w.isHomecastIOSApp = true;
    w.isHomeKitLocalCapable = true;
    w.homecastPlatform = 'ios';
    w.homecastNativeHeaderAvailable = true;
    w.homecastNativeHeaderEnabled = false;
    const sent: unknown[] = [];
    (w as { __nativeMessages?: unknown[] }).__nativeMessages = sent;
    w.webkit = { messageHandlers: { homecast: { postMessage: (m: unknown) => { sent.push(m); } } } };
  });
}

async function openDashboard(page: Page, key: string, native: boolean) {
  const url = urlFor(key);
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: { background: { type: 'custom', customUrl: url, blur: 0, brightness: 50 } },
  });
  await page.route(url, route =>
    route.fulfill({ contentType: 'image/png', body: fs.readFileSync(path.join(HERE, 'fixtures', `${key}.png`)) }));
  if (native) await beNativeIOSApp(page);
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  // The colour lands only once the image has decoded and been sampled. In a
  // browser that shows up as `--canvas-tint`; in the shell, as a message.
  await page.waitForFunction(() => {
    const w = window as unknown as { __nativeMessages?: Array<{ action?: string; color?: string }> };
    if (w.__nativeMessages) return w.__nativeMessages.some(m => m.action === 'backgroundColor' && m.color);
    const t = getComputedStyle(document.documentElement).getPropertyValue('--canvas-tint');
    return !!t && t.trim() !== '';
  }, undefined, { timeout: 20000 });
  await page.waitForTimeout(800);
}

/** The colour this shell actually ended up with, however it was delivered. */
async function resolvedColour(page: Page, native: boolean): Promise<string> {
  return page.evaluate((isNative) => {
    if (isNative) {
      const w = window as unknown as { __nativeMessages?: Array<{ action?: string; color?: string }> };
      const sent = (w.__nativeMessages ?? []).filter(m => m.action === 'backgroundColor' && m.color);
      if (!sent.length) throw new Error('the shell was never handed a backdrop colour');
      return sent[sent.length - 1].color!;
    }
    return getComputedStyle(document.documentElement).getPropertyValue('--canvas-tint').trim();
  }, native);
}

for (const wallpaper of WALLPAPERS) {
  test(`the shell's backdrop and the browser's bars behind ${wallpaper.key}`, async ({ page, browser }) => {
    await openDashboard(page, wallpaper.key, true);
    const backdrop = await resolvedColour(page, true);
    // The page never paints the canvas in a shell — the WKWebView does.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--canvas-tint').trim())).toBe('');

    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({
      path: path.join(OUT, `${wallpaper.key}-${LABEL}-native-top.png`),
      clip: { x: 0, y: 0, width: 440, height: 300 },
    });

    // A fresh context for the browser pass: `addInitScript` is registered on
    // the page for its lifetime, so re-visiting in the same one would still be
    // a native shell and the comparison would be between two identical runs.
    const browserContext = await browser.newContext({ ...DEVICE, colorScheme: 'dark' });
    const browserPage = await browserContext.newPage();
    await openDashboard(browserPage, wallpaper.key, false);
    const bars = await resolvedColour(browserPage, false);
    await browserContext.close();

    const record = { wallpaper: wallpaper.key, backdrop, backdropLum: luminance(backdrop), bars, barsLum: luminance(bars) };
    fs.writeFileSync(path.join(OUT, `${wallpaper.key}-${LABEL}.json`), JSON.stringify(record, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[${LABEL}]`, JSON.stringify(record));

    // The rule, stated as the difference between the two answers rather than as
    // absolute numbers, so retuning either one does not make this spec lie.
    const ratio = record.backdropLum / record.barsLum;
    if (wallpaper.backdrop === 'darker') {
      // The regression was exactly this ratio going to 1: the shell was being
      // handed the bars' answer. Reported at 4.3× too bright.
      expect(ratio).toBeLessThan(0.7);
    } else if (wallpaper.backdrop === 'brighter') {
      expect(ratio).toBeGreaterThan(1.3);
    } else {
      // Where the picture's top and its average agree, so do the two answers —
      // give or take the bars' lift towards white.
      expect(ratio).toBeGreaterThan(0.8);
      expect(ratio).toBeLessThan(1.2);
    }
  });
}
