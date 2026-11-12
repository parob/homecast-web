/**
 * parob/homecast-cloud#258: "the left menu should follow the same style as the
 * widget background for the desktop app".
 *
 * An off tile's glass is the shared `OFF_TINT_*` fill over a `backdrop-blur-xl`
 * layer, with a slate hairline over a light wallpaper. The desktop panel was
 * drawn from a different material (`material-regular-dark`, twice as dark) and,
 * over a light wallpaper, from no material at all. This asserts the panel paints
 * the same fill, blur and edge as the off tile beside it.
 *
 *   SIDEBAR_GLASS_LABEL=before npx playwright test issue-258-sidebar-glass.spec.ts --project=screenshots
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts, overrideSettings, waitForDashboard } from './mocks';
import { HOME_ID, SHARED_HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.SIDEBAR_GLASS_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'issue-258');

const BACKGROUNDS: Array<[name: string, background: Record<string, unknown>]> = [
  ['beach-dark', { type: 'preset', presetId: 'nature-beach', blur: 0, brightness: 45 }],
  ['sunset', { type: 'preset', presetId: 'gradient-sunset', blur: 0, brightness: 60 }],
  ['light', { type: 'preset', presetId: 'solid-light-gray', blur: 0, brightness: 100 }],
];

async function open(page: Page, background: Record<string, unknown>) {
  await page.setViewportSize({ width: 1440, height: 900 });
  overrideSettings({
    theme: 'dark',
    sidebarCollapsed: false,
    layoutMode: 'masonry',
    groupByRoom: true,
    iconStyle: 'colourful',
    homeOrder: [HOME_ID],
    lastView: { type: 'home', homeId: HOME_ID },
  });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: { background },
    [`home:${SHARED_HOME_ID}`]: { background },
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.locator('aside').first().waitFor({ state: 'visible' });
  // The light/dark verdict is measured off the decoded pixels.
  await page.waitForTimeout(3200);
}

/** The painted glass of the panel and of the first off tile. */
async function surfaces(page: Page) {
  return page.evaluate(() => {
    const css = (el: Element | null) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        background: s.backgroundColor,
        backdrop: s.backdropFilter || (s as unknown as Record<string, string>).webkitBackdropFilter,
      };
    };
    const panel = document.querySelector('aside [data-sidebar-glass]');
    // An off tile: its glass layer has the off fill, and no lit accent.
    const layers = Array.from(document.querySelectorAll('main .backdrop-blur-xl')) as HTMLElement[];
    const offTile = layers.find(l => /^rgba\((0, 0, 0|241, 245, 249)/.test(getComputedStyle(l).backgroundColor));
    const tileWrapper = offTile?.parentElement ?? null;
    return {
      panel: css(panel),
      tile: css(offTile ?? null),
      panelRing: (() => { const r = document.querySelector('aside [data-sidebar-ring]'); return r ? getComputedStyle(r).boxShadow : null; })(),
      tileRing: tileWrapper ? getComputedStyle(tileWrapper).boxShadow : null,
    };
  });
}

test.describe('#258 sidebar matches the tile glass', () => {
  for (const [name, background] of BACKGROUNDS) {
    test(`over ${name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'screenshots', 'Desktop sidebar only');
      await open(page, background);
      fs.mkdirSync(OUT, { recursive: true });
      await page.screenshot({ path: path.join(OUT, `${name}-${LABEL}.png`) });
      const s = await surfaces(page);
      console.log(`[#258 ${name} ${LABEL}]`, JSON.stringify(s));
      expect(s.tile, 'an off tile is on screen').not.toBeNull();
      expect(s.panel, 'the panel carries its glass layer').not.toBeNull();
      expect(s.panel!.background).toBe(s.tile!.background);
      expect(s.panel!.backdrop).toBe(s.tile!.backdrop);
      // The same hairline: slate over a light wallpaper, transparent over a dark one.
      expect(s.panelRing).toBe(s.tileRing);
    });
  }
});
