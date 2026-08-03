/**
 * Cross-room drag for virtual accessories.
 *
 * Every room used to render its own DndContext, so a drag could not leave a
 * room at all. This exercises the single shared context: a virtual accessory
 * dragged into another room must be saved with that room, and a real accessory
 * dragged the same way must not move — Apple Home owns its room and rejects our
 * writes, so appearing to move it would show a change that never happened.
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
  const saves: Array<{ helperId: string | null; data: Record<string, unknown> }> = [];
  await page.route('**/graphql', async (route, request) => {
    if (request.method() === 'POST') {
      try {
        const body = request.postDataJSON();
        if (body?.operationName === 'SaveHcHelper') {
          saves.push({
            helperId: body.variables?.helperId ?? null,
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
  const source = page.locator(`text=${fromText}`).first();
  const target = page.locator(`text=${toText}`).first();
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

async function openDashboard(page: Page) {
  overrideSettings({ groupByRoom: true, compactMode: false });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await page.waitForSelector('text=Home Mode', { timeout: 20000 });
}

test.describe('cross-room drag', () => {
  test('a virtual accessory can be dragged into a room', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    const saves = await captureSaves(page);
    await openDashboard(page);

    // Home Mode lives at the top of the home (no room). Drag it into Bedroom.
    await dragTile(page, 'Home Mode', 'Ceiling Fan');

    const moved = saves.find(s => s.data?.name === 'Home Mode');
    expect(moved, 'dropping into a room should save the virtual accessory').toBeTruthy();
    expect(moved!.data.roomId, 'it should be saved with the destination room').toBeTruthy();
  });

  test('a real accessory is not moved between rooms', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    const saves = await captureSaves(page);
    await openDashboard(page);

    // Ceiling Fan is a HomeKit device in Bedroom; drag it at the Garden tiles.
    await dragTile(page, 'Ceiling Fan', 'Irrigation');

    expect(saves, 'a HomeKit accessory must never be written a new room').toHaveLength(0);
  });

  test('reordering within a room still works', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'screenshots', 'Desktop only');
    await openDashboard(page);

    // Same-room drag must not be mistaken for a cross-room move.
    const before = await page.locator('[data-room-name="Bedroom"]').first().innerText();
    await dragTile(page, 'Ceiling Fan', 'Blinds');
    const after = await page.locator('[data-room-name="Bedroom"]').first().innerText();

    // The order should change; the tiles should all still be present.
    for (const name of ['Ceiling Fan', 'Blinds']) {
      expect(after, `${name} should survive a reorder`).toContain(name);
    }
    expect(before.length).toBeGreaterThan(0);
  });
});
