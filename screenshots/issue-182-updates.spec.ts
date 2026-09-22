/**
 * What has been said about a report, on the issue screen.
 *
 * homecast-cloud#182: an answer written to the reporter — a diagnosis, a
 * reason, and a question put to them — reached the app as one summary line.
 * This drives the real sheet on a phone with the real conversation from
 * homecast-cloud#178 served from a route mock, and captures the screen with
 * the answer on it.
 *
 * `BEFORE=1` captures the same payload against the stashed source, where the
 * view ignores `updates` entirely — the before half of the pair. On this
 * branch the assertions below are what prove the difference.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const ISSUE_URL = 'https://github.com/parob/homecast-cloud/issues/178';

const REPORTED_ISSUES = {
  page: 1,
  hasMore: false,
  issues: [{
    issueNumber: 178,
    title: 'I don’t think the widgets change correctly based on the background darkness or lightness',
    state: 'open',
    url: ISSUE_URL,
    labels: ['bug', 'issue-reporter', 'claude-attempted', 'claude-pr-open'],
    createdAt: new Date(Date.now() - 20 * 3_600_000).toISOString(),
    updatedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    commentCount: 3,
  }],
};

/** The answer as it was actually written, minus the parts the server strips. */
const ANSWER = [
  'Two of the three asks are fixed in https://github.com/parob/homecast-web/pull/222.',
  'The third — the one in your title — I have diagnosed but deliberately **not**',
  'changed, because it is a product decision rather than a bug.',
  '',
  '## Ask 1 — the widget light/dark treatment. Real, and not mine to change',
  '',
  'You are right that it does not turn over where iOS does. `isDarkLuminance` treats',
  'a background as dark below **0.8**; WCAG’s crossover — where white and black ink',
  'contrast equally — is **0.179**. So white ink goes on essentially every photograph',
  'and every preset. That is why it feels like it changes at the wrong time: it almost',
  'never changes at all.',
  '',
  '**What I would do, if you want it:** move the *ink* decision to the WCAG crossover',
  'and leave the 0.8 mood threshold alone for the scrim and the header chrome. That is',
  'a contained change with a visible before/after — say the word and it gets its own PR.',
].join('\n');

const UPDATES = [
  {
    id: '5769050948', url: `${ISSUE_URL}#issuecomment-5769050948`,
    at: new Date(Date.now() - 8 * 3_600_000).toISOString(),
    author: 'robjampar', by: 'person', text: 'Hello?', truncated: false,
  },
  {
    id: '5772175077', url: `${ISSUE_URL}#issuecomment-5772175077`,
    at: new Date(Date.now() - 40 * 60_000).toISOString(),
    author: 'robjampar', by: 'claude', truncated: false,
    text: [
      'Picked this up — investigating now.',
      '',
      'Same answer as on #175: nothing had looked at this until now, and the reason is',
      'written up on #181. This is the sweep working through the backlog; #175 is done',
      'and this is next.',
      '',
      'Reading it as **three separate asks**, because they need different treatment and',
      'I’d rather be explicit than quietly do one of them:',
      '',
      '1. **The widget light/dark treatment doesn’t switch at the right point** against',
      'the background — a defect, and the one I’ll reproduce first.',
      '2. **Not enough of the background options are visible** / the scroll view should',
      'be taller — a request.',
      '3. **Put the blur title and the other title in line with their bars** for space',
      'efficiency — a request.',
      '',
      'Starting with (1). Will report on each.',
    ].join('\n'),
  },
  {
    id: '5772444657', url: `${ISSUE_URL}#issuecomment-5772444657`,
    at: new Date(Date.now() - 11 * 60_000).toISOString(),
    author: 'robjampar', by: 'claude', text: ANSWER, truncated: false,
  },
];

const RESOLUTION = {
  issueNumber: 178,
  title: REPORTED_ISSUES.issues[0].title,
  state: 'open',
  url: ISSUE_URL,
  labels: REPORTED_ISSUES.issues[0].labels,
  summary: 'The background picker fills the dialog and scrolls properly, and the sliders sit on one line each. The widget light/dark threshold is diagnosed but left for a decision.',
  reach: 'web',
  primary: { repo: 'parob/homecast-web', number: 222, url: 'https://github.com/parob/homecast-web/pull/222' },
  prs: [{ repo: 'parob/homecast-web', number: 222, url: 'https://github.com/parob/homecast-web/pull/222' }],
  evidence: [],
  reported: [],
  reportedText: 'I don’t think the widgets change correctly based on the background darkness or lightness. Also not enough of the background options are visible.',
  createdAt: REPORTED_ISSUES.issues[0].createdAt,
  updates: UPDATES,
  merge: { configured: true, servingSha: '4ae7930', plan: [] },
  feedback: { configured: true },
};

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

  await page.route(/\/rest\/issue-report\/178\/resolution$/, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(RESOLUTION),
  }));

  await page.route(/\/rest\/issue-report(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(REPORTED_ISSUES),
    });
  });
}

const sheet = (page: Page) => page.locator('[role="dialog"]');
const BEFORE = process.env.BEFORE === '1';

test.use({ viewport: { width: 428, height: 926 }, deviceScaleFactor: 2 });

test('the answer written to the reporter is on the screen, newest first', async ({ page }) => {
  await asAdminReporter(page);
  await page.goto('/');
  // No blind wait for the app to mount its shortcut handler: press until the
  // sheet is actually open. A fixed pause is what makes a spec pass on a fast
  // runner and flake on a slow one.
  await expect.poll(async () => {
    if (await sheet(page).isVisible()) return true;
    await page.keyboard.press('Alt+Shift+KeyR');
    return sheet(page).isVisible();
  }, { timeout: 20_000, intervals: [400] }).toBe(true);
  await page.getByRole('tab', { name: 'Existing' }).click();
  await page.getByText(/widgets change correctly/).first().waitFor();
  await page.getByRole('button', { name: 'Open #178' }).click();

  // The fix's one line is there either way — it is not the thing in question.
  await expect(page.getByText(/The background picker fills the dialog/)).toBeVisible();

  if (BEFORE) {
    // Nowhere on the screen, top to bottom: scroll to the end to show it.
    await page.getByRole('region', { name: 'Send feedback' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
    await sheet(page).screenshot({ path: 'screenshots/output/issue-182-updates-before.png' });
    return;
  }

  const updates = page.getByRole('region', { name: 'Updates' });
  await updates.scrollIntoViewIfNeeded();

  // The newest answer, open, with the question it put to the reporter.
  await expect(updates).toContainText('Ask 1 — the widget light/dark treatment');
  await expect(updates).toContainText('say the word and it gets its own PR');
  // Who said it, and how long ago — to the minute, because "today" cannot say
  // whether this is the reply that just arrived.
  await expect(updates).toContainText('Claude');
  await expect(updates).toContainText('11m ago');
  // Newest first, and the older ones folded.
  const said = updates.locator('article');
  await expect(said.first()).toContainText('0.179');
  await expect(said.last()).toContainText('Hello?');
  await expect(updates.getByRole('button', { name: 'Show more' }).first()).toBeVisible();

  // Read, not reprinted: no `##` or `**` left on the screen, and the source's
  // 80-column wraps reflowed into sentences.
  await expect(updates).not.toContainText('##');
  await expect(updates).not.toContainText('**');
  await expect(updates).toContainText(
    'a background as dark below 0.8; WCAG’s crossover — where white and black ink contrast equally — is 0.179.',
  );

  await page.waitForTimeout(600);
  await sheet(page).screenshot({ path: 'screenshots/output/issue-182-updates.png' });
});
