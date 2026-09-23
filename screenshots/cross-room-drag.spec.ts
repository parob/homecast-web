/**
 * Cross-room drag for virtual accessories.
 *
 * The shared drag context must reach the destination and explain why a
 * cross-room move is refused. Virtual accessory location belongs in its
 * editor; HomeKit devices belong in Apple Home. Neither drop should save.
 *
 * Driven with real pointer events because that is the only thing that exercises
 * dnd-kit. A unit test of the drag-end handler would pass whether or not a drag
 * could physically reach another room, which is exactly what was broken.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';

/** Save mutations seen, so we can assert what a drop actually wrote. */
async function captureSaves(page: Page) {
  const saves: Array<{ accessoryId: string | null; data: Record<string, unknown> }> = [];
  // The GraphQL endpoint is the ROOT, not /graphql — cookie-based calls from a
  // cross-subdomain context post to `/`. Matching '**/graphql' silently caught
  // nothing, so every "no save happened" assertion passed against an array that
  // could never fill.
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route, request) => {
    if (request.method() === 'POST') {
      try {
        const body = request.postDataJSON();
        if (body?.operationName === 'SaveVirtualAccessory') {
          saves.push({
            accessoryId: body.variables?.accessoryId ?? null,
            data: JSON.parse(body.variables?.data ?? '{}'),
          });
        }
      } catch { /* not JSON — let it through */ }
    }
    await route.fallback();
  });
  return saves;
}

/** dnd-kit needs movement past its activation distance, in steps. */
async function dragTile(page: Page, fromText: string, toText: string) {
  const source = page.locator('main').getByText(fromText, { exact: true }).first();
  const target = page.locator('main').getByText(toText, { exact: true }).first().locator('xpath=ancestor::*[@data-draggable-item][1]');
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error(`missing tile: ${fromText} -> ${toText}`);

  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  // Past the 8px activation constraint first, then across in steps so dnd-kit
  // registers the intermediate droppables.
  await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2, { steps: 5 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 25 });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await page.waitForTimeout(400);
}

/**
 * Order matters: Playwright matches route handlers last-registered-first, so
 * the capture has to be installed AFTER setupMocks or the mock fulfils every
 * request and the capture never runs — which made the "no save happened"
 * assertion pass against an array that could never have been filled.
 */
async function openDashboard(page: Page) {
  overrideSettings({ groupByRoom: true, compactMode: false });
  await setupMocks(page);
  const saves = await captureSaves(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForSelector('text=Home Mode', { timeout: 20000 });
  return saves;
}

test.describe('cross-room drag', () => {
  test('a virtual accessory drop points to its editor without moving it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    const saves = await openDashboard(page);

    // Home Mode lives at the top of the home (no room). Drag it into Bedroom.
    await dragTile(page, 'Home Mode', 'Ceiling Fan');

    await expect(page.getByText('Edit the virtual accessory to change its location', { exact: true })).toBeVisible();
    expect(saves, 'the refused drop must not rewrite the accessory').toHaveLength(0);
  });

  test('a real accessory is not moved between rooms', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    const saves = await openDashboard(page);

    // Ceiling Fan is a HomeKit device in Bedroom; drag it at the Garden tiles.
    await dragTile(page, 'Ceiling Fan', 'Irrigation');

    await expect(page.getByText('Use the Apple Home app to move accessories between rooms', { exact: true })).toBeVisible();
    expect(saves, 'a HomeKit accessory must never be written a new room').toHaveLength(0);
  });

  test('reordering within a room still works', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await openDashboard(page);

    // Same-room drag must not be mistaken for a cross-room move.
    const before = await page.locator('[data-room-name="Bedroom"]').first().locator('h3').allTextContents();
    await dragTile(page, 'Ceiling Fan', 'Blinds');
    const after = await page.locator('[data-room-name="Bedroom"]').first().locator('h3').allTextContents();

    // The order should change; the tiles should all still be present.
    for (const name of ['Ceiling Fan', 'Blinds']) {
      expect(after, `${name} should survive a reorder`).toContain(name);
    }
    expect(after, 'dropping on a neighbour must change the displayed order').not.toEqual(before);
  });
});
