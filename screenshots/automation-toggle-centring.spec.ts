/**
 * The enable/disable switch on an automation card sits on the card's own
 * middle, not at the top of it.
 *
 * The card's row is `items-start`, deliberately: an automation name wraps to as
 * many lines as it needs, and centring the icon and controls against a
 * three-line name looks wrong. But the control group has no height of its own,
 * so `items-start` also pins the 24px switch to the top of a 36px row — the
 * icon is `h-9`, and the title + subtitle come to 20px + 16px — and the switch
 * rides ~6px above the middle of every card whose name fits on one line, which
 * is nearly all of them.
 *
 * Only a real browser can show this: it is the resolved height of a flex row
 * against the intrinsic height of a Radix switch, and jsdom has no layout.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { HOME_ID } from './fixtures';

const automationsPill = (page: Page) => page.locator('[data-tour="automations"]');
const card = (page: Page, id: string) => page.locator(`[data-testid="automation-${id}"]`);
const switchIn = (page: Page, id: string) => card(page, id).locator('button[role="switch"]');

async function centreY(locator: ReturnType<typeof automationsPill>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element has no box');
  return box.y + box.height / 2;
}

async function openAutomations(page: Page) {
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(automationsPill(page)).toBeVisible({ timeout: 20000 });
  await automationsPill(page).click();
  await expect(card(page, 'hk-auto-1')).toBeVisible();
  // The section expands; measure once it has settled.
  await page.waitForTimeout(500);
}

test.describe('Automation card toggle', () => {
  for (const id of ['hk-auto-1', 'hk-auto-2']) {
    test(`is vertically centred on the card (${id})`, async ({ page }) => {
      await openAutomations(page);

      const cardCentre = await centreY(card(page, id));
      const toggleCentre = await centreY(switchIn(page, id));

      expect(
        Math.abs(toggleCentre - cardCentre),
        `toggle centre is ${(cardCentre - toggleCentre).toFixed(1)}px above the card's`,
      ).toBeLessThanOrEqual(1);
    });
  }

  test('stays beside the icon when the name wraps to several lines', async ({ page }) => {
    await openAutomations(page);

    // Same card, renamed in place to something that has to wrap. The switch
    // should follow the icon, not slide down to the middle of a tall card.
    await card(page, 'hk-auto-1').locator('div[title]').first().evaluate((el) => {
      el.textContent = 'Turn off the heating when a window opens anywhere in the house';
    });
    await page.waitForTimeout(200);

    const icon = await centreY(card(page, 'hk-auto-1').locator('img').first());
    const toggle = await centreY(switchIn(page, 'hk-auto-1'));

    expect(
      Math.abs(toggle - icon),
      `toggle centre is ${(toggle - icon).toFixed(1)}px from the icon's`,
    ).toBeLessThanOrEqual(1);
  });
});
