/**
 * The unpin badge has to sit inside the bar it is unpinning from.
 *
 * Reported from a phone: "the x button ... is too small and going outside the
 * tab bar". Both halves are geometry, and only a real browser has any.
 *
 * The badge is `absolute` on the tab slot, and the *last* slot's top-right
 * corner is a square corner of the bar's inner box — a corner the bar does not
 * have. The bar is `rounded-3xl`, a flat 40px against a pill only ~81px tall,
 * so it is very nearly a stadium and that corner is past the arc. Pinned to it,
 * a 16px badge came out tangent to the bar's outline with no clearance at all,
 * which is what reads as hanging off the end.
 *
 * jsdom would pass whichever inset was written, so this measures the rendered
 * boxes: how far the badge's circle escapes the bar's rounded outline, and how
 * big its target actually is.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID, MY_HOME_ROOMS } from './fixtures';

/** One pin, and a full bar — the last tab's badge is the one at the corner. */
const ONE_PIN = [{ type: 'collection', id: 'col-all-lights', name: 'Annex Lights' }];
const FULL_BAR = [
  ...MY_HOME_ROOMS.slice(0, 3).map(r => ({ type: 'room', id: r.id, name: r.name, homeId: HOME_ID })),
  { type: 'collection', id: 'col-bedtime', name: 'Bedtime' },
  { type: 'collection', id: 'col-all-lights', name: 'Annex Lights' },
];

async function enterEditLayout(page: Page) {
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(page.locator('[data-testid="edit-layout-bar"]')).toBeVisible();
  await page.waitForTimeout(600);
}

async function openBar(page: Page, pinnedTabs: unknown[]) {
  overrideSettings({
    theme: 'dark',
    developerMode: true,
    homeOrder: [HOME_ID],
    lastView: { type: 'home', homeId: HOME_ID },
    pinnedTabs,
  });
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.locator('[data-tour="sidebar-menu"]')).toBeVisible({ timeout: 20000 });
  await enterEditLayout(page);
  await expect(page.locator('[data-edit-badge="remove"]').last()).toBeVisible();
}

/**
 * How far the LAST tab's badge escapes the pill's *rounded* outline, in px.
 *
 * A plain rect comparison says zero: the badge is inside the bar's box. The
 * bar's paint stops at its border radius, so the corner of that box is
 * wallpaper — and that is the corner the badge was pinned to.
 */
async function measure(page: Page) {
  return page.evaluate(() => {
    const row = document.querySelector('[data-testid="tab-bar"] [data-tab-row]');
    const pill = row?.parentElement as HTMLElement | null;
    const badges = document.querySelectorAll<HTMLElement>('[data-edit-badge="remove"]');
    const el = badges[badges.length - 1];
    if (!pill || !el) throw new Error('no tab bar badge on screen');

    const p = pill.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const r = parseFloat(getComputedStyle(pill).borderTopRightRadius) || 0;

    // Signed distance from a point to the pill's rounded rect: positive is
    // outside the paint, negative is how deep inside it sits. Each point
    // belongs to exactly one corner arc — taking the worst of all four counts
    // arcs the point is nowhere near, which on a near-stadium pill overstates
    // the answer several times over.
    const signedDistance = (x: number, y: number) => {
      const nx = x < p.x + r ? p.x + r : x > p.x + p.width - r ? p.x + p.width - r : null;
      const ny = y < p.y + r ? p.y + r : y > p.y + p.height - r ? p.y + p.height - r : null;
      if (nx !== null && ny !== null) return Math.hypot(x - nx, y - ny) - r;
      return Math.max(p.x - x, x - (p.x + p.width), p.y - y, y - (p.y + p.height));
    };

    // Sample the badge's own circle — it is `rounded-full`, so its box corners
    // are not what would stick out.
    let worst = -Infinity;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2, rad = Math.min(b.width, b.height) / 2;
    for (let i = 0; i < 360; i++) {
      const a = (i * Math.PI) / 180;
      worst = Math.max(worst, signedDistance(cx + rad * Math.cos(a), cy + rad * Math.sin(a)));
    }
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      // How far past the bar's outline the badge reaches, and — the number that
      // actually says whether it looks attached — how much bar there is between
      // the badge and that outline at its nearest point.
      overshootPx: round(Math.max(worst, 0)),
      clearancePx: round(-worst),
      badge: { w: Math.round(b.width), h: Math.round(b.height) },
      pill: { w: Math.round(p.width), h: Math.round(p.height), radius: r },
    };
  });
}

/** The tab bar and Edit Layout are the phone surface; a desktop has neither. */
const TOUCH_ONLY = 'Touch only — the tab bar and Edit Layout are the phone surface';

test.describe('the tab bar unpin badge', () => {
  for (const [name, pins] of [['one pin', ONE_PIN], ['a full bar', FULL_BAR]] as const) {
    test(`stays inside the bar's rounded outline — ${name}`, async ({ page }, testInfo) => {
      test.skip(testInfo.project.name !== 'iphone-screenshots', TOUCH_ONLY);
      await openBar(page, pins as unknown[]);
      const m = await measure(page);
      console.log(`unpin badge (${name}):`, JSON.stringify(m));
      // Not merely "does not escape": a badge tangent to the outline is what
      // was reported, and it measured 0.2px over. Ask for real bar around it.
      expect(
        m.clearancePx,
        `badge clears the bar's rounded outline by ${m.clearancePx}px (overshoot ${m.overshootPx}px)`,
      ).toBeGreaterThanOrEqual(2);
    });
  }

  test('is big enough to read as a control', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', TOUCH_ONLY);
    await openBar(page, ONE_PIN as unknown[]);
    const m = await measure(page);
    // `h-5 w-5` against the fixed 20px root (lib/text-scale.ts) = 25px. It was
    // `h-4` — 20px — which is what the report called too small. Not the 24-unit
    // default either: at 30px it covered the tab's own glyph, see EditBadge.
    expect(m.badge.w, `badge is ${m.badge.w}×${m.badge.h}`).toBe(25);
    expect(m.badge.h, `badge is ${m.badge.w}×${m.badge.h}`).toBe(25);
  });

  /** Not an assertion — regenerates the picture, beside the other captures. */
  test('capture', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', TOUCH_ONLY);
    for (const [label, pins] of [['one', ONE_PIN], ['full', FULL_BAR]] as const) {
      await openBar(page, pins as unknown[]);
      const box = await page.locator('[data-testid="tab-bar"]').boundingBox();
      if (!box) throw new Error('no bar');
      const width = Math.min(box.width, 440);
      await page.screenshot({
        path: `screenshots/output/tab-bar-unpin-badge-${label}.png`,
        clip: {
          x: Math.max(0, box.x + box.width / 2 - width / 2),
          y: Math.max(0, box.y - 16),
          width,
          height: box.height + 24,
        },
      });
    }
  });
});
