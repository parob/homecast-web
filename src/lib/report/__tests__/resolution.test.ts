import { describe, it, expect, vi, afterEach } from 'vitest';

import {
  conflictsIn, feedbackPickup, feedbackPr, feedbackSiblings, feedbackTargets, fetchResolution, fixStatus,
  fixStatusTone, mergeLabel, mergedReportMessage,
  mergeOutstanding, mergeResolution, mergesNow, nudgeConflicts, offersResolution,
  planStatus, reporterFirst, sendFeedback, shortPr, stillBrokenBody,
  type FixStatus, type MergePlanEntry, type Resolution,
} from '../resolution';

/**
 * Which rows offer a fix, and how the fetch degrades.
 *
 * The degrade case is the one that matters: the web deploys minutes before
 * the server does, so for a while every tap lands on a server without the
 * endpoint. That has to read as "nothing recorded", never as a failure.
 */

vi.mock('@/lib/config', () => ({ config: { apiUrl: 'https://api.test' } }));

const row = (labels: string[], state = 'open') => ({ labels, state });

describe('offersResolution', () => {
  it('offers one while the routine has a PR open for it', () => {
    expect(offersResolution(row(['bug', 'claude-pr-open']))).toBe(true);
  });

  it('offers one on a closed report, whose label has usually come off by then', () => {
    expect(offersResolution(row(['bug', 'claude-attempted'], 'closed'))).toBe(true);
  });

  it('offers nothing on an open report nobody has a fix for', () => {
    expect(offersResolution(row(['bug', 'claude-attempted']))).toBe(false);
    expect(offersResolution(row([]))).toBe(false);
  });
});

describe('fixStatus — the word on a row', () => {
  it('reads Fix proposed while a PR is open, and Fixed once closed', () => {
    expect(fixStatus(row(['bug', 'claude-pr-open']))).toBe('Fix proposed');
    expect(fixStatus(row(['bug', 'claude-pr-open'], 'closed'))).toBe('Fixed');
    expect(fixStatus(row(['bug', 'claude-attempted'], 'closed'))).toBe('Fixed');
  });

  it('names the state a row is actually in, rather than going quiet', () => {
    expect(fixStatus(row(['bug', 'claude-attempted']))).toBe('Investigating');
    expect(fixStatus(row(['bug', 'blocked-upstream']))).toBe('Blocked upstream');
    expect(fixStatus(row(['bug', 'needs-human']))).toBe('Needs your decision');
    expect(fixStatus(row(['bug', 'waiting-on-reporter']))).toBe('Needs your answer');
    expect(fixStatus(row(['bug', 'needs-device-check']))).toBe('Try on your phone');
    expect(fixStatus(row(['bug', 'awaiting-release']))).toBe('Waiting for app build');
  });

  /**
   * homecast-cloud#181. These two rows are the whole issue: on 21 Sep the
   * first was worked in depth and the second was never opened by anything,
   * and the list rendered them identically because both answered null.
   */
  it('tells an untouched report apart from one being worked on', () => {
    const investigating = row(['bug', 'issue-reporter', 'claude-attempted']);
    const untouched = row(['bug', 'issue-reporter', 'app-homecast', 'fp-cefd17ceb60c0a9e']);

    expect(fixStatus(untouched)).toBe('Not picked up yet');
    expect(fixStatus(investigating)).not.toBe(fixStatus(untouched));
  });

  it('says so for a bare report, rather than leaving the row blank', () => {
    expect(fixStatus(row([]))).toBe('Not picked up yet');
  });

  /**
   * Order, not membership: a report carries several of these at once and the
   * most-resolved one is the one worth reading. #163 held attempted AND
   * pr-open together for three days.
   */
  it('reads the most resolved label a row carries', () => {
    expect(fixStatus(row(['claude-attempted', 'claude-pr-open']))).toBe('Fix proposed');
    expect(fixStatus(row(['claude-attempted', 'blocked-upstream']))).toBe('Blocked upstream');
    expect(fixStatus(row(['claude-attempted', 'needs-human', 'claude-pr-open'], 'closed')))
      .toBe('Fixed');
  });
});

describe('fixStatusTone — how loudly each word reads', () => {
  it('mutes the absence of news and greens a fix', () => {
    expect(fixStatusTone('Not picked up yet')).toBe('idle');
    expect(fixStatusTone('Fixed')).toBe('done');
  });

  it('groups the two that mean someone is on it, and the two that mean waiting', () => {
    expect(fixStatusTone('Investigating')).toBe('active');
    expect(fixStatusTone('Fix proposed')).toBe('active');
    expect(fixStatusTone('Blocked upstream')).toBe('waiting');
    expect(fixStatusTone('Waiting for app build')).toBe('waiting');
  });

  /**
   * The three that nothing moves on until the reporter does. They share one
   * tone because they share one consequence: the list lifts them, and the
   * pill is the only solid one on it.
   */
  it('gives the three that wait on the reporter their own tone', () => {
    expect(fixStatusTone('Needs your answer')).toBe('you');
    expect(fixStatusTone('Needs your decision')).toBe('you');
    expect(fixStatusTone('Try on your phone')).toBe('you');
  });

  it('has a tone for every word fixStatus can answer', () => {
    const every: FixStatus[] = [
      'Fixed', 'Needs your answer', 'Needs your decision', 'Try on your phone', 'Blocked upstream',
      'Waiting for app build', 'Fix proposed', 'Investigating', 'Not picked up yet',
    ];
    for (const status of every) expect(fixStatusTone(status)).toMatch(/^(you|done|active|waiting|idle)$/);
  });
});

/**
 * The precedence, one step at a time. Each row carries its label and every
 * label below it in the order, so a row only reads as its own word if that
 * word outranks all the rest — which is the order the contract fixes:
 * closed → waiting-on-reporter → needs-human → needs-device-check →
 * blocked-upstream → awaiting-release → claude-pr-open → claude-attempted.
 */
describe('fixStatus — precedence', () => {
  const ORDER: [string, FixStatus][] = [
    ['waiting-on-reporter', 'Needs your answer'],
    ['needs-human', 'Needs your decision'],
    ['needs-device-check', 'Try on your phone'],
    ['blocked-upstream', 'Blocked upstream'],
    ['awaiting-release', 'Waiting for app build'],
    ['claude-pr-open', 'Fix proposed'],
    ['claude-attempted', 'Investigating'],
  ];

  it.each(ORDER.map(([label, word], index) => [label, word, ORDER.slice(index).map(([l]) => l)] as const))(
    '%s outranks everything after it, and reads %s',
    (_label, word, labels) => {
      expect(fixStatus(row([...labels].reverse()))).toBe(word);
    },
  );

  it('reads Fixed on a closed report whatever it still carries', () => {
    expect(fixStatus(row(ORDER.map(([label]) => label), 'closed'))).toBe('Fixed');
  });

  /**
   * The reported fault, as it stood on 19 Oct: the routine had asked and
   * stopped, `claude-attempted` was still on, and the row said someone was
   * working on it.
   */
  it('no longer reads Investigating once the routine is waiting on an answer', () => {
    expect(fixStatus(row(['bug', 'issue-reporter', 'claude-attempted', 'waiting-on-reporter'])))
      .toBe('Needs your answer');
  });

  it('asks the question before the fix is tried, when a report carries both', () => {
    expect(fixStatus(row(['claude-pr-open', 'needs-device-check', 'waiting-on-reporter'])))
      .toBe('Needs your answer');
  });
});

describe('reporterFirst — the order of the Open list', () => {
  const issue = (issueNumber: number, labels: string[], state = 'open') => ({ issueNumber, labels, state });

  it('lifts every row waiting on the reporter, and keeps both halves in the order they came', () => {
    const rows = [
      issue(228, ['claude-attempted']),
      issue(227, ['claude-attempted', 'waiting-on-reporter']),
      issue(222, ['claude-pr-open']),
      issue(202, ['needs-device-check', 'claude-pr-open']),
      issue(201, []),
      issue(188, ['needs-human']),
    ];
    expect(reporterFirst(rows).map((r) => r.issueNumber)).toEqual([227, 202, 188, 228, 222, 201]);
  });

  it('leaves a list with nothing waiting on the reporter exactly as it was', () => {
    const rows = [issue(1, ['claude-attempted']), issue(2, []), issue(3, ['awaiting-release'])];
    expect(reporterFirst(rows)).toBe(rows);
  });

  it('does not lift a closed report, whatever labels it kept', () => {
    const rows = [issue(1, []), issue(2, ['waiting-on-reporter'], 'closed')];
    expect(reporterFirst(rows).map((r) => r.issueNumber)).toEqual([1, 2]);
  });
});

describe('mergedReportMessage — what "all merged" means for a report still open', () => {
  const merged = 'All linked pull requests are merged.';

  it('is only the fact on a fixed report, and says what is left on the rest', () => {
    expect(mergedReportMessage('Fixed')).toBe(merged);
    expect(mergedReportMessage('Needs your answer')).toBe(`${merged} Claude is waiting for your answer above.`);
    expect(mergedReportMessage('Needs your decision'))
      .toBe(`${merged} This report still needs your decision; see the updates below.`);
    expect(mergedReportMessage('Try on your phone'))
      .toBe(`${merged} Try it on your phone — if it is still broken, say so above.`);
    expect(mergedReportMessage('Waiting for app build'))
      .toBe(`${merged} The fix reaches your phone with the next app build.`);
    expect(mergedReportMessage('Blocked upstream'))
      .toBe(`${merged} This report is still blocked upstream; see the updates below.`);
    expect(mergedReportMessage('Fix proposed')).toBe(`${merged} This report is still open pending verification.`);
    expect(mergedReportMessage('Investigating'))
      .toBe('This report is still being investigated. Earlier code changes have been merged.');
  });
});

describe('conflictsIn — the one block a tap can act on', () => {
  const entry = (over: Partial<MergePlanEntry>): MergePlanEntry => ({
    repo: 'parob/homecast-web', number: 214, url: 'https://github.com/parob/homecast-web/pull/214',
    title: null, state: 'open', merged: false, mergeSha: null, mergeable: true, checks: 'success',
    action: 'merge', reason: null, ...over,
  });

  it('picks out only the conflicts, not other blocks', () => {
    const plan = [
      entry({ action: 'blocked', reason: 'merge conflict' }),
      entry({ number: 215, action: 'blocked', reason: 'checks failing' }),
      entry({ number: 216, action: 'after', reason: 'after homecast-cloud#170' }),
    ];
    expect(conflictsIn(plan).map((e) => e.number)).toEqual([214]);
  });
});

describe('nudgeConflicts', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('posts to the nudge endpoint and hands back the plan with the ask', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      configured: true, servingSha: 'x', plan: [],
      nudge: { asked: true, conflicts: ['https://github.com/parob/homecast-web/pull/214'], on: 'https://github.com/parob/homecast-cloud/pull/170', comment: 'https://github.com/parob/homecast-cloud/pull/170#issuecomment-1' },
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const state = await nudgeConflicts(169, 'tok');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/rest/issue-report/169/resolution/nudge',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(state.nudge?.asked).toBe(true);
  });

  it('says so when merging is not set up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 409 })));
    await expect(nudgeConflicts(169, 'tok')).rejects.toThrow("Merging isn't set up on this server.");
  });
});

describe('shortPr', () => {
  it('reads as repo#number', () => {
    expect(shortPr({ repo: 'parob/homecast-web', number: 208, url: '' })).toBe('homecast-web#208');
  });
});

const planEntry = (repo: string, number: number, over: Partial<MergePlanEntry>): MergePlanEntry => ({
  repo, number, url: `https://github.com/${repo}/pull/${number}`, title: null, state: 'open',
  merged: false, mergeSha: null, mergeable: true, checks: 'success', action: 'merge', reason: null, ...over,
});

describe('the merge plan, read for the button', () => {
  const cloud = planEntry('parob/homecast-cloud', 170, {});
  const web = planEntry('parob/homecast-web', 214, { action: 'wait_deploy', reason: 'homecast-cloud#170 is merged but not serving yet' });

  it('names the one PR a tap merges, counts them when there are more, and is null with nothing to merge', () => {
    expect(mergeLabel([cloud, web])).toBe('Merge homecast-cloud#170');
    expect(mergeLabel([cloud, { ...web, action: 'merge' }])).toBe('Merge 2 pull requests');
    expect(mergeLabel([{ ...cloud, action: 'merged', merged: true }, web])).toBeNull();
    expect(mergeLabel([])).toBeNull();
    expect(mergesNow([cloud, web]).map((e) => e.number)).toEqual([170]);
  });

  it('knows whether anything is still to do', () => {
    expect(mergeOutstanding([{ ...cloud, action: 'merged', merged: true }, web])).toBe(true);
    expect(mergeOutstanding([{ ...cloud, action: 'merged', merged: true }, { ...web, action: 'merged', merged: true }])).toBe(false);
  });

  it('puts each place in the plan into a word or two', () => {
    expect(planStatus(cloud)).toBe('Ready');
    expect(planStatus({ ...cloud, draft: true })).toBe('Ready · draft');
    expect(planStatus({ ...cloud, draft: false })).toBe('Ready');
    expect(planStatus(web)).toBe('Waits for deploy');
    expect(planStatus({ ...cloud, action: 'merged', merged: true, serving: true })).toBe('Merged · serving');
    expect(planStatus({ ...cloud, action: 'merged', merged: true, serving: false })).toBe('Merged · deploying');
    expect(planStatus({ ...web, action: 'merged', merged: true })).toBe('Code merged');
    expect(planStatus({ ...web, action: 'after', reason: 'after homecast-web#214' })).toBe('after homecast-web#214');
    expect(planStatus({ ...web, action: 'blocked', reason: 'merge conflict' })).toBe('merge conflict');
  });
});

describe('fetchResolution', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const answer = (status: number, body?: unknown) => {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('asks the server for that issue, with the token', async () => {
    const resolution: Resolution = {
      issueNumber: 167, title: 't', state: 'open', url: null, labels: [], summary: null,
      reach: null, primary: null, prs: [], evidence: [], reported: [],
    };
    const fetchMock = answer(200, resolution);

    await expect(fetchResolution(167, 'tok')).resolves.toEqual(resolution);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/rest/issue-report/167/resolution',
      { headers: { authorization: 'Bearer tok' } },
    );
  });

  it('is null, not an error, on a server that has no such endpoint or issue', async () => {
    answer(404);
    await expect(fetchResolution(167, 'tok')).resolves.toBeNull();
  });

  it('says why when the account is not allowed', async () => {
    answer(403);
    await expect(fetchResolution(167, 'tok')).rejects.toThrow('admin');
  });

  it('fails plainly on anything else', async () => {
    answer(502);
    await expect(fetchResolution(167, 'tok')).rejects.toThrow('Could not load');
  });
});

describe('mergeResolution', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const answer = (status: number, body?: unknown) => {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('posts to the merge endpoint with the token and returns the plan the server answers with', async () => {
    const state = { configured: true, servingSha: '4ae7930', merged: [], plan: [] };
    const fetchMock = answer(200, state);
    await expect(mergeResolution(169, 'tok')).resolves.toEqual(state);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/rest/issue-report/169/resolution/merge',
      { method: 'POST', headers: { authorization: 'Bearer tok' } },
    );
  });

  it('says merging is not set up on a 409, and relays the server\'s reason otherwise', async () => {
    answer(409, { error: 'Merging is not set up on this server.' });
    await expect(mergeResolution(169, 'tok')).rejects.toThrow("isn't set up");
    answer(502, { error: 'Could not reach GitHub to merge.' });
    await expect(mergeResolution(169, 'tok')).rejects.toThrow('Could not reach GitHub');
    answer(403);
    await expect(mergeResolution(169, 'tok')).rejects.toThrow('admin');
  });
});

/**
 * Where feedback can go, and where one comment would land.
 *
 * Two rules, both of which the view reads before it offers anything. The pull
 * request is only a door while one is open to put a comment on — the server
 * refuses it otherwise rather than quietly retargeting the words. And exactly
 * one pull request receives it: the primary while it is open, else the first
 * open one, which is the same choice the server makes.
 */
describe('where feedback can go', () => {
  const cloud = planEntry('parob/homecast-cloud', 180, {});
  const web = planEntry('parob/homecast-web', 217, {});

  const withPlan = (plan: MergePlanEntry[], over: Partial<Resolution> = {}): Resolution => ({
    issueNumber: 179, title: null, state: 'open', url: null, labels: [], summary: null, reach: null,
    primary: cloud, prs: [cloud, web], evidence: [], reported: [],
    merge: { configured: true, servingSha: 'abc', plan },
    feedback: { configured: true },
    ...over,
  });

  it('offers nothing at all on a server that predates feedback, or one with it unset', () => {
    const { feedback: _f, ...older } = withPlan([cloud, web]);
    expect(feedbackTargets(older as Resolution)).toEqual([]);
    expect(feedbackTargets(withPlan([cloud, web], { feedback: { configured: false } }))).toEqual([]);
  });

  it('offers the pull request only while one is open', () => {
    expect(feedbackTargets(withPlan([cloud, web]))).toEqual(['pr', 'issue']);
    expect(feedbackTargets(withPlan([
      { ...cloud, state: 'closed', merged: true }, { ...web, state: 'closed', merged: true },
    ]))).toEqual(['issue']);
    expect(feedbackTargets(withPlan([]))).toEqual(['issue']);
  });

  it('lands the comment on the primary, and falls to the first open one when it is closed', () => {
    expect(feedbackPr(withPlan([cloud, web]))?.number).toBe(180);
    expect(feedbackPr(withPlan([{ ...cloud, state: 'closed', merged: true }, web]))?.number).toBe(217);
    expect(feedbackPr(withPlan([]))).toBeNull();
  });

  it('names the ones that will not be commented on, so the view can say so', () => {
    expect(feedbackSiblings(withPlan([cloud, web])).map((e) => e.number)).toEqual([217]);
    expect(feedbackSiblings(withPlan([cloud]))).toEqual([]);
    expect(feedbackSiblings(withPlan([]))).toEqual([]);
  });
});

describe('sendFeedback', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  const answer = (status: number, body?: unknown) => {
    const fetchMock = vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  };

  it('posts the words and the target, and returns where they landed', async () => {
    const result = {
      posted: true, target: 'pr', on: 'https://github.com/parob/homecast-cloud/pull/180',
      comment: 'https://github.com/parob/homecast-cloud/pull/180#issuecomment-1',
      named: ['https://github.com/parob/homecast-web/pull/217'],
    };
    const fetchMock = answer(200, result);
    await expect(sendFeedback(179, 'tok', 'pr', 'Still wrong.')).resolves.toEqual(result);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.test/rest/issue-report/179/resolution/feedback',
      {
        method: 'POST',
        headers: { authorization: 'Bearer tok', 'content-type': 'application/json' },
        body: JSON.stringify({ target: 'pr', body: 'Still wrong.' }),
      },
    );
  });

  it("relays the server's own reason, which is how a token missing issues write shows up", async () => {
    answer(502, { error: 'GitHub refused the comment (403): Resource not accessible by integration' });
    await expect(sendFeedback(179, 'tok', 'issue', 'hi')).rejects.toThrow('Resource not accessible');
    answer(409, { error: 'No open pull request to comment on — send it to the issue instead.' });
    await expect(sendFeedback(179, 'tok', 'pr', 'hi')).rejects.toThrow('send it to the issue');
    answer(403);
    await expect(sendFeedback(179, 'tok', 'pr', 'hi')).rejects.toThrow('admin');
  });

  it('marks a still-broken report with reopen, and sends no such key otherwise', async () => {
    const fetchMock = answer(200, { posted: true, target: 'issue', on: 'https://github.com/parob/homecast-cloud/issues/200' });
    await sendFeedback(200, 'tok', 'issue', 'Still broken.', { reopen: true });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.test/rest/issue-report/200/resolution/feedback',
      expect.objectContaining({ body: JSON.stringify({ target: 'issue', body: 'Still broken.', reopen: true }) }),
    );

    // Unset and false send exactly what a server that predates the flag reads.
    await sendFeedback(200, 'tok', 'issue', 'hi', { reopen: false });
    expect(fetchMock).toHaveBeenLastCalledWith(
      'https://api.test/rest/issue-report/200/resolution/feedback',
      expect.objectContaining({ body: JSON.stringify({ target: 'issue', body: 'hi' }) }),
    );
  });

  it('hands back the run the server fired, and tolerates a server that sends none', async () => {
    const run = { fired: true, url: 'https://claude.ai/code/session_01abc', error: null };
    answer(200, { posted: true, target: 'issue', on: 'https://github.com/parob/homecast-cloud/issues/222', run });
    await expect(sendFeedback(222, 'tok', 'issue', 'The sidebar.')).resolves.toMatchObject({ run });

    answer(200, { posted: true, target: 'issue', on: 'https://github.com/parob/homecast-cloud/issues/222' });
    const older = await sendFeedback(222, 'tok', 'issue', 'The sidebar.');
    expect(older.run).toBeUndefined();
  });
});

/**
 * Who reads what was just sent. Decided from the answer alone, and the one
 * thing pinned hardest is the negative: no `run`, or one that did not fire,
 * never reads as started.
 */
describe('feedbackPickup', () => {
  it('says started only for a run the server reports as fired', () => {
    expect(feedbackPickup({ target: 'issue', run: { fired: true, url: null, error: null } })).toBe('started');
    expect(feedbackPickup({ target: 'issue', run: { fired: false, url: null, error: 'not configured' } })).toBe('scheduled');
    expect(feedbackPickup({ target: 'issue' })).toBe('scheduled');
  });

  it('leaves a pull request comment to the session that reads it', () => {
    expect(feedbackPickup({ target: 'pr' })).toBe('pr');
    expect(feedbackPickup({ target: 'pr', run: { fired: false, url: null, error: null } })).toBe('pr');
  });
});

describe('stillBrokenBody', () => {
  it('says it on its own when nothing was typed, and leads with it when something was', () => {
    expect(stillBrokenBody('')).toBe('Still broken.');
    expect(stillBrokenBody('   ')).toBe('Still broken.');
    expect(stillBrokenBody(' The clock is still white. ')).toBe('Still broken. The clock is still white.');
  });

  it('does not say it twice when the words already do', () => {
    expect(stillBrokenBody('Still broken — same as before')).toBe('Still broken — same as before');
    expect(stillBrokenBody('still broken on the Mac too')).toBe('still broken on the Mac too');
  });
});


it('keeps an unresolved dependency or decision ahead of a proposed fix', () => {
  expect(fixStatus({ state: 'open', labels: ['needs-human', 'claude-pr-open'] })).toBe('Needs your decision');
  expect(fixStatus({ state: 'open', labels: ['blocked-upstream', 'claude-pr-open'] })).toBe('Blocked upstream');
});
