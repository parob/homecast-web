/**
 * homecast-cloud#188 — the Open list's word for a report that is waiting on
 * the reporter. The rows are the real Open list on 2026-10-24, labels and all:
 * a question (#228), a draft to try on the phone (#227), both at once (#222),
 * a decision (#214), and a plain proposed fix (#199) for contrast.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const REPORTED_ISSUES = {
  page: 1,
  hasMore: false,
  issues: [
    {
      issueNumber: 228,
      title: "System tray at top isn’t visible when analytics is opened (batter/time etc)",
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/228',
      labels: ['bug',  'issue-reporter',  'app-homecast',  'claude-attempted',  'fp-6bb48020452c7dbd',  'waiting-on-reporter'],
      createdAt: ago(240), updatedAt: ago(120), commentCount: 3,
    },
    {
      issueNumber: 227,
      title: "When the uploads on one of the Rooms can you close it up and then open it and it opens on a room the back button in t…",
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/227',
      labels: ['bug',  'issue-reporter',  'app-homecast',  'claude-attempted',  'claude-pr-open',  'fp-98045b56aba25287',  'needs-device-check'],
      createdAt: ago(240), updatedAt: ago(120), commentCount: 3,
    },
    {
      issueNumber: 222,
      title: "I can’t see how to create collections in the iOS native app there’s no way to create the collections",
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/222',
      labels: ['bug',  'issue-reporter',  'app-homecast',  'claude-attempted',  'claude-pr-open',  'fp-6562ea1e12e5f67c',  'waiting-on-reporter',  'needs-device-check'],
      createdAt: ago(240), updatedAt: ago(120), commentCount: 5,
    },
    {
      issueNumber: 214,
      title: "Hello,",
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/214',
      labels: ['bug',  'issue-reporter',  'app-homecast',  'claude-attempted',  'needs-human',  'fp-7f0003e70a4d6df0'],
      createdAt: ago(240), updatedAt: ago(120), commentCount: 4,
    },
    {
      issueNumber: 199,
      title: "The menus in the web mobile view don’t look the same as the menus in the native app - lets try make them match as clo…",
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/199',
      labels: ['enhancement',  'issue-reporter',  'app-homecast',  'claude-attempted',  'claude-pr-open',  'fp-86a271b27faef422'],
      createdAt: ago(1440), updatedAt: ago(720), commentCount: 4,
    },
  ],
};

async function asAdminReporter(page: Page) {
  await setupMocks(page);
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    if (route.request().method() !== 'POST' || !body?.query?.includes('GetMe')) return route.fallback();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { me: { ...MOCK_USER, isAdmin: true } } }),
    });
  });
  await page.route(/\/rest\/issue-report(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const state = new URL(route.request().url()).searchParams.get('state') ?? 'open';
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...REPORTED_ISSUES,
        issues: REPORTED_ISSUES.issues.filter((i) => state === 'all' || i.state === state),
      }),
    });
  });
}

// `BEFORE=1` captures the list as `main` renders it, against the stashed source.
const BEFORE = process.env.BEFORE === '1';

test.use({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2 });

test('reports waiting on the reporter say so', async ({ page }) => {
  await asAdminReporter(page);
  await page.goto('/portal');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  await page.getByRole('tab', { name: 'Existing' }).click();
  await page.waitForTimeout(1000);
  if (!BEFORE) {
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog.getByText('Needs your answer')).toHaveCount(2);
    await expect(dialog.getByText('Try on your phone')).toHaveCount(1);
    await expect(dialog.getByText('Needs your decision')).toHaveCount(1);
    await expect(dialog.getByText('Fix proposed')).toHaveCount(1);
  }
  await page.locator('[role="dialog"]').screenshot({
    path: process.env.SHOT_PATH || 'screenshots/output/issue-188-status-words.png',
  });
});
