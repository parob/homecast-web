/**
 * The issue loop's states, seen from the Issues sheet on a phone.
 *
 * The reported fault: the app said `Investigating` while the routine had
 * finished and was waiting on a question the reporter never saw. On 19 Oct
 * that was true of homecast-cloud#222, #227 and #228 at once. This drives the
 * real sheet with the real Open list as `/rest/issue-report` returned it on
 * 20 Oct — titles, labels, dates — and the routine's own resolution records
 * for #228 (a question, nothing built), #222 (a question *and* a draft to try,
 * both labels), #227 (a native draft to try, with a question beside it) and
 * the fixed #200, all served from route mocks in the shape the server answers.
 *
 * `BEFORE=1` captures the same payloads against `main`, where the new labels
 * read as `Investigating` / `Fix proposed` and none of the cards exist — the
 * before half of each pair. Run it from a checkout of `main` with this file
 * copied in; on this branch the assertions below are what prove the change.
 */
import { test, expect, type Page } from '@playwright/test';
import { setupMocks } from './mocks';
import { MOCK_USER } from './fixtures';

const BEFORE = process.env.BEFORE === '1';
const shot = (name: string) => `screenshots/output/issue-loop-${name}${BEFORE ? '-before' : ''}.png`;

const issueUrl = (n: number) => `https://github.com/parob/homecast-cloud/issues/${n}`;
const REPORTER = ['issue-reporter', 'app-homecast'];

const row = (
  issueNumber: number, title: string, labels: string[], createdAt: string, updatedAt: string,
  commentCount: number, state = 'open',
) => ({ issueNumber, title, state, url: issueUrl(issueNumber), labels, createdAt, updatedAt, commentCount });

/** The Open list on 20 Oct, in the server's order, plus the fixed #200. */
const ROWS = [
  row(228, 'System tray at top isn’t visible when analytics is opened (batter/time etc)',
    ['bug', ...REPORTER, 'claude-attempted', 'waiting-on-reporter'], '2026-10-19T08:37:25Z', '2026-10-19T18:09:39Z', 3),
  row(227, 'When the uploads on one of the Rooms can you close it up and then open it and it opens on a room the back button in t…',
    ['bug', ...REPORTER, 'claude-attempted', 'claude-pr-open', 'needs-device-check'], '2026-10-13T20:45:32Z', '2026-10-19T18:12:00Z', 3),
  row(222, 'I can’t see how to create collections in the iOS native app there’s no way to create the collections',
    ['bug', ...REPORTER, 'claude-attempted', 'claude-pr-open', 'waiting-on-reporter', 'needs-device-check'], '2026-10-06T18:08:22Z', '2026-10-19T18:19:54Z', 5),
  row(214, 'Hello,', ['bug', ...REPORTER, 'claude-attempted', 'needs-human'], '2026-10-01T14:08:18Z', '2026-10-19T18:20:12Z', 4),
  row(204, 'Sometimes', ['bug', ...REPORTER, 'claude-attempted', 'waiting-on-reporter'], '2026-09-24T18:40:28Z', '2026-10-19T18:22:18Z', 3),
  row(201, 'When you hide items or Rooms from The main screen, they should stay visible when you click on the individual room alt…',
    ['bug', ...REPORTER, 'claude-attempted', 'waiting-on-reporter'], '2026-09-23T22:16:01Z', '2026-10-19T18:21:53Z', 4),
  row(199, 'The menus in the web mobile view don’t look the same as the menus in the native app - lets try make them match as clo…',
    ['enhancement', ...REPORTER, 'claude-attempted', 'claude-pr-open'], '2026-09-23T17:27:29Z', '2026-09-24T06:26:32Z', 4),
  row(188, 'Fixed reports never leave the open list, and "All merged" reads as "this is done" when it is not',
    ['bug', 'claude-attempted', 'needs-human'], '2026-09-22T09:06:02Z', '2026-09-25T06:21:23Z', 3),
  row(181, 'My issues don’t seem to be getting looked at',
    ['bug', ...REPORTER, 'claude-attempted', 'needs-human'], '2026-09-22T00:04:54Z', '2026-09-24T18:13:27Z', 5),
  row(119, 'Slow connection recovery after unexpected drops and pod redirects',
    ['bug', 'claude-attempted', 'needs-human'], '2026-09-11T18:22:05Z', '2026-10-19T18:23:27Z', 8),
  row(114, 'Cloud WebSocket drops roughly every 20–30 minutes, on both actively-used accounts',
    ['bug', 'claude-attempted', 'needs-human'], '2026-09-10T20:51:31Z', '2026-10-19T18:23:35Z', 6),
  row(200, 'When changing homes with the top menu (either from clicking the header title or the header top button title) keep the…',
    ['bug', ...REPORTER, 'claude-attempted'], '2026-09-23T22:12:49Z', '2026-09-24T00:38:52Z', 3, 'closed'),
];

const byNumber = (n: number) => ROWS.find((r) => r.issueNumber === n)!;

const pr = (repo: string, number: number) => ({ repo, number, url: `https://github.com/${repo}/pull/${number}` });
const WEB_284 = pr('parob/homecast-web', 284);
const NATIVE_81 = pr('parob/homecast', 81);
const WEB_240 = pr('parob/homecast-web', 240);

const draft = (p: ReturnType<typeof pr>, title: string) => ({
  ...p, title, state: 'open', merged: false, mergeSha: null, mergeable: true, checks: 'success',
  action: 'blocked', reason: 'pull request is still a draft',
});

const claudeSaid = (n: number, at: string, text: string) => ({
  id: `${n}-${at}`, url: `${issueUrl(n)}#issuecomment-${n}`, at, author: 'robjampar', by: 'claude',
  kind: 'comment', where: 'issue', whereUrl: issueUrl(n), meta: null, collapsed: false, text, truncated: true,
});

const base = (n: number) => ({
  issueNumber: n, title: byNumber(n).title, state: byNumber(n).state, url: issueUrl(n), labels: byNumber(n).labels,
  reported: [], createdAt: byNumber(n).createdAt, feedback: { configured: true },
});

/** The routine's own records, as the server now answers them. */
const RESOLUTIONS: Record<number, unknown> = {
  228: {
    ...base(228),
    reportedText: 'System tray at top isn’t visible when analytics is opened (batter/time etc)',
    summary: "Web tells the iOS app the right status-bar colour; need to know whether the app's native fix (#166) works anywhere",
    reach: 'native', primary: null, prs: [], evidence: [],
    merge: { configured: true, servingSha: 'abc1234', plan: [] },
    verified: 'diagnosed',
    ask: 'In the iOS app, open any automation in the editor. Can you see the clock and battery at the top?',
    tryIt: null,
    updates: [claudeSaid(228, '2026-10-19T18:09:00Z', [
      '**Question.** I need one answer from you before I can fix this. The web side is doing its job, and the',
      'native fix it relies on has never been confirmed on a phone.',
      '',
      '**Correction to my earlier comment.** You were in the **iOS app**, not the home-screen web app.',
    ].join('\n'))],
  },
  222: {
    ...base(222),
    reportedText: 'I can’t see how to create collections in the iOS native app there’s no way to create the collections',
    summary: 'Native menu always offers New Collection, so the iOS app can create a collection',
    reach: 'web', primary: WEB_284, prs: [WEB_284],
    evidence: [{
      url: 'https://storage.googleapis.com/parob-issue-reporter-attachments/a/445d75c9217a4b79a25af1dd17e161b4/bde4cab2d79f42ce90f4f61f5f0bbac1.png',
      alt: 'after: New Collection opens Create Collection',
    }],
    merge: { configured: true, servingSha: 'abc1234', plan: [draft(WEB_284, 'The native menu always offers New Collection')] },
    verified: 'diagnosed',
    ask: "When a collection didn't open on tap, which control did you tap: the menu under the title, or something else?",
    tryIt: 'After merging and restarting the app: tap the title at the top. Under Collections you should see New Collection; tap it, name one, and it should open.',
  },
  227: {
    ...base(227),
    reportedText: 'When the uploads on one of the Rooms can you close it up and then open it and it opens on a room the back button in the top left goes to a grey screen',
    summary: "Back after the app reopens on a room slides onto a blank backdrop; draft shows the home's loading placeholder instead",
    reach: 'native', primary: NATIVE_81, prs: [NATIVE_81], evidence: [],
    merge: { configured: true, servingSha: 'abc1234', plan: [draft(NATIVE_81, 'Back from a restored room slides onto the loading placeholder')] },
    verified: 'diagnosed',
    ask: 'When Back shows the grey screen, does it stay grey, or does Home appear by itself after a second?',
    tryIt: "With a build carrying #81: open a room, close the app fully, reopen (it lands on the room), tap Back. You should see the home's name and a tile skeleton slide in, then Home, never a plain grey screen.",
  },
  200: {
    ...base(200),
    reportedText: 'When changing homes with the top menu (either from clicking the header title or the header top button title) keep the menu open while the home changes in the background so the user can pick a room from the menu as well',
    summary: 'Home switcher now stays open across a home change so a room can be picked from the same menu.',
    reach: 'web', primary: WEB_240, prs: [WEB_240], evidence: [],
    merge: {
      configured: true, servingSha: 'abc1234',
      plan: [{ ...WEB_240, title: 'Keep the home switcher open across a home change', state: 'closed', merged: true,
        mergeSha: 'f00dfeed', mergeable: null, checks: 'success', action: 'merged', reason: null, serving: true }],
    },
    verified: null, ask: null, tryIt: null,
  },
};

const RUN_URL = 'https://claude.ai/code/session_01Gd7xYzTqRkLoopFired';

/** Every feedback request the page sent, as the server received it. */
type Sent = { issue: number; target: string; body: string; reopen?: boolean };

async function asAdminReporter(page: Page, sent: Sent[] = []) {
  await setupMocks(page);

  // Port-agnostic: the CI config serves on a different port from the dev one.
  await page.route(/^https?:\/\/(api\.homecast\.cloud|localhost:\d+|127\.0\.0\.1:\d+)\/?$/, async (route) => {
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
        page: 1, hasMore: false,
        issues: ROWS.filter((r) => state === 'all' || r.state === state),
      }),
    });
  });

  await page.route(/\/rest\/issue-report\/\d+\/resolution$/, async (route) => {
    const n = Number(/issue-report\/(\d+)\//.exec(route.request().url())![1]);
    const resolution = RESOLUTIONS[n];
    if (!resolution) return route.fulfill({ status: 404, body: '{}' });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resolution) });
  });

  await page.route(/\/rest\/issue-report\/\d+\/resolution\/feedback$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const n = Number(/issue-report\/(\d+)\//.exec(route.request().url())![1]);
    const request = route.request().postDataJSON() as Omit<Sent, 'issue'>;
    sent.push({ issue: n, ...request });
    const onPr = request.target === 'pr';
    const on = onPr ? (n === 227 ? NATIVE_81.url : WEB_284.url) : issueUrl(n);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        posted: true, target: request.target, on, comment: `${on}#issuecomment-${n}01`,
        // An issue comment fires a run — except on #200, which answers as a
        // server without the token does, so both outcomes are on screen.
        ...(onPr ? {} : {
          run: n === 200
            ? { fired: false, url: null, error: 'not configured' }
            : { fired: true, url: RUN_URL, error: null },
        }),
      }),
    });
  });
}

const sheet = (page: Page) => page.locator('[role="dialog"]');

async function openExisting(page: Page) {
  await page.goto('/');
  await page.waitForTimeout(2500);
  await page.keyboard.press('Alt+Shift+KeyR');
  await sheet(page).waitFor({ state: 'visible' });
  await page.getByRole('tab', { name: 'Existing' }).click();
  await page.getByRole('button', { name: 'Open #228' }).waitFor();
  await page.waitForTimeout(600);
}

async function openIssue(page: Page, n: number) {
  if (byNumber(n).state === 'closed') {
    await page.getByRole('button', { name: 'Fixed', exact: true }).click();
  }
  await page.getByRole('button', { name: `Open #${n}` }).click();
  await page.getByRole('heading', { name: 'On GitHub' }).waitFor();
  await page.waitForTimeout(600);
}

/** The card's top edge, so "first" is asserted on the screen rather than in the DOM. */
const top = async (page: Page, name: string) => (await page.getByRole('region', { name }).boundingBox())!.y;

test.use({ viewport: { width: 440, height: 956 }, deviceScaleFactor: 2 });

test('the Open list puts what is waiting on you first, in the one solid pill', async ({ page }) => {
  await asAdminReporter(page);
  await openExisting(page);
  if (BEFORE) {
    await sheet(page).screenshot({ path: shot('list') });
    return;
  }

  const order = await page.getByRole('button', { name: /^Open #/ }).evaluateAll(
    (rows) => rows.map((r) => r.getAttribute('aria-label')),
  );
  // Ten of the eleven are the reporter's turn; the one being worked goes last.
  expect(order.at(-1)).toBe('Open #199');
  expect(order.slice(0, 3)).toEqual(['Open #228', 'Open #227', 'Open #222']);
  await expect(page.getByRole('button', { name: 'Open #228' })).toContainText('Needs your answer');
  await expect(page.getByRole('button', { name: 'Open #227' })).toContainText('Try on your phone');
  await expect(page.getByRole('button', { name: 'Open #222' })).toContainText('Needs your answer');
  await expect(page.getByRole('button', { name: 'Open #214' })).toContainText('Needs your decision');
  await expect(page.getByRole('button', { name: 'Open #199' })).toContainText('Fix proposed');
  await expect(sheet(page).getByText('Investigating')).toHaveCount(0);

  await sheet(page).screenshot({ path: shot('list') });
});

test('a question with nothing built: the question first, and a reply that starts Claude', async ({ page }) => {
  const sent: Sent[] = [];
  await asAdminReporter(page, sent);
  await openExisting(page);
  await openIssue(page, 228);
  if (BEFORE) {
    await sheet(page).screenshot({ path: shot('answer') });
    return;
  }

  const card = page.getByRole('region', { name: 'Claude needs your answer' });
  await expect(card).toContainText('Can you see the clock and battery at the top?');
  await expect(page.getByText(/#228 · reported .* · Needs your answer/)).toBeVisible();
  expect(await top(page, 'Claude needs your answer')).toBeLessThan(await top(page, 'You reported'));
  // A record with `prs: []` is a diagnosis, not a fix.
  await expect(page.getByRole('region', { name: 'Proposed fix' })).toContainText('No fix proposed yet.');
  await expect(page.getByRole('region', { name: 'Proposed fix' })).not.toContainText('Built from the code');
  await sheet(page).screenshot({ path: shot('answer') });

  await page.getByRole('textbox', { name: 'Your answer' }).fill('No — the clock is white on white in the editor too.');
  await page.getByRole('button', { name: 'Send answer' }).click();
  await expect(card).toContainText('Sent to issue #228 — Claude has started on it.');
  await expect(card.getByRole('button', { name: `View the run — ${RUN_URL}` })).toBeVisible();
  expect(sent).toEqual([{
    issue: 228, target: 'issue', body: 'No — the clock is white on white in the editor too.',
  }]);
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: shot('answer-sent') });
});

test('a question and a fix to try on one report: both cards, the question first', async ({ page }) => {
  const sent: Sent[] = [];
  await asAdminReporter(page, sent);
  await openExisting(page);
  await openIssue(page, 222);
  if (BEFORE) {
    await sheet(page).screenshot({ path: shot('both') });
    return;
  }

  const ask = page.getByRole('region', { name: 'Claude needs your answer' });
  const tryIt = page.getByRole('region', { name: 'Try this on your phone' });
  await expect(ask).toContainText('which control did you tap');
  await expect(tryIt).toContainText('Under Collections you should see New Collection');
  await expect(tryIt).toContainText('nobody has seen it working on a device yet.');
  // A draft cannot be merged from here, so nothing points at a button that is not there.
  await expect(tryIt).not.toContainText('merge it below');
  const [askTop, tryTop, reportedTop] = await Promise.all([
    top(page, 'Claude needs your answer'), top(page, 'Try this on your phone'), top(page, 'You reported'),
  ]);
  expect(askTop).toBeLessThan(tryTop);
  expect(tryTop).toBeLessThan(reportedTop);
  await sheet(page).screenshot({ path: shot('both') });

  await tryIt.getByRole('button', { name: 'Still broken' }).click();
  await expect(tryIt).toContainText('Goes on homecast-web#284.');
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: shot('both-still-broken') });
  await tryIt.getByRole('button', { name: 'Tell Claude' }).click();
  await expect(tryIt).toContainText('Sent to homecast-web#284 — it gets picked up straight away.');
  expect(sent).toEqual([{ issue: 222, target: 'pr', body: 'Still broken.' }]);
});

test('a native draft to try, with the question the record carries beside it', async ({ page }) => {
  await asAdminReporter(page);
  await openExisting(page);
  await openIssue(page, 227);
  if (BEFORE) {
    await sheet(page).screenshot({ path: shot('try') });
    return;
  }

  await expect(page.getByText(/#227 · reported .* · Try on your phone/)).toBeVisible();
  // No `waiting-on-reporter`, so the question is offered, not insisted on.
  await expect(page.getByRole('region', { name: 'Claude has a question' })).toContainText('does it stay grey');
  await expect(page.getByRole('region', { name: 'Try this on your phone' })).toContainText('With a build carrying #81');
  expect(await top(page, 'Claude has a question')).toBeLessThan(await top(page, 'Try this on your phone'));
  await sheet(page).screenshot({ path: shot('try') });
});

test('a fixed report: Still broken? opens a box and says so on the issue', async ({ page }) => {
  const sent: Sent[] = [];
  await asAdminReporter(page, sent);
  await openExisting(page);
  await openIssue(page, 200);
  if (BEFORE) {
    await sheet(page).screenshot({ path: shot('fixed') });
    return;
  }

  const button = page.getByRole('button', { name: 'Still broken?' });
  await expect(button).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'What did you see?' })).toHaveCount(0);
  await sheet(page).screenshot({ path: shot('fixed') });

  await button.click();
  await page.getByRole('textbox', { name: 'What did you see?' }).fill('Switching homes closes the menu again.');
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: shot('fixed-still-broken') });

  await page.getByRole('button', { name: 'Tell Claude' }).click();
  // This mock answers as a server without the routine token: nothing fired,
  // so nothing may say it started.
  await expect(page.getByText('Sent to issue #200 — Claude picks it up at the next scheduled check, twice a day.')).toBeVisible();
  await expect(page.getByText(/Claude has started/)).toHaveCount(0);
  expect(sent).toEqual([{
    issue: 200, target: 'issue', body: 'Still broken. Switching homes closes the menu again.', reopen: true,
  }]);
  await page.waitForTimeout(300);
  await sheet(page).screenshot({ path: shot('fixed-sent') });
});
