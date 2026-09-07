/**
 * The report sheet, on a phone.
 *
 * Drives the real sheet — the same one ⌥⇧R opens — with the reported-issues
 * list served from a route mock, so both tabs render with content rather than
 * an empty state. Captures what someone actually sees when they report
 * something, which is the only way to judge an affordance that lives in a
 * list.
 */
import { test, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const REPORTED_ISSUES = {
  page: 1,
  hasMore: true,
  issues: [
    {
      issueNumber: 71,
      title: 'Analytics draws a value for the outage window instead of a gap',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/71',
      labels: ['bug', 'issue-reporter'],
      createdAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 86_400_000).toISOString(),
      commentCount: 3,
    },
    {
      issueNumber: 68,
      title: 'Scene card keeps its running spinner after the scene finishes',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/68',
      labels: ['bug', 'issue-reporter'],
      createdAt: new Date(Date.now() - 9 * 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      commentCount: 0,
    },
    {
      issueNumber: 64,
      title: 'Left menu closes when a swipe starts on a scrolling row',
      state: 'closed',
      url: 'https://github.com/parob/homecast-cloud/issues/64',
      labels: ['bug', 'issue-reporter'],
      createdAt: new Date(Date.now() - 40 * 86_400_000).toISOString(),
      updatedAt: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      commentCount: 6,
    },
  ],
};

/**
 * Admin, because the sheet is admin-only — and a route mock for the reports
 * list, which the app fetches straight from the REST endpoint rather than
 * through GraphQL.
 *
 * Both are registered AFTER setupMocks so they win: Playwright tries the most
 * recently added route first, and anything not handled here falls back to the
 * general GraphQL mock.
 */
async function asAdminReporter(page: Page) {
  await setupMocks(page);

  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    if (route.request().method() !== 'POST' || !body?.query?.includes('GetMe')) {
      return route.fallback();
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { me: { ...MOCK_USER, isAdmin: true } } }),
    });
  });

  await page.route(/\/rest\/issue-report(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    // Filter the way the real endpoint does, so a screenshot of the Open tab
    // does not quietly show a closed issue.
    const state = new URL(route.request().url()).searchParams.get('state') ?? 'open';
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ...REPORTED_ISSUES,
        issues: REPORTED_ISSUES.issues.filter(
          (issue) => state === 'all' || issue.state === state,
        ),
      }),
    });
  });
}

/** Open the sheet the way a Mac or a desktop browser does. */
async function openReportSheet(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  // The screenshot is captured before the sheet renders, and rasterising the
  // DOM takes a moment on a large dashboard.
  await page.waitForTimeout(1500);
}

const sheet = (page: Page) => page.locator('[role="dialog"]');

test.use({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 2 });

test('report sheet — compose tab', async ({ page }) => {
  await asAdminReporter(page);
  await openReportSheet(page);
  await sheet(page).screenshot({ path: 'screenshots/output/report-sheet-new.png' });
});

test('report sheet — previous reports tab', async ({ page }) => {
  await asAdminReporter(page);
  await openReportSheet(page);
  await page.getByRole('tab', { name: 'Previous' }).click();
  await page.waitForTimeout(800);
  await sheet(page).screenshot({ path: 'screenshots/output/report-sheet-previous.png' });
});

test('report sheet — adding to an open issue', async ({ page }) => {
  await asAdminReporter(page);
  await openReportSheet(page);
  await page.getByRole('tab', { name: 'Previous' }).click();
  await page.getByRole('button', { name: 'Add this report to #71' }).click();
  await page.waitForTimeout(500);
  await sheet(page).screenshot({ path: 'screenshots/output/report-sheet-adding-to.png' });
});

test('report sheet — adding to an issue already marked fixed', async ({ page }) => {
  await asAdminReporter(page);
  await openReportSheet(page);
  await page.getByRole('tab', { name: 'Previous' }).click();
  await page.getByRole('button', { name: 'Fixed' }).click();
  await page.getByRole('button', { name: 'Add this report to #64' }).click();
  await page.waitForTimeout(500);
  await sheet(page).screenshot({ path: 'screenshots/output/report-sheet-adding-to-closed.png' });
});
