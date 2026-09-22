/**
 * homecast-cloud#181 — what the Previous list says about a report nobody has
 * opened yet. The rows are the real Open list as /rest/issue-report returned
 * it at 2026-09-22T00:04Z, labels and all.
 */
import { test, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const ago = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const REPORTED_ISSUES = {
  page: 1,
  hasMore: true,
  issues: [
    {
      issueNumber: 181,
      title: 'My issues don’t seem to be getting looked at',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/181',
      labels: ['bug', 'issue-reporter', 'app-homecast', 'fp-70e0032d04a6da07'],
      createdAt: ago(1), updatedAt: ago(1), commentCount: 0,
    },
    {
      issueNumber: 178,
      title: 'I don’t think the widgets change correctly based on the background darkness or lightness',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/178',
      labels: ['bug', 'issue-reporter', 'app-homecast', 'fp-2ce4500b48f052b0'],
      createdAt: ago(4), updatedAt: ago(1), commentCount: 1,
    },
    {
      issueNumber: 175,
      title: 'When I visit a page in the Mobile Web app and click on a room within a Home the content of the Rooms is scrolled up t…',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/175',
      labels: ['bug', 'issue-reporter', 'app-homecast', 'fp-cefd17ceb60c0a9e'],
      createdAt: ago(9), updatedAt: ago(1), commentCount: 2,
    },
    {
      issueNumber: 163,
      title: 'The spacing between the Home name and the back button in the top left doesn’t lineup between the web Mobile view and …',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/163',
      labels: ['bug', 'issue-reporter', 'app-homecast', 'claude-attempted', 'claude-pr-open', 'fp-da230e304503a8e5'],
      createdAt: ago(17), updatedAt: ago(6), commentCount: 5,
    },
    {
      issueNumber: 119,
      title: 'Pod handoffs are taking 9.8–20.3 seconds, and half of them are `rebalance` rather than affinity',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/119',
      labels: ['bug', 'claude-attempted'],
      createdAt: ago(240), updatedAt: ago(6), commentCount: 6,
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

test.use({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 2 });

test('previous reports — where each one stands', async ({ page }) => {
  await asAdminReporter(page);
  await page.goto('/portal');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await page.waitForTimeout(1200);
  await page.getByRole('tab', { name: 'Existing' }).click();
  await page.waitForTimeout(1000);
  await page.locator('[role="dialog"]').screenshot({
    path: process.env.SHOT_PATH || 'screenshots/output/issue-181-previous-status.png',
  });
});
