// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { ReportedIssues } from '../ReportedIssues';
import { IssueView } from '../IssueView';
import type { ReportedIssue } from '@/lib/report/issues';
import type { MergePlanEntry, MergeState, Resolution } from '@/lib/report/resolution';

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

const fetchResolution = vi.fn();
const mergeResolution = vi.fn();
const nudgeConflicts = vi.fn();
const sendFeedback = vi.fn();
const openExternalUrl = vi.fn();

vi.mock('@/lib/report/issues', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/report/issues')>()),
  fetchReportedIssues: async () => ({ issues: [FIXED, UNTOUCHED], page: 1, hasMore: false }),
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
    expect(screen.getByText(/#167 · reported 3d ago · Open/)).toBeTruthy();

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
    await screen.findByText('All merged.');
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
    expect(toIssue.textContent).toContain('Next sweep');
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

  it('sends to the issue when that is chosen, and says it waits for the sweep', async () => {
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
    await screen.findByText(/Sent to issue #167 — it gets picked up on the next sweep, about a day/);
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
  'Two of the three asks are fixed in homecast-web#222.',
  '',
  '## Ask 1 — the widget light/dark treatment. Real, and not mine to change',
  '',
  "WCAG's crossover is 0.179; this app uses 0.8, deliberately.",
  '',
  '**What I would do, if you want it:** say the word and it gets its own PR.',
].join('\n');

const UPDATED: Resolution = {
  ...RESOLUTION,
  updates: [
    {
      id: '1', url: `${FIXED.url}#issuecomment-1`, at: new Date(Date.now() - 12 * 3_600_000).toISOString(),
      author: 'robjampar', by: 'person', text: 'Hello?', truncated: false,
    },
    {
      id: '2', url: `${FIXED.url}#issuecomment-2`, at: new Date(Date.now() - 11 * 60_000).toISOString(),
      author: 'robjampar', by: 'claude', text: ANSWER, truncated: false,
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
    expect(updates.querySelector('strong')?.textContent).toBe('What I would do, if you want it:');
    // And the hard wraps in the source are reflowed into one sentence.
    expect(updates.textContent).toContain(
      "WCAG's crossover is 0.179; this app uses 0.8, deliberately.",
    );
  });

  it('opens the newest and folds the rest, and only offers the toggle where there is more', async () => {
    fetchResolution.mockResolvedValue(UPDATED);
    render(<IssueView issue={FIXED} onBack={() => {}} />);

    const updates = await screen.findByRole('region', { name: 'Updates' });
    const toggles = Array.from(updates.querySelectorAll('button')).filter(
      (button) => /Show (more|less)/.test(button.textContent ?? ''),
    );
    // One long answer, one 'Hello?' — so one toggle, and it starts open.
    expect(toggles).toHaveLength(1);
    expect(toggles[0].textContent).toContain('Show less');

    fireEvent.click(toggles[0]);
    expect(toggles[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('offers the rest of a comment the server had to shorten', async () => {
    fetchResolution.mockResolvedValue({
      ...RESOLUTION,
      updates: [{
        id: '9', url: `${FIXED.url}#issuecomment-9`, at: new Date().toISOString(),
        author: 'robjampar', by: 'claude', text: 'A very long answer.', truncated: true,
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
