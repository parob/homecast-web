/**
 * How leaving Edit Layout actually moves, sampled every frame.
 *
 * `hidden-items-exit.spec.ts` covers whether things fade; this covers where they
 * go while they do. Both faults here were reported together in
 * parob/homecast-cloud#60 and have nothing in common but the gesture:
 *
 *  - the tiles rose past their resting place and dropped back, but only with
 *    the page near its end;
 *  - a room that emptied lost its whole height in a single frame.
 *
 * A real browser, because both are questions about frames. jsdom has no layout
 * and no `requestAnimationFrame` worth the name, so a unit version would assert
 * whatever the stub said.
 *
 * The metric is one tile's viewport `top` per frame. Overshoot is the trace
 * passing its own resting value; a jump is one frame carrying a large share of
 * the travel. Only overshoot is asserted tightly — a frame budget is a timing
 * measurement and CI machines drop frames — so the jump is held to a loose
 * bound that the 170px single-frame close could never pass.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';

const editBarOn = (page: Page) =>
  page.locator('[data-testid="edit-layout-bar"][aria-hidden="false"]');

/** Hidden tiles, with every room keeping at least one visible one. */
const SOME_HIDDEN = {
  'room:room-bedroom': { visibility: { hiddenAccessories: ['acc-br-fan', 'acc-br-blinds'] } },
  'room:room-kitchen': { visibility: { hiddenAccessories: ['acc-ki-outlet', 'acc-ki-temp'] } },
  'room:room-front-door': { visibility: { hiddenAccessories: ['acc-fd-motion', 'acc-fd-camera'] } },
};

/** Enough hidden that the Front Door has nothing left and unmounts whole. */
const ROOM_EMPTIES = {
  'room:room-bedroom': { visibility: { hiddenAccessories: ['acc-br-fan', 'acc-br-blinds', 'acc-br-light'] } },
  'room:room-kitchen': { visibility: { hiddenAccessories: ['acc-ki-outlet', 'acc-ki-temp', 'acc-ki-light'] } },
  'room:room-front-door': { visibility: { hiddenAccessories: ['acc-fd-motion', 'acc-fd-camera', 'acc-fd-lock'] } },
  'room:room-garden': { visibility: { hiddenAccessories: ['acc-gd-light', 'acc-gd-valve'] } },
};

interface Sample { t: number; top: number }

/** Watch one tile's viewport top every frame for `ms`. */
async function traceTile(page: Page, label: string, ms: number): Promise<Sample[]> {
  const out = await page.evaluate(async ({ label, ms }) => {
    const el = Array.from(document.querySelectorAll('[data-draggable-item]'))
      .find(e => (e.textContent || '').includes(label)) as HTMLElement | undefined;
    if (!el) return null;
    const samples: Sample[] = [];
    const t0 = performance.now();
    await new Promise<void>(resolve => {
      const tick = () => {
        const t = performance.now() - t0;
        samples.push({ t: Math.round(t), top: Math.round(el.getBoundingClientRect().top * 10) / 10 });
        if (t >= ms) return resolve();
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return samples;
  }, { label, ms }) as Sample[] | null;
  if (!out) throw new Error(`no tile matching ${label}`);
  return out;
}

function motionOf(samples: Sample[]) {
  const rest = samples[samples.length - 1].top;
  const start = samples[0].top;
  const dir = rest < start ? -1 : 1;
  let overshootPx = 0;
  for (const s of samples) overshootPx = Math.max(overshootPx, (s.top - rest) * dir);

  let biggestStep = 0;
  for (let i = 1; i < samples.length; i++) {
    biggestStep = Math.max(biggestStep, Math.abs(samples[i].top - samples[i - 1].top));
  }
  return { travel: Math.abs(rest - start), overshootPx, biggestStep };
}

/** Open the home view, scroll to `scrollTo`, enter Edit Layout, tap Done, watch. */
async function traceExit(page: Page, scrollTo: number) {
  await setupMocks(page);
  await page.goto(`/portal?home=${HOME_ID}`);
  await expect(page.locator('main').getByText('Thermostat', { exact: true }).first())
    .toBeVisible({ timeout: 20000 });

  await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior }), scrollTo);
  await page.waitForTimeout(600);

  // The menu route rather than a hold: this is about leaving, and the hold
  // would also pick a tile up.
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Edit Layout' }).click();
  await expect(editBarOn(page)).toBeVisible();
  // Let the reveal and its own reflow finish, so what follows is only the exit.
  await page.waitForTimeout(1500);

  const tracing = traceTile(page, 'Thermostat', 1600);
  await page.getByRole('button', { name: 'Done' }).click();
  return motionOf(await tracing);
}

test.describe('leaving Edit Layout', () => {
  test('does not rise past where it lands and drop back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts(SOME_HIDDEN);
    // Near the end of the page ON PURPOSE. With room to spare below there was
    // never any overshoot; the reflow's own `overflow` was moving the container's
    // contents 5px, and the scroll anchor turned that into a page-wide scroll
    // one way and back the other. Scrolled to the top this test passes on the
    // broken code and proves nothing.
    const m = await traceExit(page, 700);

    expect(m.travel, 'nothing moved, so there is nothing to overshoot').toBeGreaterThan(20);
    expect(
      m.overshootPx,
      `the tiles went ${m.overshootPx}px past their resting place before settling back`,
    ).toBeLessThanOrEqual(1);
  });

  test('closes an emptied room over time, not in one frame', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone-screenshots', 'Touch only — Edit Layout is a touch mode');

    overrideEntityLayouts(ROOM_EMPTIES);
    const m = await traceExit(page, 700);

    expect(m.travel, 'nothing moved, so nothing was closed').toBeGreaterThan(100);
    // A room unmounting uncushioned put 170px into a single frame, 59% of the
    // whole movement. Held loosely — this is a timing measurement on a shared
    // machine — but nowhere near loosely enough to let that back through.
    expect(
      m.biggestStep,
      `one frame moved ${m.biggestStep}px of ${Math.round(m.travel)}px`,
    ).toBeLessThan(m.travel * 0.45);
  });
});
