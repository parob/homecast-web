/** Native is the colour/framing reference. These are the real Dashboard and
 * BackgroundImage, with account/device data mocked; Safari's own glass is not
 * emulated. Compare wallpaper pixels separately from platform-specific chrome. */
import { test, expect, type Page } from '@playwright/test';
import sharp from 'sharp';
import fs from 'node:fs';
import { setupMocks, overrideSettings, overrideEntityLayouts, waitForDashboard } from './mocks';
import { HOME_ID } from './fixtures';
import { PRESET_IMAGES, PRESET_GRADIENTS } from '../src/lib/colorUtils';

const DEVICE = { viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1' };
test.use(DEVICE);
const baseline = process.env.BACKGROUND_PARITY_BASELINE === '1';
// Each test mutates module-scoped mock settings; parallelism uses isolated workers.
test.describe.configure({ mode: 'parallel' });
const examples = [
  ...Object.keys(PRESET_IMAGES).map(preset => ({ preset, brightness: 50, blur: 20 })),
  ...Object.keys(PRESET_GRADIENTS).map(preset => ({ preset, brightness: 50, blur: 10 })),
  ...['solid-black', 'solid-blue', 'solid-light-gray'].map(preset => ({ preset, brightness: 50, blur: 0 })),
  ...[20, 80].flatMap(brightness => ['nature-beach', 'nature-forest', 'gradient-lagoon'].map(preset => ({ preset, brightness, blur: 0 }))),
];

async function open(page: Page, example: typeof examples[number], native: boolean) {
  if (native) await page.addInitScript(() => {
    const messages: { action: string; color?: string }[] = [];
    Object.assign(window, { isHomecastApp: true, isHomecastIOSApp: true, homecastPlatform: 'ios', __nativeMessages: messages,
      webkit: { messageHandlers: { homecast: { postMessage: (m: { action: string; color?: string }) => messages.push(m) } } } });
  });
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({ [`home:${HOME_ID}`]: { background: { type: 'preset', presetId: example.preset, brightness: example.brightness, blur: example.blur } } });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  const layer = page.locator('.fixed-full-screen.overflow-hidden, .sticky-full-screen.overflow-hidden');
  if (PRESET_IMAGES[example.preset]) {
    // The dashboard title can precede the saved home layout. Wait for the
    // requested wallpaper, not the auto wallpaper painted during that load.
    const img = layer.locator(`img[src="${PRESET_IMAGES[example.preset]}"]`);
    await expect(img).toBeVisible();
    await img.evaluate(img => (img as HTMLImageElement).decode());
    await expect(img.locator('..')).toHaveCSS('filter', example.blur ? `blur(${example.blur}px)` : 'none');
  }
  await page.waitForTimeout(1000); // The saved layout and production crossfade.

}

async function colour(page: Page, native: boolean) {
  return page.evaluate(isNative => {
    if (isNative) {
      const messages = (window as unknown as { __nativeMessages: { action: string; color?: string }[] }).__nativeMessages;
      const colour = messages.filter(m => m.action === 'backgroundColor' && m.color).at(-1)?.color;
      if (!colour) throw new Error('Native backdrop was not set');
      const el = document.createElement('div'); el.style.color = colour; document.body.append(el);
      const rgb = getComputedStyle(el).color; el.remove(); return rgb;
    }
    return getComputedStyle(document.documentElement).getPropertyValue('--canvas-tint').trim();
  }, native);
}

async function wallpaperPixels(page: Page, native: boolean) {
  // Hide only the content for a second capture; wallpaper geometry, paint,
  // canvas and scrims are untouched. Full dashboard captures remain available.
  const layer = native ? '.fixed-full-screen' : '.sticky-full-screen';
  const style = await page.addStyleTag({ content: `body * { visibility: hidden !important; } ${layer}, ${layer} *, .sticky-top-scrim, .sticky-bottom-scrim { visibility: visible !important; }` });
  const png = await page.screenshot();
  await style.evaluate(el => el.remove());
  return png;
}

for (const example of examples) {
  test(`native wallpaper parity ${example.preset} brightness ${example.brightness}`, async ({ page, browser }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'One phone comparison per engine');
    await open(page, example, false);
    const browserColour = await colour(page, false);
    const browserBox = await page.locator('.sticky-full-screen.overflow-hidden').boundingBox();
    await page.screenshot({ path: testInfo.outputPath('browser.png') });
    const browserPixels = await wallpaperPixels(page, false);
    fs.writeFileSync(testInfo.outputPath('browser-wallpaper.png'), browserPixels);
    const context = await browser.newContext({ ...DEVICE, colorScheme: 'dark' });
    try {
      const nativePage = await context.newPage();
      await open(nativePage, example, true);
      const nativeColour = await colour(nativePage, true);
      const nativeBox = await nativePage.locator('.fixed-full-screen.overflow-hidden').boundingBox();
      await nativePage.screenshot({ path: testInfo.outputPath('native.png') });
      const nativePixels = await wallpaperPixels(nativePage, true);
      fs.writeFileSync(testInfo.outputPath('native-wallpaper.png'), nativePixels);
      // Exclude the browser's necessary edge fades. Every other pixel should
      // have native framing, colours, blur and brightness at an equal viewport.
      const region = { left: 0, top: 120, width: 440, height: 676 };
      const a = await sharp(browserPixels).extract(region).removeAlpha().raw().toBuffer();
      const b = await sharp(nativePixels).extract(region).removeAlpha().raw().toBuffer();
      const meanChannelError = a.reduce((sum, c, i) => sum + Math.abs(c - b[i]), 0) / a.length;
      const report = { ...example, browserColour, nativeColour, meanChannelError };
      fs.writeFileSync(testInfo.outputPath('comparison.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report));
      if (!baseline) {
        expect(browserColour).toBe(nativeColour);
        expect(browserBox).toEqual(nativeBox);
        // Blur near the side edges can blend into the browser canvas or the
        // native backing surface. Allow under 1% of a channel for that paint
        // difference, while guarding the old 4–16/255 framing errors.
        expect(meanChannelError).toBeLessThan(2);
      }
    } finally { await context.close(); }
  });
}

for (const viewport of [{ width: 390, height: 844 }, { width: 430, height: 932 }, { width: 844, height: 390 }, { width: 1280, height: 800 }]) {
  for (const preset of ['nature-beach', 'gradient-lagoon']) {
    test(`native framing ${preset} at ${viewport.width}x${viewport.height}`, async ({ page, browser }, testInfo) => {
      test.skip(testInfo.project.name !== 'iphone-screenshots', 'One size matrix per engine');
      const example = { preset, brightness: 50, blur: 20 };
      await page.setViewportSize(viewport);
      await open(page, example, false);
      const browserBox = await page.locator('.sticky-full-screen.overflow-hidden, .fixed-full-screen.overflow-hidden').boundingBox();
      const browserColour = await colour(page, false);
      const context = await browser.newContext({ ...DEVICE, viewport, colorScheme: 'dark' });
      try {
        const nativePage = await context.newPage();
        await open(nativePage, example, true);
        expect(browserBox).toEqual(await nativePage.locator('.fixed-full-screen.overflow-hidden').boundingBox());
        expect(browserColour).toBe(await colour(nativePage, true));
        await page.screenshot({ path: testInfo.outputPath('browser.png') });
        await nativePage.screenshot({ path: testInfo.outputPath('native.png') });
      } finally { await context.close(); }
    });
  }
}
