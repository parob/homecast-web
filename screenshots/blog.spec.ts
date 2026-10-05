/**
 * The blog's app screenshots, captured from mock data.
 *
 * Each test writes a PNG to blog-output/<slug>/<name>.png. They are
 * converted to the WebP the posts reference by hand (cwebp/magick), because the
 * crop and compression are an editorial call, not a test outcome.
 */
import { test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupMocks, prepareDialogScreenshot } from './mocks';
import { HOME_ID } from './fixtures';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = (slug: string, name: string) => {
  const dir = path.join(__dirname, 'blog-output', slug);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${name}.png`);
};

async function openShareDialog(page: Page) {
  await page.goto('/portal');
  await page.waitForTimeout(2500);
  const homeBtn = page.locator('button').filter({ hasText: 'My Home' }).first();
  await homeBtn.click({ button: 'right', force: true });
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]').filter({ hasText: 'Share Home' }).click();
  await page.waitForTimeout(1200);
  return page.locator('[role="dialog"]').first();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cookie-consent', 'granted'));
  await setupMocks(page);
});

test('consent screen — the AI assistant post', async ({ page }) => {
  const inner = new URLSearchParams({
    client_id: 'claude-client-id',
    redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
    code_challenge: 'mock-challenge',
    code_challenge_method: 'S256',
    scope: 'mcp:read mcp:write',
    state: 'mock-state',
    resource: 'https://api.homecast.cloud/mcp',
    client_name: 'Claude',
  });
  await page.goto('/portal');
  await page.waitForTimeout(2000);
  await page.goto(`/oauth/consent?oauth_params=${encodeURIComponent(inner.toString())}`);
  await page.getByText('Select homes and permissions').waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
  const card = page.locator('div.rounded-xl, div.rounded-2xl, [class*="card"]').filter({ hasText: 'Select homes and permissions' }).last();
  await card.screenshot({ path: out('control-apple-home-from-claude-and-chatgpt', 'consent') });
});

test('analytics — a room, one panel per measure', async ({ page }) => {
  await page.goto('/analytics?room=Bedroom%202&mockHistory=big');
  await page.getByText('Temperature').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: out('apple-home-history-and-analytics', 'room') });
});

test('share dialog — members, public access and passcodes', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1700 });
  const dialog = await openShareDialog(page);
  await prepareDialogScreenshot(page);
  await dialog.screenshot({ path: out('share-apple-home-with-android-family', 'share-dialog'), omitBackground: true });
});

test('add passcode — limited access with a weekly window', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1700 });
  const share = await openShareDialog(page);
  // The + beside the Passcodes heading is the first plus in the dialog.
  await share.getByRole('button').filter({ has: page.locator('svg.lucide-plus') }).first().click();
  await page.waitForTimeout(700);
  await page.getByPlaceholder('e.g., Guest access').fill('Cleaner');
  const code = page.getByLabel(/^passcode$/i).first();
  if (await code.isVisible()) await code.fill('4821');
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.getByRole('switch').first().click();
  await page.waitForTimeout(500);
  const addWindow = page.getByRole('button', { name: /add window/i }).first();
  if (await addWindow.isVisible()) { await addWindow.click(); await page.waitForTimeout(500); }
  await prepareDialogScreenshot(page);
  await dialog.screenshot({ path: out('share-apple-home-with-android-family', 'passcode'), omitBackground: true });
});

test('dashboard — the roundup cover', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/portal');
  await page.waitForTimeout(3000);
  const myHome = page.locator('button').filter({ hasText: 'My Home' }).first();
  if (await myHome.isVisible()) { await myHome.click({ force: true }); await page.waitForTimeout(2000); }
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.screenshot({ path: out('whats-new-scenes-in-rooms-long-press-edit', 'dashboard') });
});

// ── The two automations from the train/umbrella post, laid out for the page ──
//
// Built as saved automations (engine JSON plus uiState) rather than by clicking
// the editor, so the layout — positions, connections, sticky notes — is exact
// and repeatable. The code and URLs are read from the post itself.

const postPath = path.join(__dirname, '../content/blog/apple-home-when-to-leave-light.md');
const post = fs.readFileSync(postPath, 'utf-8');
const snippet = (name: string) => post.match(new RegExp(`<!-- snippet: ${name} -->\\s*\`\`\`[a-z]*\\n([\\s\\S]*?)\`\`\``))![1];
const LAMP = 'acc-lr-lamp';
const expr = (node: string, field: string) => `{{ nodes['${node}'].data.${field} }}`;
const edge = (source: string, target: string, sourceHandle = 'output') =>
  ({ id: `e-${source}-${target}`, source, target, sourceHandle, targetHandle: 'input' });
const meta = { createdAt: '2026-10-05T07:00:00Z', updatedAt: '2026-10-05T07:00:00Z', triggerCount: 0 };
const set = (id: string, characteristicType: string, value: unknown) =>
  ({ type: 'set_characteristic', id, accessoryId: LAMP, characteristicType, value });

const trainLight = {
  id: 'auto-train-light', name: 'Train light', homeId: HOME_ID, enabled: true, mode: 'single',
  triggers: [{ type: 'time_pattern', id: 'every-minute', minutes: '1' }],
  conditions: { operator: 'and', conditions: [] },
  actions: [{
    type: 'if_then_else', id: 'commute-hours',
    condition: { operator: 'and', conditions: [{ type: 'template', id: 'commute-hours-expr', expression: snippet('commute-hours').trim() }] },
    then: [
      { type: 'fire_webhook', id: 'journeys', method: 'GET', url: post.match(/https:\/\/api\.tfl\.gov\.uk\/Journey\/JourneyResults\/[^\s`]+/)![0] },
      { type: 'code', id: 'decide', code: snippet('train-light') },
      set('lamp-on', 'power_state', true),
      set('lamp-hue', 'hue', expr('decide', 'hue')),
      set('lamp-saturation', 'saturation', expr('decide', 'saturation')),
      set('lamp-brightness', 'brightness', expr('decide', 'brightness')),
    ],
    else: [],
  }],
  metadata: meta,
  uiState: {
    nodePositions: {
      'every-minute': { x: 0, y: 0 }, 'commute-hours': { x: 0, y: 130 }, journeys: { x: 0, y: 280 }, decide: { x: 0, y: 410 },
      'lamp-on': { x: 340, y: 520 }, 'lamp-hue': { x: 340, y: 630 }, 'lamp-saturation': { x: 340, y: 740 }, 'lamp-brightness': { x: 340, y: 850 },
    },
    edges: [
      edge('every-minute', 'commute-hours'), edge('commute-hours', 'journeys', 'true'), edge('journeys', 'decide'),
      edge('decide', 'lamp-on'), edge('lamp-on', 'lamp-hue'), edge('lamp-hue', 'lamp-saturation'), edge('lamp-saturation', 'lamp-brightness'),
    ],
    stickyNotes: [
      { id: 'note-when', position: { x: -330, y: 10 }, width: 290, height: 170, text: '1 · WHEN\n\nEvery minute, but only on weekday mornings from 7 to 9. Outside that window nothing is fetched and the lamp is left alone.' },
      { id: 'note-ask', position: { x: -330, y: 255 }, width: 290, height: 125, text: '2 · ASK TFL\n\nTfL journey times from Sevenoaks to Blackfriars, including changes.' },
      { id: 'note-decide', position: { x: -330, y: 400 }, width: 290, height: 135, text: '3 · DECIDE\n\nKeep 2 min on the platform. Green: walk (7 min). Purple: walk quickly (5 min). Amber: wait. Red: check trains.' },
      { id: 'note-show', position: { x: 680, y: 640 }, width: 260, height: 130, text: '4 · SHOW IT\n\nTurn the lamp on, then set its colour and brightness from the Code node.' },
    ],
  },
};

const umbrellaLight = {
  id: 'auto-umbrella-light', name: 'Umbrella light', homeId: HOME_ID, enabled: true, mode: 'single',
  triggers: [{ type: 'time', id: 'half-seven', at: '07:30', weekdays: [1, 2, 3, 4, 5] }],
  conditions: { operator: 'and', conditions: [] },
  actions: [
    { type: 'fire_webhook', id: 'forecast', method: 'GET', url: post.match(/https:\/\/api\.open-meteo\.com\/[^\s`]+/)![0] },
    { type: 'code', id: 'wettest', code: snippet('umbrella') },
    {
      type: 'if_then_else', id: 'rain',
      condition: { operator: 'and', conditions: [{ type: 'template', id: 'rain-expr', expression: "nodes['wettest'].data.rain" }] },
      then: [
        { type: 'notify', id: 'tell-me', message: `Take an umbrella — ${expr('wettest', 'chance')}% chance of rain around ${expr('wettest', 'at')}` },
        set('umbrella-on', 'power_state', true),
        set('umbrella-hue', 'hue', 240),
        set('umbrella-saturation', 'saturation', 100),
      ],
      else: [],
    },
  ],
  metadata: meta,
  uiState: {
    nodePositions: {
      'half-seven': { x: 0, y: 0 }, forecast: { x: 0, y: 130 }, wettest: { x: 0, y: 260 }, rain: { x: 0, y: 390 },
      'tell-me': { x: 340, y: 510 }, 'umbrella-on': { x: 340, y: 620 }, 'umbrella-hue': { x: 340, y: 730 }, 'umbrella-saturation': { x: 340, y: 840 },
    },
    edges: [
      edge('half-seven', 'forecast'), edge('forecast', 'wettest'), edge('wettest', 'rain'),
      edge('rain', 'tell-me', 'true'), edge('tell-me', 'umbrella-on'), edge('umbrella-on', 'umbrella-hue'), edge('umbrella-hue', 'umbrella-saturation'),
    ],
    stickyNotes: [
      { id: 'note-morning', position: { x: -330, y: 0 }, width: 290, height: 125, text: '1 · WHEN\n\nWeekdays at 7:30, once, before you leave.' },
      { id: 'note-forecast', position: { x: -330, y: 140 }, width: 290, height: 150, text: '2 · READ THE FORECAST\n\nOpen-Meteo gives the chance of rain for every hour today. The Code node finds the wettest hour between 8am and 7pm.' },
      { id: 'note-rain', position: { x: -330, y: 390 }, width: 290, height: 90, text: "3 · ONLY IF IT'S WET\n\nA 50% chance or more." },
      { id: 'note-warn', position: { x: 680, y: 620 }, width: 260, height: 110, text: '4 · WARN ME\n\nA notification on my phone, and the lamp by the door turns blue.' },
    ],
  },
};

const asEntity = (a: { id: string; name: string }) => ({
  id: `se-${a.id}`, entityType: 'hc_automation', entityId: a.id, parentId: HOME_ID,
  dataJson: JSON.stringify(a), updatedAt: '2026-10-05T07:00:00Z',
});

async function openAutomation(page: Page, name: string) {
  // Registered after setupMocks, so it answers HcAutomations first.
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const body = route.request().postDataJSON?.() as { query?: string; operationName?: string } | undefined;
    const op = body?.operationName ?? body?.query?.match(/(?:query|mutation)\s+(\w+)/)?.[1];
    if (op !== 'HcAutomations') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: { hcAutomations: [asEntity(trainLight), asEntity(umbrellaLight)] } }) });
  });
  await page.setViewportSize({ width: 1500, height: 940 });
  await page.goto('/portal');
  await page.waitForTimeout(2500);
  await page.locator('[data-tour="header-menu"]').click();
  await page.getByRole('menuitem', { name: 'Automations', exact: true }).click();
  await page.getByText(name, { exact: true }).first().click();
  await page.getByTestId('automation-editor').waitFor();
  await page.waitForTimeout(1500);
  // Fit the whole automation, notes included, then hide the canvas chrome.
  await page.getByRole('button', { name: /fit view/i }).first().click().catch(() => {});
  await page.waitForTimeout(800);
  await page.addStyleTag({ content: '.react-flow__minimap, .react-flow__controls, .react-flow__attribution { display: none !important; }' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.waitForTimeout(300);
}

for (const [name, file] of [['Train light', 'editor-train-light'], ['Umbrella light', 'editor-umbrella-light']] as const) {
  test(`editor — ${name}, laid out with notes`, async ({ page }) => {
    await openAutomation(page, name);
    await page.locator('.react-flow').first().screenshot({ path: out('apple-home-when-to-leave-light', file) });
  });
}
