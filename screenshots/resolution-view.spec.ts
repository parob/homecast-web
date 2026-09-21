/**
 * The fix for a reported issue, seen from the Feedback sheet.
 *
 * Drives the real sheet on a phone with the reported-issues list and one
 * resolution served from route mocks — the same shape the server answers with
 * for homecast-cloud#167, pictures included. Captures the two things this
 * feature adds: the Fix button on a row that has one (and its absence on a row
 * that does not), and the resolution view itself — the picture, the line, the
 * pull request.
 *
 * The evidence images are served from disk rather than fetched, so the capture
 * does not depend on the network and shows the same pixels every run.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const GCS = 'https://storage.googleapis.com/parob-issue-reporter-attachments/a';
const PAIR = `${GCS}/66e2beead872436cbed44c6b6599a70b/a6fc7f6e7a7a466d99c5b25a7f94ab43.png`;
const REPORT = `${GCS}/db152ab46a8d493caceb8283f3b39ed2/b6804c6184a84419b3b7129ac143a19d.jpg`;

const REPORTED_ISSUES = {
  page: 1,
  hasMore: false,
  issues: [
    {
      issueNumber: 167,
      title: "I can't read the battery font on the screen",
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/167',
      labels: ['bug', 'issue-reporter', 'claude-attempted', 'claude-pr-open'],
      createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      commentCount: 3,
    },
    {
      issueNumber: 170,
      title: 'Nobody has looked at this one yet',
      state: 'open',
      url: 'https://github.com/parob/homecast-cloud/issues/170',
      labels: ['bug', 'issue-reporter'],
      createdAt: new Date(Date.now() - 3_600_000).toISOString(),
      updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
      commentCount: 0,
    },
  ],
};

const RESOLUTION = {
  issueNumber: 167,
  title: "I can't read the battery font on the screen",
  state: 'open',
  url: 'https://github.com/parob/homecast-cloud/issues/167',
  labels: ['bug', 'issue-reporter', 'claude-attempted', 'claude-pr-open'],
  summary: "the battery line now takes the tile's white ink, 1.03 : 1 → 9.55 : 1",
  reach: 'web',
  primary: { repo: 'parob/homecast-web', number: 208, url: 'https://github.com/parob/homecast-web/pull/208' },
  prs: [{ repo: 'parob/homecast-web', number: 208, url: 'https://github.com/parob/homecast-web/pull/208' }],
  evidence: [{ url: PAIR, alt: 'Before: Battery 100% invisible at 1.03:1. After: legible at 9.55:1.' }],
  reported: [{ url: REPORT, alt: 'screenshot.jpg' }],
  // Merging is set up on this server and the one PR is ready: what the
  // button looks like, and what it says before it acts.
  merge: {
    configured: true,
    servingSha: '4ae7930',
    plan: [{
      repo: 'parob/homecast-web', number: 208, url: 'https://github.com/parob/homecast-web/pull/208',
      title: "The battery line on an expanded lock takes the tile's ink", state: 'open', merged: false,
      mergeSha: null, mergeable: true, checks: 'success', action: 'merge', reason: null,
    }],
  },
};

/** What the server answers once that PR has merged. */
const MERGED = {
  configured: true,
  servingSha: '4ae7930',
  merged: [{ url: 'https://github.com/parob/homecast-web/pull/208', sha: 'f8409182628dcd0d' }],
  plan: [{ ...RESOLUTION.merge.plan[0], state: 'closed', merged: true, mergeSha: 'f8409182628dcd0d', action: 'merged' }],
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.resolve(HERE, 'evidence/issue-169/mock');

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

  await page.route(/\/rest\/issue-report\/167\/resolution$/, async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(RESOLUTION),
    });
  });

  await page.route(/\/rest\/issue-report\/167\/resolution\/merge$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(MERGED),
    });
  });

  await page.route(/\/rest\/issue-report(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(REPORTED_ISSUES),
    });
  });

  await page.route(PAIR, (route) => route.fulfill({ path: path.join(IMAGES, 'pair.png') }));
  await page.route(REPORT, (route) => route.fulfill({ path: path.join(IMAGES, 'report.jpg') }));
}

async function openPrevious(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Previous' }).click();
  await page.getByText(/battery font/).waitFor();
  await page.waitForTimeout(800);
}

// `BEFORE=1` captures the list as `main` renders it — no button on any row —
// for the before/after pair in evidence/issue-169. Run it against the stashed
// source; on this branch the assertions below fail, which is the point.
const BEFORE = process.env.BEFORE === '1';

const sheet = (page: Page) => page.locator('[role="dialog"]');

test.use({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 2 });

test('a row with a fix offers it; a row without one does not', async ({ page }) => {
  await asAdminReporter(page);
  await openPrevious(page);

  if (BEFORE) {
    await sheet(page).screenshot({ path: 'screenshots/output/resolution-row-before.png' });
    return;
  }
  await expect(page.getByRole('button', { name: 'See the resolution for #167' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'See the resolution for #170' })).toHaveCount(0);

  await sheet(page).screenshot({ path: 'screenshots/output/resolution-row.png' });
});

test('the resolution view shows the picture, the line and the pull request', async ({ page }) => {
  await asAdminReporter(page);
  await openPrevious(page);
  await page.getByRole('button', { name: 'See the resolution for #167' }).click();

  const picture = page.getByRole('img', { name: /Before: Battery 100% invisible/ });
  await expect(picture).toBeVisible();
  // Rendered, not a broken image: a natural width means the bytes arrived.
  await expect.poll(() => picture.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText("the battery line now takes the tile's white ink", { exact: false })).toBeVisible();
  // `^`: the Merge button below the list carries the same PR in its name.
  await expect(page.getByRole('button', { name: /^homecast-web#208/ })).toBeVisible();
  await page.waitForTimeout(500);

  await sheet(page).screenshot({ path: 'screenshots/output/resolution-view.png' });
});

test('Merge names what it merges, asks once, and shows what happened', async ({ page }) => {
  await asAdminReporter(page);
  await openPrevious(page);
  await page.getByRole('button', { name: 'See the resolution for #167' }).click();

  const merge = page.getByRole('button', { name: 'Merge homecast-web#208' });
  await expect(merge).toBeVisible();
  await expect(page.getByRole('button', { name: /^homecast-web#208/ })).toContainText('Ready');
  await merge.click();

  // The confirmation is the gate: it says what ships and where.
  const confirm = page.getByRole('button', { name: 'Confirm merge' });
  await expect(confirm).toBeVisible();
  await expect(page.getByText(/Merges homecast-web#208 to main/)).toContainText('ships to production');
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: 'screenshots/output/resolution-merge-confirm.png' });

  await confirm.click();
  await expect(page.getByText('Merged homecast-web#208.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^homecast-web#208/ })).toContainText('Merged');
  await expect(page.getByRole('button', { name: /^Merge / })).toHaveCount(0);
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: 'screenshots/output/resolution-merged.png' });
});
