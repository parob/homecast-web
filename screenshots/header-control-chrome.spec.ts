/**
 * The header controls, over the backgrounds that decide how they are drawn.
 *
 * This spec exists to produce the picture rather than to assert anything.
 * parob/homecast-cloud#118 asked to see the top row without the circles, and
 * the follow-up on parob/homecast-web#106 asked for more examples over the
 * case that does not work — a busy photo whose *top* is bright while the image
 * as a whole measures dark.
 *
 * `HEADER_CHROME_LABEL` names the treatment being captured, so several can be
 * filed side by side from different checkouts:
 *
 *   HEADER_CHROME_LABEL=discs      npx playwright test header-control-chrome.spec.ts --project=iphone-screenshots
 *
 * Captures land in the gitignored `output/header-chrome/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts, overrideSettings } from './mocks';
import { HOME_ID, SHARED_HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.HEADER_CHROME_LABEL || 'after';
// `output/` is the gitignored evidence drawer — these are for a human to look
// at, not for the docs site, and never worth a diff.
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'header-chrome');

/**
 * Chosen to span the space the controls actually land on, not to be pretty.
 * `countryside` is the one that fails: bright sky under the header, dark trees
 * everywhere else, so the whole-image average says "dark" and the icons go
 * white over the brightest part of the picture.
 */
const BACKGROUNDS: Array<[name: string, background: Record<string, unknown>]> = [
  ['countryside', { type: 'preset', presetId: 'nature-countryside', blur: 0, brightness: 78 }],
  ['clouds', { type: 'preset', presetId: 'abstract-clouds', blur: 0, brightness: 85 }],
  ['mountains', { type: 'preset', presetId: 'nature-mountains', blur: 0, brightness: 60 }],
  ['cliffs', { type: 'preset', presetId: 'nature-cliffs', blur: 0, brightness: 35 }],
  ['beach', { type: 'preset', presetId: 'nature-beach', blur: 15, brightness: 30 }],
  ['sunset', { type: 'preset', presetId: 'gradient-sunset', blur: 0, brightness: 50 }],
  ['light', { type: 'preset', presetId: 'solid-light-gray', blur: 0, brightness: 60 }],
];

async function shot(page: Page, background: Record<string, unknown>, name: string) {
  overrideSettings({
    theme: 'dark',
    sidebarCollapsed: false,
    compactMode: true,
    layoutMode: 'masonry',
    groupByRoom: true,
    groupByType: false,
    iconStyle: 'colourful',
    fontSize: 'small',
    hideInfoDevices: false,
    hideAccessoryCounts: true,
  });
  overrideEntityLayouts({
    [`home:${HOME_ID}`]: { background },
    [`home:${SHARED_HOME_ID}`]: { background },
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.locator('[data-tour="sidebar-menu"]')).toBeVisible({ timeout: 20000 });
  // Let the background image decode — the dark/light verdict is measured off
  // the loaded pixels, so a shot taken too early catches the wrong styling.
  await page.waitForTimeout(3200);

  fs.mkdirSync(OUT, { recursive: true });
  // The header band plus a little of the title under it, which is what the
  // controls have to stay legible against.
  await page.screenshot({
    path: path.join(OUT, `${name}-${LABEL}.png`),
    clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 200 },
  });
}

test.describe('header control chrome', () => {
  for (const [name, background] of BACKGROUNDS) {
    test(`over ${name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'iphone-screenshots', 'Phone header only');
      await shot(page, background, name);
    });
  }
});
