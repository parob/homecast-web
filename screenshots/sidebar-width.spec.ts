/**
 * How wide the dashboard's navigation panel is, and what that costs a name.
 *
 * parob/homecast-cloud#157 asked for the left navigation to widen on a wider
 * screen so room names stop being clipped, gradually, above a threshold. It was
 * a flat 248px at every window width — measured at 1280, 1600, 1920 and 2560
 * before this change, all four identical.
 *
 * The curve itself is arithmetic and is unit-tested in
 * `src/lib/__tests__/sidebar-width.test.ts`. What needs a browser is that the
 * `clamp()` reaches the panel at all, and that the extra width is spent on the
 * name rather than on padding — which is `scrollWidth > clientWidth` on the
 * label, something jsdom cannot answer because it does no layout.
 *
 *   SIDEBAR_LABEL=before npx playwright test sidebar-width.spec.ts --project=screenshots
 *
 * Captures land in the gitignored `output/`; the pair in the pull request is
 * copied into `evidence/issue-157/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts, overrideRoomNames, waitForDashboard } from './mocks';
import { HOME_ID, MY_HOME_ROOMS } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.SIDEBAR_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-157');

/** A name of the length the report is about — long, but nothing unusual. */
const LONG_ROOM = 'Downstairs Shower Room';
const LONGEST_ROOM = 'Upstairs Guest Bedroom';

test.afterAll(() => overrideRoomNames({}));

async function openDashboard(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  overrideRoomNames({
    [MY_HOME_ROOMS[0].id]: LONG_ROOM,
    [MY_HOME_ROOMS[1].id]: LONGEST_ROOM,
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await page.locator('aside').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
}

/** The panel's width, and whether each room row's name fits inside it. */
async function measure(page: Page) {
  const width = (await page.locator('aside').first().boundingBox())?.width ?? 0;
  const clipped = await page.locator('aside').evaluate((aside) =>
    Array.from(aside.querySelectorAll('span.truncate'))
      .filter(el => (el.textContent || '').trim().length > 0)
      .filter(el => el.scrollWidth > el.clientWidth)
      .map(el => (el.textContent || '').trim()));
  return { width: Math.round(width), clipped };
}

test('the panel at four window widths', async ({ page }) => {
  fs.mkdirSync(OUT, { recursive: true });
  const rows: Record<string, unknown>[] = [];

  for (const viewport of [1280, 1600, 1920, 2560]) {
    await openDashboard(page, viewport);
    const measured = await measure(page);
    rows.push({ viewport, ...measured });
    await page.screenshot({
      path: path.join(OUT, `sidebar-${LABEL}-${viewport}.png`),
      clip: { x: 0, y: 0, width: 460, height: 620 },
    });
  }

  fs.writeFileSync(path.join(OUT, `sidebar-${LABEL}.json`), JSON.stringify(rows, null, 2));
  // eslint-disable-next-line no-console
  console.log(`[sidebar ${LABEL}]`, JSON.stringify(rows));

  const at = (v: number) => rows.find(r => r.viewport === v) as { width: number; clipped: string[] };

  // A laptop is untouched: this is the width every install already had.
  expect(at(1280).width).toBe(248);
  // Then it grows — gradually, so 1600 lands between the two ends rather than
  // jumping straight to the ceiling.
  expect(at(1600).width).toBeGreaterThan(at(1280).width);
  expect(at(1600).width).toBeLessThan(at(1920).width);
  // And it stops, so a very wide window does not get a very wide panel.
  expect(at(2560).width).toBe(at(1920).width);

  // The point of the exercise: names that were clipped are not clipped now.
  expect(at(1280).clipped).toEqual(expect.arrayContaining([LONG_ROOM, LONGEST_ROOM]));
  expect(at(1920).clipped).not.toContain(LONGEST_ROOM);
  expect(at(1920).clipped).not.toContain(LONG_ROOM);
});
