/**
 * Saying something back from the issue's screen, and choosing who hears it.
 *
 * The same mocked resolution the rest of the Fix view is captured against,
 * with the one key that turns the field on. Two things this has to show, both
 * of which are sentences rather than controls: that the pull request is the
 * fast door and the issue the slow one, and that exactly one pull request
 * receives the comment while the others are only named in it.
 *
 * `BEFORE=1` captures the same screen as `main` renders it — no field at all,
 * which is also what today's server produces, since it sends no `feedback`
 * key. Run it against the stashed source for the before/after pair.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const GCS = 'https://storage.googleapis.com/parob-issue-reporter-attachments/a';
const PAIR = `${GCS}/66e2beead872436cbed44c6b6599a70b/a6fc7f6e7a7a466d99c5b25a7f94ab43.png`;
const REPORT = `${GCS}/db152ab46a8d493caceb8283f3b39ed2/b6804c6184a84419b3b7129ac143a19d.jpg`;

const CLOUD = { repo: 'parob/homecast-cloud', number: 180, url: 'https://github.com/parob/homecast-cloud/pull/180' };
const WEB = { repo: 'parob/homecast-web', number: 217, url: 'https://github.com/parob/homecast-web/pull/217' };

const REPORTED_ISSUES = {
  page: 1,
  hasMore: false,
  issues: [{
    issueNumber: 179,
    title: 'Feedback with a target from the Issues screen',
    state: 'open',
    url: 'https://github.com/parob/homecast-cloud/issues/179',
    labels: ['enhancement', 'issue-reporter', 'claude-attempted', 'claude-pr-open'],
    createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 3_600_000).toISOString(),
    commentCount: 2,
  }],
};

const planEntry = (pr: typeof CLOUD, title: string) => ({
  ...pr, title, state: 'open', merged: false, mergeSha: null, mergeable: true,
  checks: 'success', action: 'merge', reason: null,
});

const RESOLUTION = {
  issueNumber: 179,
  title: 'Feedback with a target from the Issues screen',
  state: 'open',
  url: 'https://github.com/parob/homecast-cloud/issues/179',
  labels: ['enhancement', 'issue-reporter', 'claude-attempted', 'claude-pr-open'],
  summary: 'Feedback from this screen reaches one pull request, or the issue.',
  reach: 'web',
  primary: CLOUD,
  prs: [CLOUD, WEB],
  evidence: [{ url: PAIR, alt: 'Before: no way to say anything back. After: a field with a target.' }],
  reported: [{ url: REPORT, alt: 'screenshot.jpg' }],
  reportedText: 'From an issue’s screen in the app, write feedback and choose where it goes.',
  createdAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  merge: {
    configured: true,
    servingSha: '4ae7930',
    plan: [
      planEntry(CLOUD, 'Feedback from the app reaches one pull request, or the issue'),
      { ...planEntry(WEB, 'A field on the issue screen, with a target'), action: 'wait_deploy',
        reason: 'homecast-cloud#180 is merged but not serving yet — the server must carry it first' },
    ],
  },
  feedback: { configured: true },
};

const HERE = path.dirname(fileURLToPath(import.meta.url));
const IMAGES = path.resolve(HERE, 'evidence/issue-169/mock');

// `main` ignores the key, so a run against it shows the screen as it is today.
const BEFORE = process.env.BEFORE === '1';

async function asAdminReporter(page: Page) {
  await setupMocks(page);

  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:8080)\/?$/, async (route) => {
    const body = route.request().postDataJSON() as { query?: string } | null;
    if (route.request().method() !== 'POST' || !body?.query?.includes('GetMe')) {
      return route.fallback();
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ data: { me: { ...MOCK_USER, isAdmin: true } } }),
    });
  });

  await page.route(/\/rest\/issue-report\/179\/resolution$/, async (route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(RESOLUTION),
    });
  });

  await page.route(/\/rest\/issue-report\/179\/resolution\/feedback$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const sent = route.request().postDataJSON() as { target: string };
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(sent.target === 'issue'
        ? { posted: true, target: 'issue', on: RESOLUTION.url, comment: `${RESOLUTION.url}#issuecomment-2` }
        : { posted: true, target: 'pr', on: CLOUD.url, comment: `${CLOUD.url}#issuecomment-1`, named: [WEB.url] }),
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

async function openIssue(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  await page.locator('[role="dialog"]').waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Existing' }).click();
  await page.getByText(/Feedback with a target/).first().waitFor();
  await page.getByRole('button', { name: 'Open #179' }).click();
  await page.getByRole('heading', { name: 'On GitHub' }).waitFor();
  await page.waitForTimeout(600);
}

const sheet = (page: Page) => page.locator('[role="dialog"]');

test.use({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 2 });

test('the field, its two doors, and what each one costs', async ({ page }) => {
  await asAdminReporter(page);
  await openIssue(page);
  // Both halves of the pair show the end of the screen, which is where the
  // difference is: on `main` it stops at the GitHub links.
  await sheet(page).getByRole('heading', { name: BEFORE ? 'On GitHub' : 'Send feedback' })
    .scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  if (BEFORE) {
    await sheet(page).screenshot({ path: 'screenshots/output/feedback-before.png' });
    return;
  }

  const toPr = page.getByRole('radio', { name: /homecast-cloud#180/ });
  const toIssue = page.getByRole('radio', { name: /Issue #179/ });
  await expect(toPr).toHaveAttribute('aria-checked', 'true');
  await expect(toIssue).toHaveAttribute('aria-checked', 'false');
  await expect(toPr).toContainText('Picked up straight away');
  await expect(toIssue).toContainText('Next sweep');

  // One pull request gets it; the other is named, not commented on.
  await expect(page.getByText(/Goes on homecast-cloud#180 only/)).toContainText('homecast-web#217');

  await page.getByRole('textbox', { name: 'Your feedback' })
    .fill('The selector is right, but the sent state should keep the address.');
  await page.waitForTimeout(400);
  await sheet(page).screenshot({ path: 'screenshots/output/feedback-after.png' });
});

test('sending says where the words landed, and which pull requests were only named', async ({ page }) => {
  test.skip(BEFORE, 'nothing to send on main');
  await asAdminReporter(page);
  await openIssue(page);

  await page.getByRole('textbox', { name: 'Your feedback' }).fill('Still wrong on a phone.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  await expect(page.getByText(/Sent to homecast-cloud#180 — it gets picked up straight away/)).toBeVisible();
  await expect(page.getByText(/names homecast-web#217 as part of the same fix/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Open The comment on GitHub/ }))
    .toContainText('https://github.com/parob/homecast-cloud/pull/180#issuecomment-1');
  await page.waitForTimeout(400);
  await sheet(page).screenshot({ path: 'screenshots/output/feedback-sent.png' });
});

test('choosing the issue says it waits for the sweep, and sends there', async ({ page }) => {
  test.skip(BEFORE, 'nothing to choose on main');
  await asAdminReporter(page);
  await openIssue(page);

  await page.getByRole('radio', { name: /Issue #179/ }).click();
  await expect(page.getByText(/Goes on the report itself/)).toBeVisible();
  await page.getByRole('textbox', { name: 'Your feedback' }).fill('This is not the bug I filed.');
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: 'screenshots/output/feedback-to-issue.png' });

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText(/Sent to issue #179 — it gets picked up on the next sweep, about a day/)).toBeVisible();
});
