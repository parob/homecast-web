/**
 * A one-line tab name sits in the middle of its box, not at the top of it.
 *
 * The compact bar reserves two lines under every icon so that all the bubbles
 * come out the same height whatever their names. A name that only needs one
 * line was then laid out at the *top* of that reserved box, so it sat about
 * half a line above the wrapped name beside it — "Bedroom" riding level with
 * the "Living" of "Living Room" rather than with the pair.
 *
 * Only a browser can see this: the box is a fixed `h-[23px]` either way, so
 * the element's own rect is identical in both cases and jsdom would report no
 * difference at all. What moves is where the *text* lands inside it, which is
 * measured here with a Range over the text node.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID, MY_HOME_ROOMS } from './fixtures';

/** Deliberately mixed: "Living Room" wraps to two lines, "Bedroom" does not. */
const MIXED_PINS = [
  ...MY_HOME_ROOMS.slice(0, 3).map(r => ({ type: 'room', id: r.id, name: r.name, homeId: HOME_ID })),
  { type: 'collection', id: 'col-bedtime', name: 'Bedtime' },
  { type: 'collection', id: 'col-all-lights', name: 'Annex Lights' },
];

const TOUCH_ONLY = 'Touch only — the tab bar is the phone surface';

async function openCompactBar(page: Page) {
  overrideSettings({
    theme: 'dark',
    developerMode: true,
    homeOrder: [HOME_ID],
    lastView: { type: 'home', homeId: HOME_ID },
    // The bar's own setting, so this measures the bar as people normally see
    // it rather than only the arranging variant.
    tabBarMode: 'compact',
    pinnedTabs: MIXED_PINS,
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.locator('[data-tour="sidebar-menu"]')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="tab-bar"] [data-tab-key]').first()).toBeVisible();
  await page.waitForTimeout(600);
}

/** Each tab: how far its rendered text sits off the centre of its label box. */
async function labelOffsets(page: Page) {
  return page.evaluate(() => {
    const chips = [...document.querySelectorAll<HTMLElement>('[data-testid="tab-bar"] [data-tab-key]')];
    return chips.map((chip) => {
      const box = chip.querySelector<HTMLElement>('[data-tab-label]');
      if (!box) throw new Error('no label box');
      // The type may be wrapped in a centring box or be the box itself; the
      // text-bearing element is whichever of the two carries the line-height.
      const textEl = (box.firstElementChild as HTMLElement | null) ?? box;

      // The box is a fixed height either way, so its own rect says nothing.
      // Where the TEXT falls inside it is the whole question.
      const range = document.createRange();
      range.selectNodeContents(textEl);
      const text = range.getBoundingClientRect();
      const b = box.getBoundingClientRect();
      const lineHeight = parseFloat(getComputedStyle(textEl).lineHeight) || 12.5;

      return {
        text: (box.textContent || '').trim(),
        lines: Math.max(1, Math.round(text.height / lineHeight)),
        // Positive = the text sits below the box's middle, negative = above it.
        offCentrePx: Math.round(((text.y + text.height / 2) - (b.y + b.height / 2)) * 100) / 100,
        textCentreY: Math.round((text.y + text.height / 2) * 100) / 100,
      };
    });
  });
}

test.describe('compact tab bar labels', () => {
  test('a one-line name is centred in its two-line box', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', TOUCH_ONLY);
    await openCompactBar(page);

    const labels = await labelOffsets(page);
    console.log('tab labels:', JSON.stringify(labels));

    const oneLine = labels.filter(l => l.lines === 1);
    const twoLine = labels.filter(l => l.lines === 2);
    expect(oneLine.length, 'need a one-line name in the bar').toBeGreaterThan(0);
    expect(twoLine.length, 'need a wrapped name to compare against').toBeGreaterThan(0);

    for (const l of labels) {
      expect(
        Math.abs(l.offCentrePx),
        `"${l.text}" (${l.lines} line${l.lines > 1 ? 's' : ''}) sits ${l.offCentrePx}px off the centre of its box`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test('one-line and wrapped names share a centre line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', TOUCH_ONLY);
    await openCompactBar(page);

    const labels = await labelOffsets(page);
    const one = labels.find(l => l.lines === 1)!;
    const two = labels.find(l => l.lines === 2)!;

    // This is the review's actual complaint, stated directly: side by side in
    // the same row, the two names should read as being on one line of type.
    expect(
      Math.abs(one.textCentreY - two.textCentreY),
      `"${one.text}" and "${two.text}" are ${Math.round((one.textCentreY - two.textCentreY) * 100) / 100}px apart`,
    ).toBeLessThanOrEqual(1);
  });

  /** Not an assertion — regenerates the picture, beside the other captures. */
  test('capture', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', TOUCH_ONLY);
    await openCompactBar(page);
    const box = await page.locator('[data-testid="tab-bar"]').boundingBox();
    if (!box) throw new Error('no bar');
    const width = Math.min(box.width, 440);
    await page.screenshot({
      path: `screenshots/output/tab-bar-label-centring.png`,
      clip: {
        x: Math.max(0, box.x + box.width / 2 - width / 2),
        y: Math.max(0, box.y - 16),
        width,
        height: box.height + 24,
      },
    });
  });
});
