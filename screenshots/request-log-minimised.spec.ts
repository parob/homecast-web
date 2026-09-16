/**
 * What the request log costs the screen while it is minimised.
 *
 * parob/homecast-cloud#122 asked for the collapsed log to be a floating button
 * in the bottom-right, on the same alignment as the tab bar, taking no insets.
 * Both halves of that are geometry a browser has to measure: the squash is
 * `DebugDock` sizing a flex column, and the tab bar's lift is a `bottom` it
 * reads from `lib/debug-dock`. jsdom does no layout and would report neither.
 *
 * `REQUEST_LOG_LABEL` names the side being captured, so the before and the
 * after can be filed side by side from two checkouts:
 *
 *   REQUEST_LOG_LABEL=before npx playwright test request-log-minimised.spec.ts --project=iphone-screenshots
 *
 * Captures land in the gitignored `output/request-log/`; the pair that ends up
 * in the pull request is copied into `evidence/issue-122/`.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, waitForDashboard } from './mocks';
import { HOME_ID, MY_HOME_ROOMS } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LABEL = process.env.REQUEST_LOG_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'request-log');

/** The viewport the report came from — an iPhone 16 Pro Max, per its context blob. */
test.use({ viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });

/**
 * Enough pins that the bar's pill reaches its `calc(100% - 32px)` ceiling, so
 * the right gutter the new button wants is occupied rather than empty. A pill
 * that stops short of it would let a collision pass unnoticed.
 */
const PINS = [
  ...MY_HOME_ROOMS.slice(0, 4).map(r => ({ type: 'room', id: r.id, name: r.name, homeId: HOME_ID })),
  { type: 'collection', id: 'col-bedtime', name: 'Bedtime' },
];

async function openDashboard(page: Page) {
  overrideSettings({
    theme: 'dark',
    developerMode: true,
    homeOrder: [HOME_ID],
    lastView: { type: 'home', homeId: HOME_ID },
    pinnedTabs: PINS,
  });
  await setupMocks(page);
  // The log's own switch. Read synchronously from localStorage at mount, so it
  // has to be in place before the app boots rather than toggled afterwards.
  await page.addInitScript(() => localStorage.setItem('homecast-debug-request-panel', '1'));
  await page.goto(`/portal?home=${HOME_ID}`);
  await waitForDashboard(page);
  await expect(page.getByText('Requests')).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[data-testid="tab-bar"] [data-tab-key]').first()).toBeVisible();
  await page.waitForTimeout(600);
}

async function minimise(page: Page) {
  await page.getByTitle('Minimise').click();
  // The dock animates its height; measuring mid-transition reads a number that
  // belongs to neither state.
  await page.waitForTimeout(500);
}

/** Everything the two states are actually being judged on, in viewport pixels. */
async function geometry(page: Page) {
  return page.evaluate(() => {
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const bar = document.querySelector<HTMLElement>('[data-testid="tab-bar"]');
    // The glass pill itself — the row's parent — not a chip inside it. The
    // outer edge is what the new button is being lined up with.
    const pill = document.querySelector<HTMLElement>('[data-tab-row]')?.parentElement as HTMLElement | null;
    // The app's own column inside DebugDock — the thing that gets squashed.
    // Anchored on the header's ⋮ because it needs *any* element known to be
    // inside the app shell, and the ☰ this used to use no longer renders in a
    // browser at all (parob/homecast-web#133).
    const app = document.querySelector<HTMLElement>('[data-tour="header-menu"]')?.closest('div[style*="translateZ"]') as HTMLElement | null;
    const control = document.querySelector<HTMLElement>('[aria-label="Expand request log"]');
    const r = (el: HTMLElement | null) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return {
        top: Math.round(b.top), right: Math.round(b.right),
        bottom: Math.round(b.bottom), left: Math.round(b.left),
        width: Math.round(b.width), height: Math.round(b.height),
      };
    };
    // The gutter the tab bar's own row keeps on the right: whatever
    // `safe-area-x` puts on the wrapper, plus the row's `px-4`. Read rather
    // than assumed, because the button is claiming to share it.
    const row = bar?.lastElementChild as HTMLElement | undefined;
    const tabGutter = bar && row
      ? Math.round(parseFloat(getComputedStyle(bar).paddingRight) + parseFloat(getComputedStyle(row).paddingRight))
      : null;

    return {
      viewport: { width: vw, height: vh },
      docWidth: document.documentElement.clientWidth,
      barRight: bar ? Math.round(bar.getBoundingClientRect().right) : null,
      tabGutter,
      barBottomStyle: bar?.style.bottom ?? null,
      // What the app has left of the screen. Full height = not squashed.
      appHeight: app ? Math.round(app.getBoundingClientRect().height) : null,
      // How far the tab pill sits off the bottom edge — the floor the request
      // asked the new button to share.
      tabFloor: pill ? Math.round(vh - pill.getBoundingClientRect().bottom) : null,
      tabPill: r(pill),
      control: r(control),
      controlFromBottom: control ? Math.round(vh - control.getBoundingClientRect().bottom) : null,
      controlFromRight: control ? Math.round(vw - control.getBoundingClientRect().right) : null,
      // Does the collapsed control overlap the tab bar's pill?
      overlapsTabs: (() => {
        if (!control || !pill) return null;
        const c = control.getBoundingClientRect();
        const p = pill.getBoundingClientRect();
        return !(c.right <= p.left || c.left >= p.right || c.bottom <= p.top || c.top >= p.bottom);
      })(),
    };
  });
}

test.describe('the minimised request log', () => {
  test('what it costs the screen', async ({ page }) => {
    await openDashboard(page);
    fs.mkdirSync(OUT, { recursive: true });

    const expanded = await geometry(page);
    await page.screenshot({ path: path.join(OUT, `${LABEL}-expanded.png`) });

    await minimise(page);
    const minimised = await geometry(page);
    await page.screenshot({ path: path.join(OUT, `${LABEL}-minimised.png`) });

    fs.writeFileSync(
      path.join(OUT, `${LABEL}-geometry.json`),
      JSON.stringify({ expanded, minimised }, null, 2),
    );
    console.log(`[${LABEL}] expanded `, JSON.stringify(expanded));
    console.log(`[${LABEL}] minimised`, JSON.stringify(minimised));
  });

  test('minimised, it reserves nothing and lines up with the tab bar', async ({ page }) => {
    await openDashboard(page);
    await minimise(page);
    const g = await geometry(page);

    // No insets: the app keeps the whole screen and the tab bar stays on the
    // bottom edge. Before #122 the dock published 52px and took both.
    expect(g.appHeight).toBe(g.viewport.height);
    expect(g.barBottomStyle).toBe('0px');

    // Bottom-right, on the tab bar's own floor and in its own 16px gutter.
    expect(g.control).not.toBeNull();
    expect(g.controlFromBottom).toBe(g.tabFloor);
    expect(g.controlFromRight).toBe(g.tabGutter);
    // …and it is a button, not a bar: nowhere near the full width of the phone.
    expect(g.control!.width).toBeLessThan(g.viewport.width / 2);

    // The pill it shares a row with must not end up underneath it.
    expect(g.overlapsTabs).toBe(false);
  });
});
