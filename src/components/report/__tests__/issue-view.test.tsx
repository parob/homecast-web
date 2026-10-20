// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { ReportedIssues } from '../ReportedIssues';
import { IssueView } from '../IssueView';
import type { ReportedIssue } from '@/lib/report/issues';
import type { MergePlanEntry, MergeState, Resolution, ResolutionUpdate } from '@/lib/report/resolution';

/**
 * One reported issue, on one screen.
 *
 * Three things pinned down. A row opens the issue in the app — it no longer
 * jumps to GitHub — and says where its fix stands in a word, only where there
 * is one to say. The view puts the report first, in the reporter's own words
 * and pictures, then the fix: the picture with its caption, the one line, the
 * pull requests. And nothing leaves the app without saying so: every link out
 * prints the full address it goes to.
 */

const FIXED: ReportedIssue = {
  issueNumber: 167,
  title: "I can't read the battery font on the screen",
  state: 'open',
  url: 'https://github.com/parob/homecast-cloud/issues/167',
  labels: ['bug', 'claude-attempted', 'claude-pr-open'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  commentCount: 3,
};

const UNTOUCHED: ReportedIssue = {
  ...FIXED, issueNumber: 170, title: 'Nobody has looked at this', labels: ['bug'], commentCount: 0,
};

const RESOLUTION: Resolution = {
  issueNumber: 167,
  title: FIXED.title,
  state: 'open',
  url: FIXED.url,
  labels: FIXED.labels,
  summary: "the battery line now takes the tile's white ink",
  reach: 'web',
  primary: { repo: 'parob/homecast-web', number: 208, url: 'https://github.com/parob/homecast-web/pull/208' },
  prs: [{ repo: 'parob/homecast-web', number: 208, url: 'https://github.com/parob/homecast-web/pull/208' }],
  evidence: [{ url: 'https://storage.test/pair.png', alt: 'Before: invisible. After: legible.' }],
  reported: [{ url: 'https://storage.test/report.jpg', alt: 'screenshot.jpg' }],
  reportedText: 'The battery percentage is white on a white tile.\n\nSecond line.',
  createdAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
};

const CLOUD_PR = { repo: 'parob/homecast-cloud', number: 170, url: 'https://github.com/parob/homecast-cloud/pull/170' };
const WEB_PR = { repo: 'parob/homecast-web', number: 214, url: 'https://github.com/parob/homecast-web/pull/214' };

const entry = (pr: typeof CLOUD_PR, over: Partial<MergePlanEntry>): MergePlanEntry => ({
  ...pr, title: null, state: 'open', merged: false, mergeSha: null, mergeable: true,
  checks: 'success', action: 'merge', reason: null, ...over,
});

/** Two PRs, cloud first: the cloud one merges now, the web one waits for its deploy. */
const TWO_PR_PLAN: MergeState = {
  configured: true,
  servingSha: '4ae7930',
  plan: [
    entry(CLOUD_PR, { action: 'merge' }),
    entry(WEB_PR, { action: 'wait_deploy', reason: 'homecast-cloud#170 is merged but not serving yet — the server must carry it first' }),
  ],
};

const WITH_PLAN: Resolution = {
  ...RESOLUTION, prs: [CLOUD_PR, WEB_PR], primary: CLOUD_PR, merge: TWO_PR_PLAN,
};

/** What the list mock answers; a test that needs other rows sets it. */
let listed: ReportedIssue[] = [];

const fetchResolution = vi.fn();
const mergeResolution = vi.fn();
const nudgeConflicts = vi.fn();
const sendFeedback = vi.fn();
const openExternalUrl = vi.fn();

vi.mock('@/lib/report/issues', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/report/issues')>()),
  fetchReportedIssues: async () => ({ issues: listed, page: 1, hasMore: false }),
}));

vi.mock('@/lib/report/resolution', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/report/resolution')>()),
  fetchResolution: (...args: unknown[]) => fetchResolution(...args),
  mergeResolution: (...args: unknown[]) => mergeResolution(...args),
  nudgeConflicts: (...args: unknown[]) => nudgeConflicts(...args),
  sendFeedback: (...args: unknown[]) => sendFeedback(...args),
}));

vi.mock('@/lib/open-url', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

beforeEach(() => {
  listed = [FIXED, UNTOUCHED];
  localStorage.setItem('homecast-token', 'tok');
  fetchResolution.mockReset();
  mergeResolution.mockReset();
  nudgeConflicts.mockReset();
  sendFeedback.mockReset();
  openExternalUrl.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('a reported row', () => {
  it('opens the issue in the app, and says where its fix stands only where there is one', async () => {
    const onOpen = vi.fn();
    render(<ReportedIssues onOpen={onOpen} />);

    const row = await screen.findByRole('button', { name: 'Open #167' });
    expect(row.textContent).toContain('Fix proposed');
    expect(screen.getByRole('button', { name: 'Open #170' }).textContent).not.toContain('Fix');

    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith(FIXED);
    // Nothing on the row goes to GitHub.
    expect(openExternalUrl).not.toHaveBeenCalled();
  });

  it('chooses the issue when the list is a picker, from the row or the button', async () => {
    const onAddTo = vi.fn();
    render(<ReportedIssues onAddTo={onAddTo} />);
    await screen.findByRole('button', { name: /Add this report to #167/ });
    expect(screen.queryByRole('button', { name: /^Open #/ })).toBeNull();

    fireEvent.click(screen.getByText("I can't read the battery font on the screen"));
    expect(onAddTo).toHaveBeenCalledWith(FIXED);
    expect(openExternalUrl).not.toHaveBeenCalled();
  });
});

describe('the issue view', () => {
  it('shows what was reported first — the words as written, and the screenshot', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const words = await screen.findByText(/The battery percentage is white on a white tile/);
    expect(words.textContent).toContain('Second line.');
    expect(fetchResolution).toHaveBeenCalledWith(167, 'tok');
    expect(screen.getByText(/#167 · reported 3d ago · Fix proposed/)).toBeTruthy();

    // The report's own screenshot is context, and says where a tap takes you.
    expect(screen.getByRole('button', { name: 'Open screenshot.jpg full size in your browser' })).toBeTruthy();
  });

  it('shows the fix — the picture, the line and the pull request with its full address', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const picture = await screen.findByRole('img', { name: 'Before: invisible. After: legible.' });
    expect(picture.getAttribute('src')).toBe('https://storage.test/pair.png');
    expect(screen.getByText("the battery line now takes the tile's white ink")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Before: invisible. After: legible. full size in your browser' })).toBeTruthy();

    // The link out says so, and prints where it goes.
    const pr = screen.getByRole('button', { name: 'Open homecast-web#208 on GitHub — https://github.com/parob/homecast-web/pull/208' });
    expect(pr.textContent).toContain('https://github.com/parob/homecast-web/pull/208');
    fireEvent.click(pr);
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/parob/homecast-web/pull/208');
  });

  it('prints the issue\'s own GitHub address in full, and nothing else on screen goes there', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const link = await screen.findByRole('button', { name: 'Open Issue #167 on GitHub — https://github.com/parob/homecast-cloud/issues/167' });
    expect(link.textContent).toContain('https://github.com/parob/homecast-cloud/issues/167');
    // The title is not a link any more.
    fireEvent.click(screen.getByText("I can't read the battery font on the screen"));
    expect(openExternalUrl).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/parob/homecast-cloud/issues/167');
  });

  it('says so when the server has no record, and still shows the report and the link', async () => {
    fetchResolution.mockResolvedValue(null);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    await screen.findByText('No fix proposed yet.');
    expect(screen.getByText('Your report is on GitHub — the link is below.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Open Issue #167 on GitHub/ })).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when there are no pull requests and no pictures yet', async () => {
    fetchResolution.mockResolvedValue({ ...RESOLUTION, prs: [], evidence: [], summary: null, primary: null });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByText('No fix proposed yet.');
    // The words are still there: the report is not the fix.
    expect(screen.getByText(/The battery percentage is white/)).toBeTruthy();
  });

  it('tolerates a server that predates the reported text', async () => {
    const { reportedText: _t, createdAt: _c, ...older } = RESOLUTION;
    fetchResolution.mockResolvedValue(older);
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByText('No description beyond the title.');
    expect(screen.getByRole('button', { name: 'Open screenshot.jpg full size in your browser' })).toBeTruthy();
  });

  it('shows the failure when the load actually fails', async () => {
    fetchResolution.mockRejectedValue(new Error('Could not load the resolution right now.'));
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load'));
  });

  it('goes back to the list', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    const onBack = vi.fn();
    render(<IssueView issue={FIXED} onBack={onBack} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to issues' }));
    expect(onBack).toHaveBeenCalled();
  });
});

/**
 * Merging from the view.
 *
 * The button names what it merges, asks once and says it ships to production,
 * and after the tap shows what happened from the server's answer — including
 * the web PR left waiting for the cloud one to deploy, which is the whole
 * reason the order is decided server-side rather than by tapping twice.
 */
describe('merging from the issue view', () => {
  it('offers no Merge on a server that predates merging, and says so on one that has it unset', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    const { unmount } = render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByRole('button', { name: /homecast-web#208/ });
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    expect(screen.queryByText(/isn.t set up/)).toBeNull();
    unmount();

    fetchResolution.mockResolvedValue({ ...RESOLUTION, merge: { configured: false, servingSha: '', plan: [] } });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByText(/Merging isn.t set up on this server/);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
  });

  it('shows each PR with its place in the plan, and names the one the button merges', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    // `^`: the Merge button's name carries the same PR, and the row is the one
    // whose name starts with it.
    const cloud = await screen.findByRole('button', { name: /Open homecast-cloud#170 on GitHub/ });
    expect(cloud.textContent).toContain('Ready');
    expect(screen.getByRole('button', { name: /Open homecast-web#214 on GitHub/ }).textContent).toContain('Waits for deploy');
    expect(screen.getByRole('button', { name: 'Merge homecast-cloud#170' })).toBeTruthy();
    expect(mergeResolution).not.toHaveBeenCalled();
  });

  it('asks once, saying what ships, then merges and shows what the server did', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    mergeResolution.mockResolvedValue({
      configured: true,
      servingSha: '4ae7930',
      merged: [{ url: CLOUD_PR.url, sha: 'c28325f' }],
      plan: [
        entry(CLOUD_PR, { action: 'merged', merged: true, mergeSha: 'c28325f', serving: false }),
        entry(WEB_PR, { action: 'wait_deploy', reason: 'homecast-cloud#170 is merged but not serving yet — the server must carry it first' }),
      ],
    } satisfies MergeState);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Merge homecast-cloud#170' }));
    // Nothing merged by pressing Merge: the confirmation is the gate.
    expect(mergeResolution).not.toHaveBeenCalled();
    expect(screen.getByText(/Merges homecast-cloud#170 to/).textContent).toContain('ships to production');
    expect(screen.getByText(/Merges homecast-cloud#170 to/).textContent).toContain('The rest waits for it to deploy');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
    await waitFor(() => expect(mergeResolution).toHaveBeenCalledWith(167, 'tok'));

    await screen.findByText('Merged homecast-cloud#170.');
    // The plan re-rendered from the server's answer: cloud deploying, web waiting.
    expect(screen.getByRole('button', { name: /Open homecast-cloud#170 on GitHub/ }).textContent).toContain('Merged · deploying');
    expect(screen.getByText(/homecast-web#214: homecast-cloud#170 is merged but not serving yet/)).toBeTruthy();
    // Nothing merges now, so the button is gone and a re-check is offered.
    expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetchResolution).toHaveBeenCalledTimes(2));
  });

  it('cancels without merging', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge homecast-cloud#170' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm merge' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Merge homecast-cloud#170' })).toBeTruthy();
    expect(mergeResolution).not.toHaveBeenCalled();
  });

  it('shows the refusal when the merge fails, and keeps the plan', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    mergeResolution.mockRejectedValue(new Error('GitHub refused the merge (405): Required status check is failing'));
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge homecast-cloud#170' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('405'));
    expect(screen.getByRole('button', { name: 'Confirm merge' })).toBeTruthy();
  });

  it('says all merged when nothing is left, with a re-check for the deploy', async () => {
    fetchResolution.mockResolvedValue({
      ...WITH_PLAN,
      merge: {
        configured: true, servingSha: 'c28325f',
        plan: [
          entry(CLOUD_PR, { action: 'merged', merged: true, mergeSha: 'c28325f', serving: true }),
          entry(WEB_PR, { action: 'merged', merged: true, mergeSha: 'dddd' }),
        ],
      },
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByText('All linked pull requests are merged. This report is still open pending verification.');
    expect(screen.getByRole('button', { name: /Open homecast-cloud#170 on GitHub/ }).textContent).toContain('Merged · serving');
    expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
  });
});


/**
 * The conflict nudge.
 *
 * A conflict is the one block a tap can do something about: the ask goes as
 * one comment on the primary PR, where an agent is woken straight away. The
 * view offers it as a button, shows what came of it with the comment's
 * address, and shows the same when a Merge tap ran into the conflict and the
 * server asked on its own.
 */
describe('asking for a conflict to be fixed', () => {
  const CONFLICTED: Resolution = {
    ...WITH_PLAN,
    merge: {
      configured: true, servingSha: '4ae7930',
      plan: [
        entry(CLOUD_PR, { action: 'merged', merged: true, serving: true }),
        entry(WEB_PR, { action: 'blocked', reason: 'merge conflict', mergeable: false }),
      ],
    },
  };
  const ASKED = {
    asked: true, conflicts: [WEB_PR.url], on: CLOUD_PR.url,
    comment: 'https://github.com/parob/homecast-cloud/pull/170#issuecomment-99',
  };

  it('offers the ask when a PR conflicts, posts it, and shows where the comment went', async () => {
    fetchResolution.mockResolvedValue(CONFLICTED);
    nudgeConflicts.mockResolvedValue({ ...CONFLICTED.merge, nudge: ASKED });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const ask = await screen.findByRole('button', { name: 'Ask for homecast-web#214 to be fixed' });
    expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
    fireEvent.click(ask);

    await screen.findByText(/Asked on homecast-cloud#170 for the conflict to be fixed/);
    expect(nudgeConflicts).toHaveBeenCalledWith(167, 'tok');
    expect(screen.queryByRole('button', { name: /Ask for/ })).toBeNull();
    const comment = screen.getByRole('button', { name: `Open The comment on GitHub — ${ASKED.comment}` });
    expect(comment.textContent).toContain(ASKED.comment);
  });

  it('says it had already been asked, without a second comment', async () => {
    fetchResolution.mockResolvedValue(CONFLICTED);
    nudgeConflicts.mockResolvedValue({ ...CONFLICTED.merge, nudge: { ...ASKED, asked: false, alreadyAsked: true } });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask for homecast-web#214/ }));
    await screen.findByText(/Already asked on homecast-cloud#170/);
  });

  it('shows the ask a Merge tap set in motion when it ran into the conflict', async () => {
    const before: Resolution = {
      ...WITH_PLAN,
      merge: { configured: true, servingSha: '4ae7930', plan: [
        entry(CLOUD_PR, { action: 'merge' }),
        entry(WEB_PR, { action: 'blocked', reason: 'merge conflict', mergeable: false }),
      ] },
    };
    fetchResolution.mockResolvedValue(before);
    mergeResolution.mockResolvedValue({
      configured: true, servingSha: '4ae7930', merged: [{ url: CLOUD_PR.url, sha: 'abc' }],
      plan: [
        entry(CLOUD_PR, { action: 'merged', merged: true, serving: false }),
        entry(WEB_PR, { action: 'blocked', reason: 'merge conflict', mergeable: false }),
      ],
      nudge: ASKED,
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge homecast-cloud#170' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm merge' }));

    await screen.findByText('Merged homecast-cloud#170.');
    expect(screen.getByText(/Asked on homecast-cloud#170 for the conflict to be fixed/)).toBeTruthy();
  });

  it('shows the refusal when the comment could not be posted', async () => {
    fetchResolution.mockResolvedValue(CONFLICTED);
    nudgeConflicts.mockResolvedValue({ ...CONFLICTED.merge, nudge: { asked: false, conflicts: [WEB_PR.url], on: CLOUD_PR.url, error: 'GitHub refused the comment (403): Resource not accessible' } });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: /Ask for homecast-web#214/ }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('403'));
  });
});

/**
 * Saying something back, and choosing who hears it.
 *
 * The selector is answering one question — who reads this, and how soon — so
 * each option has to carry its own cost. The pull request wakes an agent
 * straight away; the issue waits for the next sweep. And it reaches exactly
 * one pull request: three comments would start three agents that each think
 * they are alone, so the view says which one gets it and which do not.
 */
describe('sending feedback from the issue view', () => {
  const WITH_FEEDBACK: Resolution = { ...WITH_PLAN, feedback: { configured: true } };

  it('offers no field at all on a server that predates feedback', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByRole('button', { name: /Open homecast-cloud#170 on GitHub/ });
    expect(screen.queryByRole('textbox', { name: 'Your feedback' })).toBeNull();
    expect(screen.queryByText(/Sending feedback isn.t set up/)).toBeNull();
  });

  it('says so on a server that has it unset, and offers nothing to type into', async () => {
    fetchResolution.mockResolvedValue({ ...WITH_PLAN, feedback: { configured: false } });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByText(/Sending feedback isn.t set up on this server/);
    expect(screen.queryByRole('textbox', { name: 'Your feedback' })).toBeNull();
  });

  it('defaults to the pull request, and says what each door costs', async () => {
    fetchResolution.mockResolvedValue(WITH_FEEDBACK);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const toPr = await screen.findByRole('radio', { name: /homecast-cloud#170/ });
    const toIssue = screen.getByRole('radio', { name: /Issue #167/ });
    expect(toPr.getAttribute('aria-checked')).toBe('true');
    expect(toIssue.getAttribute('aria-checked')).toBe('false');
    expect(toPr.textContent).toContain('Picked up straight away');
    // How soon the issue is read depends on whether the server can start a
    // run, so it is said after the send, from its answer — not promised here.
    expect(toIssue.textContent).toContain('About what you asked for');
    expect(toIssue.textContent).not.toContain('about a day');
  });

  it('says which pull request gets it and which do not', async () => {
    fetchResolution.mockResolvedValue(WITH_FEEDBACK);
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    const line = await screen.findByText(/Goes on homecast-cloud#170 only/);
    expect(line.textContent).toContain('homecast-web#214');
    expect(line.textContent).toContain('one agent per comment');
  });

  it('sends what was typed, to the chosen target, and shows where it landed', async () => {
    fetchResolution.mockResolvedValue(WITH_FEEDBACK);
    sendFeedback.mockResolvedValue({
      posted: true,
      target: 'pr',
      on: CLOUD_PR.url,
      comment: `${CLOUD_PR.url}#issuecomment-1`,
      named: [WEB_PR.url],
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const box = await screen.findByRole('textbox', { name: 'Your feedback' });
    // Nothing to send is nothing to tap.
    expect(screen.getByRole('button', { name: /^Send$/ }).hasAttribute('disabled')).toBe(true);

    fireEvent.change(box, { target: { value: '  The spacing is still wrong.  ' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(167, 'tok', 'pr', 'The spacing is still wrong.'));
    await screen.findByText(/Sent to homecast-cloud#170 — it gets picked up straight away/);
    expect(screen.getByText(/names homecast-web#214 as part of the same fix. Nothing was posted on them/)).toBeTruthy();

    // The comment's own address, printed in full like every link out.
    const link = screen.getByRole('button', { name: `Open The comment on GitHub — ${CLOUD_PR.url}#issuecomment-1` });
    fireEvent.click(link);
    expect(openExternalUrl).toHaveBeenCalledWith(`${CLOUD_PR.url}#issuecomment-1`);
  });

  it('sends to the issue when that is chosen, and says when it is picked up', async () => {
    fetchResolution.mockResolvedValue(WITH_FEEDBACK);
    sendFeedback.mockResolvedValue({
      posted: true, target: 'issue', on: FIXED.url, comment: `${FIXED.url}#issuecomment-2`,
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('radio', { name: /Issue #167/ }));
    expect(screen.getByText(/Goes on the report itself/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Your feedback' }), { target: { value: 'Not what I meant.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(167, 'tok', 'issue', 'Not what I meant.'));
    // No `run` in the answer — a server that predates firing — so nothing
    // claims a start.
    await screen.findByText('Sent to issue #167 — Claude picks it up at the next scheduled check, twice a day.');
    expect(screen.queryByText(/Claude has started/)).toBeNull();
  });

  it('offers only the issue when no pull request is open, with no selector to get wrong', async () => {
    fetchResolution.mockResolvedValue({
      ...WITH_FEEDBACK,
      merge: {
        ...TWO_PR_PLAN,
        plan: TWO_PR_PLAN.plan.map((e) => ({ ...e, state: 'closed', merged: true, action: 'merged' as const })),
      },
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    await screen.findByRole('textbox', { name: 'Your feedback' });
    expect(screen.queryByRole('radio')).toBeNull();
    expect(screen.getByText(/Goes on the report itself/)).toBeTruthy();

    sendFeedback.mockResolvedValue({ posted: true, target: 'issue', on: FIXED.url });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your feedback' }), { target: { value: 'Still broken.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));
    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(167, 'tok', 'issue', 'Still broken.'));
  });

  it("shows the server's refusal and keeps the words so they are not retyped", async () => {
    fetchResolution.mockResolvedValue(WITH_FEEDBACK);
    sendFeedback.mockRejectedValue(new Error('GitHub refused the comment (403): Resource not accessible by integration'));
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const box = await screen.findByRole('textbox', { name: 'Your feedback' });
    fireEvent.change(box, { target: { value: 'Try again.' } });
    fireEvent.click(screen.getByRole('button', { name: /^Send$/ }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Resource not accessible'));
    expect((box as HTMLTextAreaElement).value).toBe('Try again.');
  });
});

/**
 * What has been said, on the screen.
 *
 * The reported fault: #178 was answered with a diagnosis, a reason and a
 * question put to the reporter, and the app showed the one summary line. These
 * pin the answer being on the screen, who said it, and that a server with no
 * such field shows no section rather than an empty one.
 */
const ANSWER = [
  'Two of the three asks are fixed in homecast-web#222. The third — the one in your',
  'title — I have diagnosed but deliberately **not** changed, because it is a product',
  'decision rather than a bug.',
  '',
  '## Ask 1 — the widget light/dark treatment. Real, and not mine to change',
  '',
  "WCAG's crossover is 0.179; this app uses 0.8, deliberately. So white ink goes on",
  'essentially every photograph and every preset, which is why it feels like it',
  'changes at the wrong time: it almost never changes at all. That threshold is',
  'load-bearing — `widget-tint.ts` is built on top of it and reproduces it on purpose,',
  'so moving it would restyle every tile over every wallpaper for every user.',
  '',
  '**What I would do, if you want it:** move the *ink* decision to the WCAG crossover',
  'and leave the 0.8 mood threshold alone for the scrim and the header chrome — a',
  'contained change with a visible before/after — say the word and it gets its own PR.',
].join('\n');

const UPDATED: Resolution = {
  ...RESOLUTION,
  updates: [
    {
      id: '1', url: `${FIXED.url}#issuecomment-1`, at: new Date(Date.now() - 12 * 3_600_000).toISOString(),
      author: 'robjampar', by: 'person', text: 'Hello?', truncated: false,
      kind: 'comment', where: 'issue', whereUrl: FIXED.url, meta: null, collapsed: false,
    },
    {
      id: '2', url: `${FIXED.url}#issuecomment-2`, at: new Date(Date.now() - 11 * 60_000).toISOString(),
      author: 'robjampar', by: 'claude', text: ANSWER, truncated: false,
      kind: 'comment', where: 'issue', whereUrl: FIXED.url, meta: null, collapsed: false,
    },
  ],
};

describe('what has been said about the report', () => {
  it('shows the answer itself, newest first, with who said it and when', async () => {
    fetchResolution.mockResolvedValue(UPDATED);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    // The words the one-line summary could not carry — including the question.
    expect(updates.textContent).toContain('Ask 1 — the widget light/dark treatment');
    expect(updates.textContent).toContain('say the word and it gets its own PR');
    // Newest first: the reply that just arrived is the one being come back for.
    const said = Array.from(updates.querySelectorAll('article')).map((a) => a.textContent ?? '');
    expect(said[0]).toContain('Claude');
    expect(said[0]).toContain('11m ago');
    expect(said[1]).toContain('Hello?');
    expect(said[1]).toContain('robjampar');
  });

  it('reads the markdown rather than reprinting it', async () => {
    fetchResolution.mockResolvedValue(UPDATED);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    // The heading is a heading and the emphasis is emphasis — not `##` and
    // `**` left on the screen for the reader to parse.
    expect(updates.textContent).not.toContain('##');
    expect(updates.textContent).not.toContain('**');
    expect(updates.querySelector('strong')?.textContent).toBe('not');
    // And the hard wraps in the source are reflowed into one sentence.
    expect(updates.textContent).toContain(
      "WCAG's crossover is 0.179; this app uses 0.8, deliberately. So white ink goes on "
      + 'essentially every photograph and every preset,',
    );
  });

  it('folds every answer, the newest less than the rest, and opens on the tap', async () => {
    fetchResolution.mockResolvedValue(UPDATED);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    const bodies = Array.from(updates.querySelectorAll('article')).map(
      (article) => article.querySelector('div[class*="line-clamp"], div[class*="space-y-2"]'),
    );
    // Asked for from the app: nothing arrives as an unbounded wall of text.
    // The newest gets the taller fold; the rest the shorter one. Asserted on
    // the class because a CSS clamp is not something jsdom can measure.
    expect(bodies[0]?.className).toContain('line-clamp-[14]');
    expect(bodies[1]?.className).toContain('line-clamp-6');

    const toggles = Array.from(updates.querySelectorAll('button')).filter(
      (button) => /Show (more|less)/.test(button.textContent ?? ''),
    );
    // One long answer, one 'Hello?' — so one toggle, and it starts folded.
    expect(toggles).toHaveLength(1);
    expect(toggles[0].textContent).toContain('Show more');

    fireEvent.click(toggles[0]);
    expect(toggles[0].textContent).toContain('Show less');
    expect(
      updates.querySelectorAll('article')[0].querySelector('div[class*="line-clamp"]'),
    ).toBeNull();
  });

  it('lists the most recent and points at GitHub for the earlier ones', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: Array.from({ length: 14 }, (_, index) => ({
        id: String(index), url: `${FIXED.url}#issuecomment-${index}`,
        at: new Date(Date.now() - (14 - index) * 3_600_000).toISOString(),
        author: 'robjampar', by: 'claude' as const, text: `answer ${index}`, truncated: false,
        kind: 'comment' as const, where: 'issue', whereUrl: FIXED.url, meta: null, collapsed: false,
      })),
      earlierUpdates: 6,
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    // Ten at most on the screen, newest first, and the count of the rest —
    // a week-old report is otherwise a scroll nobody finishes.
    const said = updates.querySelectorAll('article');
    expect(said).toHaveLength(10);
    expect(said[0].textContent).toContain('answer 13');
    expect(said[9].textContent).toContain('answer 4');
    // 14 sent, 10 shown, plus the 6 the server never sent = 10 earlier. The
    // count has to include both or it under-reports what is on GitHub.
    expect(
      screen.getByRole('button', { name: `Open 10 earlier updates on GitHub on GitHub — ${FIXED.url}` }),
    ).toBeTruthy();
  });

  it('offers the rest of a comment the server had to shorten', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: [{
        id: '9', url: `${FIXED.url}#issuecomment-9`, at: new Date().toISOString(),
        author: 'robjampar', by: 'claude', text: 'A very long answer.', truncated: true,
        kind: 'comment', where: 'issue', whereUrl: FIXED.url, meta: null, collapsed: false,
      }],
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const rest = await screen.findByRole('button', {
      name: `Open Read the rest of this comment on GitHub — ${FIXED.url}#issuecomment-9`,
    });
    fireEvent.click(rest);
    expect(openExternalUrl).toHaveBeenCalledWith(`${FIXED.url}#issuecomment-9`);
  });

  it('names words sent from the app as the reader\'s own', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: [{
        id: '3', url: null, at: new Date().toISOString(), author: 'robjampar',
        by: 'app', text: 'Please also line up the blur title.', truncated: false,
        kind: 'comment', where: 'issue', whereUrl: FIXED.url, meta: null, collapsed: false,
      }],
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    expect(updates.textContent).toContain('You, from the app');
    expect(updates.textContent).toContain('Please also line up the blur title.');
  });

  it('shows no section at all on a server that predates it, or with nothing said', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    const { unmount } = render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByRole('region', { name: 'Proposed fix' });
    expect(screen.queryByRole('region', { name: 'Updates' })).toBeNull();
    unmount();

    fetchResolution.mockResolvedValue({ ...RESOLUTION, updates: [] });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByRole('region', { name: 'Proposed fix' });
    expect(screen.queryByRole('region', { name: 'Updates' })).toBeNull();
  });
});

/**
 * Everything that happened to the fix, on the report's own screen.
 *
 * Asked for on homecast-cloud#182: "it should show all of the stuff that's
 * happened ... everything that's been going on for the development of the fix
 * of that issue before I approve it and merge". So the pull requests' comments,
 * reviews and commits arrive beside the report's own, and bot output is
 * collapsed rather than filtered.
 */
const ON_THE_PR = (over: Partial<ResolutionUpdate>): ResolutionUpdate => ({
  id: 'x', url: 'https://github.com/parob/homecast-web/pull/226#c', at: new Date().toISOString(),
  author: 'robjampar', by: 'claude', kind: 'comment', where: 'homecast-web#226',
  whereUrl: 'https://github.com/parob/homecast-web/pull/226', meta: null,
  collapsed: false, text: 'said something', truncated: false, ...over,
});

describe('everything that happened to the fix', () => {
  it('shows the pull request’s activity beside the report’s, saying which is which', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: [
        { ...UPDATED.updates![0] },
        ON_THE_PR({ id: 'c1', kind: 'commit', meta: 'e195c60', collapsed: true,
          text: 'No answer arrives as an unbounded wall of text\n\nThe long body.' }),
        ON_THE_PR({ id: 'r1', kind: 'review', meta: 'approved', by: 'person', text: 'Approved' }),
      ],
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    const said = Array.from(updates.querySelectorAll('article')).map((a) => a.textContent ?? '');

    // Newest first: the review, the commit, then the report's own comment.
    expect(said[0]).toContain('approved');
    expect(said[1]).toContain('pushed e195c60');
    // Each pull request entry names its thread; the report's own does not,
    // because that is the default and labelling every row is noise.
    expect(said[0]).toContain('homecast-web#226');
    expect(said[2]).not.toContain('homecast-web#226');
  });

  it('collapses a commit to its subject and opens the body on a tap', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: [ON_THE_PR({
        id: 'c1', kind: 'commit', meta: 'e195c60', collapsed: true,
        text: 'No answer arrives as an unbounded wall of text\n\nThe long body explains why.',
      })],
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    expect(updates.textContent).toContain('No answer arrives as an unbounded wall of text');
    // Collapsed means the body is not on the screen at all yet.
    expect(updates.textContent).not.toContain('The long body explains why');

    fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(updates.textContent).toContain('The long body explains why');
  });

  it('includes bot output rather than filtering it, collapsed to a line', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: [ON_THE_PR({
        id: 'b1', by: 'bot', author: 'github-actions[bot]', collapsed: true,
        text: 'Coverage report: 91.2% of statements\n\nFull breakdown follows.',
      })],
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    // Present — nothing is judged away — but it is one line until asked.
    expect(updates.textContent).toContain('github-actions[bot]');
    expect(updates.textContent).toContain('Coverage report: 91.2% of statements');
    expect(updates.textContent).not.toContain('Full breakdown follows');
  });

  it('counts what the server left on GitHub as well as what it did not show', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: Array.from({ length: 12 }, (_, index) => ON_THE_PR({
        id: String(index), at: new Date(Date.now() - (12 - index) * 3_600_000).toISOString(),
        text: `entry ${index}`,
      })),
      earlierUpdates: 7,
    });
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    await screen.findByRole('region', { name: 'Updates' });
    // 12 sent, 10 shown, plus 7 the server never sent = 9 earlier.
    expect(
      screen.getByRole('button', { name: `Open 9 earlier updates on GitHub on GitHub — ${FIXED.url}` }),
    ).toBeTruthy();
  });
});


it('keeps an outstanding decision visible after all PRs merge', async () => {
  fetchResolution.mockResolvedValue({
    ...RESOLUTION, labels: ['needs-human', 'claude-pr-open'],
    merge: { configured: true, servingSha: 'abc', plan: [
      entry(WEB_PR, { action: 'merged', merged: true, state: 'closed' }),
    ] },
  });
  render(<IssueView issue={FIXED} onBack={() => {}} />);
  await screen.findByText('All linked pull requests are merged. This report still needs your decision; see the updates below.');
  expect(screen.getByText(/#167.*Needs your decision/)).toBeTruthy();
  expect(screen.queryByText('All merged.')).toBeNull();
});

/**
 * Whatever is waiting on the reader, first.
 *
 * The reported fault: on 19 Oct three reports had ended with the routine
 * asking the reporter something, every one of those rows read
 * `Investigating`, and the questions sat unseen. These pin the word, the
 * order of the list, and the card at the top of the screen — the question
 * itself, and a box to answer it in that starts Claude on it.
 *
 * The records are the routine's own, as it wrote them on homecast-cloud#228,
 * #227 and #222 on 20 Oct: an ask with `prs: []`; a draft to try beside a
 * question; and both labels at once on one report.
 */
const WAITING: ReportedIssue = {
  ...FIXED,
  issueNumber: 228,
  title: 'System tray at top isn’t visible when analytics is opened (batter/time etc)',
  url: 'https://github.com/parob/homecast-cloud/issues/228',
  labels: ['bug', 'issue-reporter', 'claude-attempted', 'waiting-on-reporter'],
};

const ASK = 'In the iOS app, open any automation in the editor. Can you see the clock and battery at the top?';

/** homecast-cloud#228's record: a question, and nothing built. */
const ASKING: Resolution = {
  ...RESOLUTION,
  issueNumber: 228,
  title: WAITING.title,
  url: WAITING.url,
  labels: WAITING.labels,
  summary: "Web tells the iOS app the right status-bar colour; need to know whether the app's native fix (#166) works anywhere",
  reach: 'native',
  prs: [], primary: null, evidence: [],
  merge: { configured: true, servingSha: 'abc', plan: [] },
  feedback: { configured: true },
  ask: ASK,
  verified: 'diagnosed',
  tryIt: null,
};

const RUN_URL = 'https://claude.ai/code/session_01Gd7xYzTrigger';

describe('the list puts what is waiting on you first', () => {
  const row = (issueNumber: number, labels: string[]): ReportedIssue => ({
    ...FIXED, issueNumber, title: `Report ${issueNumber}`, labels,
    url: `https://github.com/parob/homecast-cloud/issues/${issueNumber}`,
  });

  it('lifts the rows that need an answer, a decision or a phone, and keeps the rest in order', async () => {
    listed = [
      row(227, ['claude-attempted']),
      row(228, ['claude-attempted', 'waiting-on-reporter']),
      row(202, ['claude-attempted', 'awaiting-release']),
      row(201, ['claude-attempted', 'claude-pr-open', 'needs-device-check']),
      row(199, ['claude-attempted', 'claude-pr-open']),
      row(188, ['claude-attempted', 'needs-human']),
    ];
    render(<ReportedIssues onOpen={() => {}} />);
    await screen.findByRole('button', { name: 'Open #228' });

    const order = screen.getAllByRole('button', { name: /^Open #/ }).map((b) => b.getAttribute('aria-label'));
    expect(order).toEqual(['Open #228', 'Open #201', 'Open #188', 'Open #227', 'Open #202', 'Open #199']);

    expect(screen.getByRole('button', { name: 'Open #228' }).textContent).toContain('Needs your answer');
    expect(screen.getByRole('button', { name: 'Open #201' }).textContent).toContain('Try on your phone');
    expect(screen.getByRole('button', { name: 'Open #188' }).textContent).toContain('Needs your decision');
    expect(screen.getByRole('button', { name: 'Open #202' }).textContent).toContain('Waiting for app build');
    // The one solid pill: a tint describes someone else's progress, this is
    // the reader's own turn.
    const pill = screen.getByText('Needs your answer');
    expect(pill.className).toContain('bg-primary');
    expect(pill.className).not.toContain('bg-primary/15');
    expect(screen.getByText('Waiting for app build').className).toContain('bg-amber-500/15');
  });
});

describe('Claude needs your answer', () => {
  it('puts the question above everything else, with a box that answers on the issue', async () => {
    fetchResolution.mockResolvedValue(ASKING);
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    const card = await screen.findByRole('region', { name: 'Claude needs your answer' });
    expect(card.textContent).toContain(ASK);
    expect(screen.getByText(/#228 · reported .* · Needs your answer/)).toBeTruthy();
    // First on the screen: above the report the reader already knows.
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions[0]).toBe('Claude needs your answer');
    expect(regions.indexOf('You reported')).toBeGreaterThan(0);

    const send = screen.getByRole('button', { name: 'Send answer' });
    expect(send.hasAttribute('disabled')).toBe(true);
  });

  it('says Claude has started when the server fired a run, with the run as a quiet second link', async () => {
    fetchResolution.mockResolvedValue(ASKING);
    sendFeedback.mockResolvedValue({
      posted: true, target: 'issue', on: WAITING.url, comment: `${WAITING.url}#issuecomment-7`,
      run: { fired: true, url: RUN_URL, error: null },
    });
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), {
      target: { value: ' Home-screen app. The editor is fine, Analytics is not. ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(
      228, 'tok', 'issue', 'Home-screen app. The editor is fine, Analytics is not.',
    ));
    await screen.findByText('Sent to issue #228 — Claude has started on it.');
    expect(screen.getByRole('button', { name: `Open The comment on GitHub — ${WAITING.url}#issuecomment-7` })).toBeTruthy();
    const run = screen.getByRole('button', { name: `View the run — ${RUN_URL}` });
    fireEvent.click(run);
    expect(openExternalUrl).toHaveBeenCalledWith(RUN_URL);
  });

  it('never claims a start for a run that did not fire, and offers no run link', async () => {
    fetchResolution.mockResolvedValue(ASKING);
    sendFeedback.mockResolvedValue({
      posted: true, target: 'issue', on: WAITING.url,
      // A url with fired:false is still not a run anyone can watch.
      run: { fired: false, url: RUN_URL, error: 'not configured' },
    });
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), { target: { value: 'Safari.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await screen.findByText('Sent to issue #228 — Claude picks it up at the next scheduled check, twice a day.');
    expect(screen.queryByText(/Claude has started/)).toBeNull();
    expect(screen.queryByRole('button', { name: /View the run/ })).toBeNull();
  });

  it('says the same when the server sends no run at all', async () => {
    fetchResolution.mockResolvedValue(ASKING);
    sendFeedback.mockResolvedValue({ posted: true, target: 'issue', on: WAITING.url });
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), { target: { value: 'Safari.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await screen.findByText('Sent to issue #228 — Claude picks it up at the next scheduled check, twice a day.');
    expect(screen.queryByRole('button', { name: /View the run/ })).toBeNull();
  });

  it('keeps the words and shows why when the answer could not be sent', async () => {
    fetchResolution.mockResolvedValue(ASKING);
    sendFeedback.mockRejectedValue(new Error('GitHub refused the comment (403): Resource not accessible'));
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    const box = await screen.findByRole('textbox', { name: 'Your answer' });
    fireEvent.change(box, { target: { value: 'Safari.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('403'));
    expect((box as HTMLTextAreaElement).value).toBe('Safari.');
  });

  /**
   * A record written before questions had a field: the label says the
   * routine is waiting, and the question is somewhere in its last update.
   */
  it('points at the last update when the record has no question in it', async () => {
    const { ask: _a, verified: _v, tryIt: _t, ...older } = ASKING;
    fetchResolution.mockResolvedValue({
      ...older,
      updates: [{
        id: '1', url: `${WAITING.url}#issuecomment-1`, at: new Date().toISOString(), author: 'robjampar',
        by: 'claude', kind: 'comment', where: 'issue', whereUrl: WAITING.url, meta: null, collapsed: false,
        text: 'What would settle it: was this the home-screen icon or Safari?', truncated: false,
      }],
    });
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    const card = await screen.findByRole('region', { name: 'Claude needs your answer' });
    expect(card.textContent).toMatch(/See Claude.s last update below\./);
    // Still answerable from here.
    expect(screen.getByRole('textbox', { name: 'Your answer' })).toBeTruthy();
  });

  it('shows the question but no box on a server that cannot send feedback', async () => {
    const { feedback: _f, ...older } = ASKING;
    fetchResolution.mockResolvedValue(older);
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    const card = await screen.findByRole('region', { name: 'Claude needs your answer' });
    expect(card.textContent).toContain(ASK);
    expect(card.textContent).toContain('Reply on GitHub — the link is below.');
    expect(screen.queryByRole('textbox', { name: 'Your answer' })).toBeNull();
  });

  it('is the same card for a decision, pointing at the update that sets it out', async () => {
    const deciding = { ...WAITING, labels: ['bug', 'claude-attempted', 'needs-human'] };
    fetchResolution.mockResolvedValue({ ...ASKING, ask: null, labels: deciding.labels, updates: UPDATED.updates });
    sendFeedback.mockResolvedValue({
      posted: true, target: 'issue', on: WAITING.url, run: { fired: true, url: null, error: null },
    });
    render(<IssueView issue={deciding} onBack={() => {}} />);

    const card = await screen.findByRole('region', { name: 'Claude needs your decision' });
    expect(card.textContent).toMatch(/See Claude.s last update below\./);
    fireEvent.change(screen.getByRole('textbox', { name: 'Your reply' }), { target: { value: 'Go ahead.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(228, 'tok', 'issue', 'Go ahead.'));
    // Fired, but the platform gave no address: the sentence, and no link.
    await screen.findByText('Sent to issue #228 — Claude has started on it.');
    expect(screen.queryByRole('button', { name: /View the run/ })).toBeNull();
  });

  /**
   * `prs: []` with a summary and `verified: diagnosed` is a diagnosis, not a
   * fix. It used to read as "Proposed fix" with nothing proposed.
   */
  it('does not dress a question-only record up as a fix', async () => {
    fetchResolution.mockResolvedValue(ASKING);
    render(<IssueView issue={WAITING} onBack={() => {}} />);

    const fix = await screen.findByRole('region', { name: 'Proposed fix' });
    expect(fix.textContent).toContain('No fix proposed yet.');
    // The routine's line on where it stands is still there, under "no fix".
    expect(fix.textContent).toContain('need to know whether the app');
    expect(fix.textContent).not.toContain('Built from the code');
  });

  it('shows no card on a report that is waiting on nobody but Claude', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    await screen.findByRole('region', { name: 'Proposed fix' });
    expect(screen.queryByRole('region', { name: /Claude needs/ })).toBeNull();
    expect(screen.queryByRole('region', { name: /on your phone/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Still broken/ })).toBeNull();
  });
});

/**
 * A fix built from the code, put in front of the one person with the phone.
 */
describe('Try this on your phone', () => {
  const CHECKING: ReportedIssue = {
    ...FIXED,
    issueNumber: 201,
    title: 'Hidden accessories should stay visible inside their room',
    url: 'https://github.com/parob/homecast-cloud/issues/201',
    labels: ['bug', 'claude-attempted', 'claude-pr-open', 'needs-device-check'],
  };
  const TRY = 'Hide an accessory on the home screen, then open its room — it should still be there.';
  const DRAFT = { repo: 'parob/homecast-web', number: 284, url: 'https://github.com/parob/homecast-web/pull/284' };
  const TO_TRY: Resolution = {
    ...RESOLUTION,
    issueNumber: 201,
    labels: CHECKING.labels,
    url: CHECKING.url,
    primary: DRAFT,
    prs: [DRAFT],
    evidence: [],
    merge: {
      configured: true, servingSha: 'abc',
      plan: [entry(DRAFT, { action: 'blocked', reason: 'pull request is still a draft' })],
    },
    feedback: { configured: true },
    verified: 'diagnosed',
    tryIt: TRY,
  };

  it('says what to try, and that nobody has seen the fix working yet', async () => {
    fetchResolution.mockResolvedValue(TO_TRY);
    render(<IssueView issue={CHECKING} onBack={() => {}} />);

    const card = await screen.findByRole('region', { name: 'Try this on your phone' });
    expect(card.textContent).toContain(TRY);
    expect(card.textContent).toContain('built from the code, and nobody has seen it working on a device yet.');
    // A draft cannot merge, so the card does not send the reader to a button
    // that is not there…
    expect(card.textContent).not.toContain('merge it below');
    // …and the fix section does not say "built from the code" a second time.
    expect(screen.queryByText('Built from the code — not yet seen working on a device.')).toBeNull();
  });

  it('points at Merge when a tap would merge the fix, and keeps the Merge flow as it was', async () => {
    fetchResolution.mockResolvedValue({
      ...TO_TRY,
      merge: { configured: true, servingSha: 'abc', plan: [entry(DRAFT, { action: 'merge' })] },
    });
    render(<IssueView issue={CHECKING} onBack={() => {}} />);

    const card = await screen.findByRole('region', { name: 'Try this on your phone' });
    expect(card.textContent).toContain('— merge it below to try it.');
    expect(screen.getByRole('button', { name: 'Merge homecast-web#284' })).toBeTruthy();
  });

  it('sends Still broken to the open pull request, where the session that built it reads it', async () => {
    fetchResolution.mockResolvedValue(TO_TRY);
    sendFeedback.mockResolvedValue({
      posted: true, target: 'pr', on: DRAFT.url, comment: `${DRAFT.url}#issuecomment-3`,
    });
    render(<IssueView issue={CHECKING} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Still broken' }));
    expect(screen.getByText('Goes on homecast-web#284.')).toBeTruthy();
    // Saying more is optional: on a phone the tap is the message.
    const send = screen.getByRole('button', { name: 'Tell Claude' });
    expect(send.hasAttribute('disabled')).toBe(false);
    fireEvent.click(send);

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(201, 'tok', 'pr', 'Still broken.'));
    await screen.findByText('Sent to homecast-web#284 — it gets picked up straight away.');
  });

  it('sends it to the issue once no pull request is open, with what was typed', async () => {
    fetchResolution.mockResolvedValue({
      ...TO_TRY,
      merge: {
        configured: true, servingSha: 'abc',
        plan: [entry(DRAFT, { action: 'merged', merged: true, state: 'closed', serving: true })],
      },
    });
    sendFeedback.mockResolvedValue({
      posted: true, target: 'issue', on: CHECKING.url, run: { fired: true, url: RUN_URL, error: null },
    });
    render(<IssueView issue={CHECKING} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Still broken' }));
    expect(screen.getByText('Goes on issue #201.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'What did you see?' }), {
      target: { value: 'The lamp is gone from Bedroom.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tell Claude' }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(
      201, 'tok', 'issue', 'Still broken. The lamp is gone from Bedroom.',
    ));
    await screen.findByText('Sent to issue #201 — Claude has started on it.');
  });

  it('says a fix watched in a test still has not been watched on a device', async () => {
    fetchResolution.mockResolvedValue({ ...TO_TRY, verified: 'seen' });
    render(<IssueView issue={CHECKING} onBack={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Try this on your phone' });
    expect(card.textContent).toContain('seen working in a test, but not yet on a device.');
    expect(card.textContent).not.toContain('built from the code');
  });

  it('asks the reader to check the fix even when the record says nothing about how', async () => {
    const { tryIt: _t, ...older } = TO_TRY;
    fetchResolution.mockResolvedValue(older);
    render(<IssueView issue={CHECKING} onBack={() => {}} />);
    const card = await screen.findByRole('region', { name: 'Try the fix on your phone' });
    expect(card.textContent).toContain('nobody has seen it working on a device yet');
  });

  it('cancels back to the button without sending', async () => {
    fetchResolution.mockResolvedValue(TO_TRY);
    render(<IssueView issue={CHECKING} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Still broken' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Still broken' })).toBeTruthy();
    expect(sendFeedback).not.toHaveBeenCalled();
  });
});

/** "It came back", from a report marked fixed. */
describe('Still broken? on a fixed report', () => {
  const CLOSED: ReportedIssue = {
    ...FIXED,
    issueNumber: 200,
    title: 'When changing homes with the top menu keep the room',
    state: 'closed',
    url: 'https://github.com/parob/homecast-cloud/issues/200',
    labels: ['bug', 'claude-attempted'],
  };
  const FIXED_RESOLUTION: Resolution = {
    ...RESOLUTION, issueNumber: 200, state: 'closed', labels: CLOSED.labels, url: CLOSED.url,
    feedback: { configured: true }, verified: 'seen',
  };

  it('is one quiet button until it is asked for, then posts as still broken on the issue', async () => {
    fetchResolution.mockResolvedValue(FIXED_RESOLUTION);
    sendFeedback.mockResolvedValue({
      posted: true, target: 'issue', on: CLOSED.url, comment: `${CLOSED.url}#issuecomment-9`,
      run: { fired: true, url: RUN_URL, error: null },
    });
    render(<IssueView issue={CLOSED} onBack={() => {}} />);

    const button = await screen.findByRole('button', { name: 'Still broken?' });
    expect(screen.queryByRole('textbox', { name: 'What did you see?' })).toBeNull();
    fireEvent.click(button);

    expect(screen.getByText('Goes on issue #200.')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'What did you see?' }), {
      target: { value: 'Switching homes lands on the first room again.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tell Claude' }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(
      200, 'tok', 'issue', 'Still broken. Switching homes lands on the first room again.', { reopen: true },
    ));
    await screen.findByText('Sent to issue #200 — Claude has started on it.');
    expect(screen.getByRole('button', { name: `View the run — ${RUN_URL}` })).toBeTruthy();
  });

  it('says the next scheduled check when no run fired', async () => {
    fetchResolution.mockResolvedValue(FIXED_RESOLUTION);
    sendFeedback.mockResolvedValue({ posted: true, target: 'issue', on: CLOSED.url });
    render(<IssueView issue={CLOSED} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Still broken?' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tell Claude' }));

    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(200, 'tok', 'issue', 'Still broken.', { reopen: true }));
    await screen.findByText('Sent to issue #200 — Claude picks it up at the next scheduled check, twice a day.');
  });

  it('offers nothing on a server that cannot send feedback', async () => {
    const { feedback: _f, ...older } = FIXED_RESOLUTION;
    fetchResolution.mockResolvedValue(older);
    render(<IssueView issue={CLOSED} onBack={() => {}} />);
    await screen.findByRole('region', { name: 'Proposed fix' });
    expect(screen.queryByRole('button', { name: 'Still broken?' })).toBeNull();
  });
});

/** How far the fix has been seen to work, said once and plainly. */
describe('how the fix was verified', () => {
  it('says a diagnosed fix was built from the code', async () => {
    fetchResolution.mockResolvedValue({ ...RESOLUTION, verified: 'diagnosed' });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    const fix = await screen.findByRole('region', { name: 'Proposed fix' });
    expect(fix.textContent).toContain('Built from the code — not yet seen working on a device.');
  });

  it('says a seen fix was seen failing first', async () => {
    fetchResolution.mockResolvedValue({ ...RESOLUTION, verified: 'seen' });
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    const fix = await screen.findByRole('region', { name: 'Proposed fix' });
    expect(fix.textContent).toContain('Seen failing, then fixed.');
    expect(fix.textContent).not.toContain('Built from the code');
  });

  it('says nothing on a record that predates the field', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    render(<IssueView issue={FIXED} onBack={() => {}} />);
    const fix = await screen.findByRole('region', { name: 'Proposed fix' });
    expect(fix.textContent).not.toMatch(/Built from the code|Seen failing/);
  });
});

/**
 * A question and a fix to try, on one report.
 *
 * homecast-cloud#222 on 20 Oct: the routine built a draft and asked a question
 * in the same run, and the issue carried `waiting-on-reporter` and
 * `needs-device-check` together. #227 asked a question beside its draft
 * without the waiting label. Both cards show, the question first — the answer
 * may change the fix.
 */
describe('a question and a fix to try, together', () => {
  const DRAFT = { repo: 'parob/homecast-web', number: 284, url: 'https://github.com/parob/homecast-web/pull/284' };
  const BOTH: ReportedIssue = {
    ...FIXED,
    issueNumber: 222,
    title: 'I can’t see how to create collections in the iOS native app there’s no way to create the collections',
    url: 'https://github.com/parob/homecast-cloud/issues/222',
    labels: ['bug', 'issue-reporter', 'claude-attempted', 'claude-pr-open', 'waiting-on-reporter', 'needs-device-check'],
  };
  const RECORD_222: Resolution = {
    ...RESOLUTION,
    issueNumber: 222,
    url: BOTH.url,
    labels: BOTH.labels,
    summary: 'Native menu always offers New Collection, so the iOS app can create a collection',
    reach: 'web',
    primary: DRAFT,
    prs: [DRAFT],
    evidence: [{ url: 'https://storage.test/new-collection.png', alt: 'after: New Collection opens Create Collection' }],
    merge: {
      configured: true, servingSha: 'abc',
      plan: [entry(DRAFT, { action: 'blocked', reason: 'pull request is still a draft' })],
    },
    feedback: { configured: true },
    verified: 'diagnosed',
    ask: "When a collection didn't open on tap, which control did you tap: the menu under the title, or something else?",
    tryIt: 'After merging and restarting the app: tap the title at the top. Under Collections you should see New Collection; tap it, name one, and it should open.',
  };

  it('asks first, then hands over the fix to try, and says the diagnosis once', async () => {
    fetchResolution.mockResolvedValue(RECORD_222);
    render(<IssueView issue={BOTH} onBack={() => {}} />);

    const ask = await screen.findByRole('region', { name: 'Claude needs your answer' });
    const tryIt = screen.getByRole('region', { name: 'Try this on your phone' });
    expect(screen.getByText(/#222 · reported .* · Needs your answer/)).toBeTruthy();

    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions.slice(0, 3)).toEqual(['Claude needs your answer', 'Try this on your phone', 'You reported']);

    expect(ask.textContent).toContain('which control did you tap');
    expect(tryIt.textContent).toContain('Under Collections you should see New Collection');
    // The draft cannot merge from here, so neither card points at a button.
    expect(tryIt.textContent).not.toContain('merge it below');
    expect(screen.getByText('homecast-web#284: pull request is still a draft.')).toBeTruthy();
    // The try card says how the fix was built; the fix section does not repeat it.
    expect(screen.getByRole('region', { name: 'Proposed fix' }).textContent).not.toContain('Built from the code');
  });

  it('answers on the issue from the first card, and says still broken on the draft from the second', async () => {
    fetchResolution.mockResolvedValue(RECORD_222);
    sendFeedback.mockImplementation(async (_n: number, _t: string, target: string) => (
      target === 'issue'
        ? { posted: true, target: 'issue', on: BOTH.url, run: { fired: true, url: RUN_URL, error: null } }
        : { posted: true, target: 'pr', on: DRAFT.url }
    ));
    render(<IssueView issue={BOTH} onBack={() => {}} />);

    fireEvent.change(await screen.findByRole('textbox', { name: 'Your answer' }), { target: { value: 'The menu under the title.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(222, 'tok', 'issue', 'The menu under the title.'));
    await screen.findByText('Sent to issue #222 — Claude has started on it.');

    fireEvent.click(screen.getByRole('button', { name: 'Still broken' }));
    expect(screen.getByText('Goes on homecast-web#284.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tell Claude' }));
    await waitFor(() => expect(sendFeedback).toHaveBeenCalledWith(222, 'tok', 'pr', 'Still broken.'));
    await screen.findByText('Sent to homecast-web#284 — it gets picked up straight away.');
  });

  it('shows a question the record carries even without the waiting label, said less strongly', async () => {
    const NATIVE = { repo: 'parob/homecast', number: 81, url: 'https://github.com/parob/homecast/pull/81' };
    const checking: ReportedIssue = {
      ...FIXED,
      issueNumber: 227,
      url: 'https://github.com/parob/homecast-cloud/issues/227',
      labels: ['bug', 'issue-reporter', 'claude-attempted', 'claude-pr-open', 'needs-device-check'],
    };
    fetchResolution.mockResolvedValue({
      ...RECORD_222,
      issueNumber: 227,
      url: checking.url,
      labels: checking.labels,
      reach: 'native',
      primary: NATIVE, prs: [NATIVE], evidence: [],
      merge: { configured: true, servingSha: 'abc', plan: [entry(NATIVE, { action: 'blocked', reason: 'pull request is still a draft' })] },
      ask: 'When Back shows the grey screen, does it stay grey, or does Home appear by itself after a second?',
      tryIt: 'With a build carrying #81: open a room, close the app fully, reopen (it lands on the room), tap Back.',
    });
    render(<IssueView issue={checking} onBack={() => {}} />);

    // The word is the label's — Try on your phone — and the question still shows.
    await screen.findByText(/#227 · reported .* · Try on your phone/);
    const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(regions.slice(0, 2)).toEqual(['Claude has a question', 'Try this on your phone']);
    expect(screen.queryByRole('region', { name: 'Claude needs your answer' })).toBeNull();
  });
});
