/**
 * The iOS app's native menus, read from what the page hands the shell.
 *
 * On an iPhone the title menu (homes, rooms, collections) and the ⋯ menu are
 * UIKit, drawn by `NativeHeaderBar.swift` from `header.setState` messages, and
 * the page's own header row is hidden. So a screenshot of the page cannot show
 * what those menus contain — but the messages can, and `native-shell.ts`
 * records them, merges them the way Swift does and builds each menu the way
 * UIKit would. A pick is delivered back with the same script Swift evaluates.
 *
 *   npx playwright test native-header-menu.ios.spec.ts --project=iphone-screenshots
 *   npx playwright test native-header-menu.ios.spec.ts --project=iphone-webkit   # WebKit, if installed
 *
 * The `*.ios.spec.ts` name is what puts a spec in the `iphone-webkit` project.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks, overrideSettings, overrideEntityLayouts } from './mocks';
import { HOME_ID } from './fixtures';
import { installNativeShell, IPHONE_APP, type NativeShell } from './native-shell';

test.use(IPHONE_APP);

/**
 * Open the dashboard inside the fake shell and wait for the bar to be handed
 * its state. Not `waitForDashboard`: that waits for the web ⋯, which is hidden
 * here — exactly one of the two headers may be on screen.
 */
async function openInShell(page: Page, beforeGoto?: () => Promise<void>): Promise<NativeShell> {
  overrideSettings({ theme: 'dark', homeOrder: [HOME_ID], lastView: { type: 'home', homeId: HOME_ID } });
  overrideEntityLayouts({});
  const shell = await installNativeShell(page);
  await setupMocks(page);
  await beforeGoto?.();
  await page.goto(`/portal?home=${HOME_ID}`);
  // `covered` starts true in Swift and is cleared by the page once its header
  // has mounted; rooms arrive with the home's data.
  await expect.poll(async () => {
    const h = await shell.header();
    return { title: h.title, covered: h.covered, rooms: h.navigation.some((s) => s.id === 'rooms') };
  }, { timeout: 20_000 }).toEqual({ title: 'My Home', covered: false, rooms: true });
  return shell;
}

const labels = (items: Array<{ label: string }>) => items.map((i) => i.label);

test.describe('native header menus', () => {
  test('the bar is handed the home, its homes, rooms, collections and ⋯ menu', async ({ page }) => {
    const shell = await openInShell(page);

    // The handshake: the page said it was ready, the shell answered with its
    // insets, and the page now pads itself by the band instead of drawing a
    // header — the web ⋯ is laid out but invisible.
    expect(await shell.messages({ action: 'header.ready' })).toHaveLength(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--native-header-inset'))).toBe('168px');
    await expect(page.locator('[data-native-header="overflow"]')).toBeHidden();

    const header = await shell.header();
    expect(header).toMatchObject({ enabled: true, title: 'My Home', heading: '', largeTitle: true, showMenu: true, currentHomeId: HOME_ID });

    const title = (await shell.titleMenu())!;
    expect(title.homes.map((h) => h.name).sort()).toEqual(['Beach House', 'My Home']);
    expect(title.homes.find((h) => h.selected)?.name).toBe('My Home');
    const rooms = title.sections.find((s) => s.id === 'rooms')!;
    expect(labels(rooms.items)).toEqual(expect.arrayContaining(['All Rooms', 'Living Room', 'Bedroom', 'Kitchen']));
    expect(rooms.items.find((i) => i.selected)?.label).toBe('All Rooms');
    const collections = title.sections.find((s) => s.id === 'collections')!;
    expect(collections.title).toBe('Collections');
    // The collections themselves, by id; the section may carry other items
    // (a New Collection action, for one).
    expect(labels(collections.items.filter((i) => i.id.startsWith('collection:')))).toEqual(['All Lights', 'Bedtime']);

    const overflow = (await shell.overflowMenu())!;
    const home = overflow.find((s) => s.id === 'home')!;
    expect(home.title).toBe('My Home');
    expect(labels(home.items)).toEqual(expect.arrayContaining(['Automations', 'Share', 'Analytics', 'Background']));
    expect(labels(overflow.flatMap((s) => s.items))).toEqual(expect.arrayContaining(['Edit Layout', 'Settings', 'Sign Out']));
  });

  test('a pick in a native menu drives the page', async ({ page }) => {
    const shell = await openInShell(page);

    // Title menu → a room: the page opens it and publishes the room as the
    // heading (the bar keeps the home's name as its title). The page draws no
    // heading of its own here — the band above the tiles is left for UIKit —
    // so the page's half is checked by its own state, the URL.
    const bedroom = (await shell.findMenuItem(/^Bedroom$/))!;
    expect(bedroom).toMatchObject({ menu: 'title', id: 'room:room-bedroom' });
    expect(await shell.choose(bedroom)).toBe(true);
    await expect(page).toHaveURL(/[?&]room=room-bedroom\b/);
    await expect.poll(async () => (await shell.header()).heading).toBe('Bedroom');
    const header = await shell.header();
    expect(header.title).toBe('My Home');
    expect(header.navigation.find((s) => s.id === 'rooms')?.items.find((i) => i.selected)?.label).toBe('Bedroom');

    // ⋯ → Settings: a dialog covers the page, and the bar is told to step aside.
    const settings = (await shell.findMenuItem(/^Settings$/))!;
    expect(settings).toMatchObject({ menu: 'overflow', id: 'general:settings' });
    await shell.choose(settings);
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect.poll(async () => (await shell.header()).covered).toBe(true);
  });
});

/**
 * parob/homecast-cloud#222: "I can't see how to create collections in the iOS
 * native app".
 *
 * The page's only route to `CreateCollectionDialog` is the "Create Collection"
 * control in the web drawer (`CollectionList`), and under the native bar the
 * drawer is unreachable: the bar has no leading button
 * (`NativeHeaderBar.swift`: `navigationItem.leftBarButtonItem = nil`) and the
 * page sends no item that opens it. The title menu's Collections section is
 * only built when `allCollections.length > 0` (`Dashboard.tsx`), and the ⋯
 * menu has no collection item at all. With zero collections there is no
 * collection anywhere in the native chrome, let alone a way to make one.
 *
 * The reproduction is `test.fail`: it is EXPECTED to fail today, which Playwright
 * reports as a pass, so CI stays green while the bug is on record. When a fix
 * makes it pass, Playwright reports "expected to fail, but passed" and the run
 * goes red — delete `.fail` then. The check is deliberately indifferent to
 * where the fix puts the item (title menu or ⋯) or what it is called (New / Add
 * / Create Collection); it asks only that picking it opens the dialog.
 *
 * A `test.fail` also "passes" if its setup breaks, so the first test proves
 * the setup — zero collections, and the native menus published — on its own.
 */
test.describe('parob/homecast-cloud#222: creating a collection from the native menu', () => {
  /** The same mocks, minus every collection. Registered last, so it is asked first. */
  const withoutCollections = (page: Page) => () => page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const body = route.request().postDataJSON() as { operationName?: string; query?: string; variables?: { entityType?: string } } | null;
    const op = body?.operationName ?? body?.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1];
    if (op === 'GetCollections') return route.fulfill({ json: { data: { collections: [] } } });
    if (op === 'GetStoredEntities' && body?.variables?.entityType === 'collection') {
      return route.fulfill({ json: { data: { storedEntities: [] } } });
    }
    return route.fallback();
  });

  test('setup: no collections, and the native menus are published', async ({ page }) => {
    const shell = await openInShell(page, withoutCollections(page));
    const title = (await shell.titleMenu())!;
    const ids = title.sections.flatMap((s) => s.items).map((i) => i.id);
    expect(ids.filter((id) => id.startsWith('collection'))).toEqual([]);
    expect(ids).toContain('home');
    expect(await shell.overflowMenu()).not.toBeNull();
  });

  test.fail('with zero collections, the native menu offers a way to create one', {
    annotation: { type: 'issue', description: 'https://github.com/parob/homecast-cloud/issues/222' },
  }, async ({ page }) => {
    const shell = await openInShell(page, withoutCollections(page));
    const create = await shell.findMenuItem(/\b(new|add|create)\b.*\bcollection\b/i);
    expect(create, 'an item in the title menu or ⋯ menu that creates a collection').not.toBeNull();
    await shell.choose(create!);
    await expect(page.getByRole('dialog').getByText('Create Collection', { exact: true })).toBeVisible();
  });
});
