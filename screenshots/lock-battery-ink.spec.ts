/**
 * A tile's ink rule has to reach every line on the tile, not the ones that
 * happen to be the right element.
 *
 * parob/homecast-cloud#167: on an expanded, battery-powered lock over a dark
 * wallpaper, "Battery 100%" was unreadable. Nothing was missing and nothing was
 * too small — it was painted rgb(2,8,23) on a tile filled rgba(0,0,0,.2). The
 * name and the state directly above it were white, which is the tell: they are
 * an `h3` and a `span`, and `WidgetWrapper`'s light-ink rule is a list of
 * element names plus `.tile-ink`. `CircleControl`'s `detail` line is a bare
 * `div`, so it matched nothing and kept the card's dark foreground.
 *
 * So the assertion is not "is the class there" — a class list can be right
 * while the paint is wrong. It is the contrast the reader actually gets, from
 * the composited colours: the text over the glass over the wallpaper.
 *
 * `LOCK_INK_LABEL=before` captures the same tile against an unfixed working
 * tree; the pair in the pull request is copied into `evidence/issue-167/`.
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LABEL = process.env.LOCK_INK_LABEL || 'after';
const OUT = path.resolve(HERE, 'output', 'issue-167');

/** The reporter's device, from the context blob on the issue. */
test.use({
  viewport: { width: 440, height: 956 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
});

type Rgba = [number, number, number, number];

function parse(colour: string): Rgba {
  const n = (colour.match(/[\d.]+/g) || []).map(Number);
  if (n.length < 3) throw new Error(`not a colour: ${colour}`);
  return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
}

/** `over` is opaque by the time we use it — the page background always is. */
function composite(top: Rgba, over: Rgba): Rgba {
  const a = top[3];
  return [
    top[0] * a + over[0] * (1 - a),
    top[1] * a + over[1] * (1 - a),
    top[2] * a + over[2] * (1 - a),
    1,
  ];
}

function relativeLuminance([r, g, b]: Rgba): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgba, b: Rgba): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return +((hi + 0.05) / (lo + 0.05)).toFixed(2);
}

/**
 * The three colours that decide whether the line can be read, pulled from the
 * live page: the wallpaper, the glass fill painted over it, and each line of
 * ink with its own opacity.
 */
async function inkReport(page: Page) {
  return page.evaluate(() => {
    const line = (test: (text: string) => boolean) =>
      [...document.querySelectorAll<HTMLElement>('*')].find(
        el => el.children.length === 0 && test((el.textContent || '').trim()),
      );
    const ink = (el: HTMLElement | undefined) => {
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { colour: cs.color, opacity: Number(cs.opacity), tag: el.tagName };
    };
    const glass = document.querySelector<HTMLElement>('.backdrop-blur-xl');
    return {
      wallpaper: getComputedStyle(document.querySelector('main')!).backgroundColor,
      fill: glass ? getComputedStyle(glass).backgroundColor : null,
      detail: ink(line(t => /^Battery \d+%$/.test(t))),
      // The state line is the control: same panel, same glass, but a `span`
      // rather than a `div`, so the ink rule already reaches it. Whatever it
      // gets is what this line should get too.
      subtitle: ink(line(t => t === 'Unlocked')),
    };
  });
}

test.describe("an expanded lock's battery reading", () => {
  test('is legible over a dark wallpaper', async ({ page }) => {
    await page.goto('/screenshots/fixtures/lock-battery-ink.html');
    await expect(page.getByText('Battery 100%')).toBeVisible();

    const report = await inkReport(page);
    expect(report.detail, 'the battery line should be on the panel').not.toBeNull();
    expect(report.fill, 'the tile should be painting glass').not.toBeNull();

    const wallpaper = parse(report.wallpaper);
    const tile = composite(parse(report.fill!), wallpaper);
    // Both alphas, multiplied. The two lines reach white-at-70% by different
    // routes — one is `rgba(…, .7)` at full opacity, the other `rgb(…)` under
    // `opacity: .7` — and reading only one of them would score them differently
    // for a difference that is not on the screen.
    const painted = (l: NonNullable<typeof report.detail>) => {
      const [r, g, b, alpha] = parse(l.colour);
      return composite([r, g, b, alpha * l.opacity], tile);
    };

    const detail = painted(report.detail!);
    const subtitle = painted(report.subtitle!);
    const detailContrast = contrast(detail, tile);

    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(
      path.join(OUT, `ink-${LABEL}.json`),
      JSON.stringify(
        {
          ...report,
          tileComposited: tile,
          detailContrast,
          subtitleContrast: contrast(subtitle, tile),
        },
        null,
        2,
      ),
    );
    await page.locator('[data-tile="lock"]').screenshot({ path: path.join(OUT, `lock-${LABEL}.png`) });

    // 4.5:1 is the WCAG AA floor for text this size. Before the fix this
    // measured 1.03 — the line and the tile under it were the same colour,
    // against 9.55 for the state line directly above it.
    expect(detailContrast, 'battery reading vs the tile it sits on').toBeGreaterThanOrEqual(4.5);

    // And it should not merely clear the floor by luck: it is the same kind of
    // secondary line as the state above it, so it should land on the same ink.
    // Compared as PAINTED pixels rather than as class or colour strings, for
    // the reason `painted` gives.
    for (const channel of [0, 1, 2]) {
      expect(
        Math.abs(detail[channel] - subtitle[channel]),
        `battery reading vs the state line, channel ${channel}`,
      ).toBeLessThanOrEqual(1);
    }
  });
});
