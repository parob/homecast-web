/**
 * What is on screen while a wallpaper that is slow, rather than broken, loads.
 *
 * parob/homecast-web#225: BackgroundImage's 2s deadline ran the crossfade as
 * well as reporting readiness. The incoming layer's <img> is still opacity-0 at
 * that point, so the deadline revealed nothing — the app dropped a wallpaper
 * that was on screen for one that was not, and sat on bare bg-background until
 * the image finally arrived.
 *
 * Driven through /bgdemo, which mounts the real BackgroundImage, the real
 * useBackgroundDarkness and the real WidgetWrapper. "⇄ switch room" changes the
 * wallpaper on the already-mounted component, which is the crossfade path the
 * bug lives on; a replay would remount it and take the cold-start path instead.
 *
 * The incoming image is held for SLOW_MS by a route interception, so the
 * deadline is genuinely outrun rather than raced.
 *
 * Label the run so two checkouts can be filed side by side:
 *
 *   SLOW_SWAP_LABEL=before npx playwright test background-slow-swap.spec.ts --project=screenshots
 *
 * Captures land in the gitignored `output/`; the pair in the pull request is
 * copied into `evidence/issue-225/`.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.SLOW_SWAP_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-225');

/** How long the incoming wallpaper is held. Comfortably past the 2s deadline. */
const SLOW_MS = 6_000;
/** When frames are taken, relative to the switch. */
const FRAMES_MS = [500, 1_000, 2_200, 3_500, 6_400];

test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
});

test('a slow wallpaper swap holds the outgoing wallpaper', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto('/bgdemo');

  // Let the first wallpaper decode and paint before anything is slowed down.
  const firstImg = page.locator('[aria-hidden="true"] img').first();
  await firstImg.waitFor({ state: 'attached' });
  await page.waitForFunction(() => {
    const i = document.querySelector('[aria-hidden="true"] img') as HTMLImageElement | null;
    return !!i && i.complete && i.naturalHeight > 0;
  });
  const firstSrc = await firstImg.getAttribute('src');
  expect(firstSrc).toBeTruthy();
  await page.waitForTimeout(800); // let the 500ms fade settle

  // Everything except the wallpaper already on screen now arrives slowly.
  await page.route('**/backgrounds/**', async route => {
    if (route.request().url() === firstSrc) return route.continue();
    await new Promise(r => setTimeout(r, SLOW_MS));
    await route.continue();
  });

  await page.getByRole('button', { name: /switch room/ }).click();
  const switchedAt = Date.now();

  const shots: string[] = [];
  for (const at of FRAMES_MS) {
    const wait = at - (Date.now() - switchedAt);
    if (wait > 0) await page.waitForTimeout(wait);
    const file = path.join(OUT, `${LABEL}-${String(at).padStart(4, '0')}ms.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  }

  // What the pictures show, as a number, so the strip is not the only evidence:
  // is the outgoing wallpaper still painted 2.2s in — past the deadline?
  const held = await page.evaluate(() => {
    const layers = Array.from(document.querySelectorAll('[aria-hidden="true"] > div'));
    return layers.map(l => {
      const img = l.querySelector('img') as HTMLImageElement | null;
      return {
        layerOpacity: (l as HTMLElement).style.opacity,
        imgLoaded: img ? img.complete && img.naturalHeight > 0 : false,
        wrapperClass: img?.parentElement?.className ?? '',
      };
    });
  });
  fs.writeFileSync(path.join(OUT, `${LABEL}-layers.json`), JSON.stringify(held, null, 2));
  console.log(`[${LABEL}] frames: ${shots.length}, layers at end:`, JSON.stringify(held));
});
