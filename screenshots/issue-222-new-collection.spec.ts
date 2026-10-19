/**
 * parob/homecast-cloud#222: under the iOS app's native bar there was no way to
 * create a collection. The only "Create Collection" control lives in the web
 * drawer, which the native bar has no route to, and the native ☰/title menu
 * listed collections only once one existed.
 *
 * The page publishes that menu to the shell as `navigation`; this checks it
 * always carries a New Collection item, and that the item opens the dialog.
 *
 *   npx playwright test issue-222-new-collection.spec.ts --project=iphone-screenshots
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings } from './mocks';
import { HOME_ID } from './fixtures';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** What the stubbed shell records, and the page's half of the bridge. */
type Posted = { navigation?: { id: string; items: { id: string }[] }[] };
type ShellWindow = Window & {
  __posted: Posted[];
  __homecastNativeHeader: { navigate: (id: string) => void };
  webkit?: unknown;
  isHomecastApp?: boolean;
  isHomecastIOSApp?: boolean;
  homecastNativeHeaderAvailable?: boolean;
  homecastNativeHeaderEnabled?: boolean;
};

const LABEL = process.env.ISSUE_222_LABEL || 'after';
const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'output', 'issue-222');

test.use({
  viewport: { width: 440, height: 956 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.6.1 Mobile/15E148 Safari/604.1',
});

async function openInNativeShell(page: Page) {
  overrideSettings({ homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  await setupMocks(page);
  // No collections yet — the reporter's case: the one where there was
  // nothing to tap at all. Registered after setupMocks, so it answers first.
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const body = route.request().postDataJSON?.() ?? null;
    if (body?.operationName === 'GetCollections') {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: { collections: [] } }) });
      return;
    }
    await route.fallback();
  });
  await page.addInitScript(() => {
    const w = window as unknown as ShellWindow;
    w.__posted = [];
    w.isHomecastApp = true;
    w.isHomecastIOSApp = true;
    w.homecastNativeHeaderAvailable = true;
    w.homecastNativeHeaderEnabled = true;
    w.webkit = { messageHandlers: { homecast: { postMessage: (m: Posted) => w.__posted.push(m) } } };
  });
  await page.goto(`/portal?home=${HOME_ID}`);
  // The page's own header is off under the native bar, so the dashboard's
  // usual readiness marker never shows; wait for the menu to be published.
  await page.waitForFunction(() => (window as unknown as ShellWindow).__posted.some((m) => Array.isArray(m.navigation)), null, { timeout: 20000 });
  await page.waitForTimeout(1500);
}

/** The Collections section of the last `navigation` the page sent the shell. */
async function publishedCollections(page: Page) {
  return page.evaluate(() => {
    const navs = (window as unknown as ShellWindow).__posted.filter((m) => Array.isArray(m.navigation));
    const last = navs[navs.length - 1]?.navigation ?? [];
    return last.find((s) => s.id === 'collections')?.items.map((i) => i.id) ?? null;
  });
}

test('the native menu always offers New Collection, and it opens the dialog', async ({ page }) => {
  await openInNativeShell(page);
  const items = await publishedCollections(page);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `navigation-${LABEL}.json`), JSON.stringify(items, null, 2));
  console.log(`collections section (${LABEL}):`, JSON.stringify(items));
  expect(items).toEqual(['newcollection']);

  // What a tap on the native item does: the shell calls navigate(item.id).
  await page.evaluate(() => (window as unknown as ShellWindow).__homecastNativeHeader.navigate('newcollection'));
  await expect(page.getByRole('dialog').getByText('Create Collection').first()).toBeVisible();
  await page.screenshot({ path: path.join(OUT, `dialog-${LABEL}.png`) });
});
