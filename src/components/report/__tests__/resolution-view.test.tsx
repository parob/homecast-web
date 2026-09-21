// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { ReportedIssues } from '../ReportedIssues';
import { ResolutionView } from '../ResolutionView';
import type { ReportedIssue } from '@/lib/report/issues';
import type { MergePlanEntry, MergeState, Resolution } from '@/lib/report/resolution';

/**
 * Seeing the fix for a reported issue.
 *
 * Two things pinned down. The row offers a Fix button only where there is a
 * fix to show — a row with the routine's PR label, or a closed one — so the
 * button is never a door to "nothing yet" on every row. And the view puts the
 * evidence on screen: the picture with its caption, the one line, and the
 * pull requests by name, each opening on GitHub rather than pretending to be
 * actionable here.
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
const openExternalUrl = vi.fn();

vi.mock('@/lib/report/issues', () => ({
  fetchReportedIssues: async () => ({ issues: [FIXED, UNTOUCHED], page: 1, hasMore: false }),
}));

vi.mock('@/lib/report/resolution', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/report/resolution')>()),
  fetchResolution: (...args: unknown[]) => fetchResolution(...args),
  mergeResolution: (...args: unknown[]) => mergeResolution(...args),
}));

vi.mock('@/lib/open-url', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

beforeEach(() => {
  localStorage.setItem('homecast-token', 'tok');
  fetchResolution.mockReset();
  mergeResolution.mockReset();
  openExternalUrl.mockReset();
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('the Fix button on a reported row', () => {
  it('is offered on the row with a PR open for it, and not on the one nobody has touched', async () => {
    const onShowResolution = vi.fn();
    render(<ReportedIssues onShowResolution={onShowResolution} />);

    const button = await screen.findByRole('button', { name: 'See the resolution for #167' });
    expect(screen.queryByRole('button', { name: 'See the resolution for #170' })).toBeNull();

    fireEvent.click(button);
    expect(onShowResolution).toHaveBeenCalledWith(FIXED);
  });

  it('is absent when the list is only a picker', async () => {
    render(<ReportedIssues onAddTo={() => {}} />);
    await screen.findByRole('button', { name: /Add this report to #167/ });
    expect(screen.queryByRole('button', { name: /See the resolution/ })).toBeNull();
  });
});

describe('the resolution view', () => {
  it('shows the picture, the line and the pull request, each opening where it lives', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);

    const picture = await screen.findByRole('img', { name: 'Before: invisible. After: legible.' });
    expect(picture.getAttribute('src')).toBe('https://storage.test/pair.png');
    expect(fetchResolution).toHaveBeenCalledWith(167, 'tok');

    expect(screen.getByText("the battery line now takes the tile's white ink")).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /homecast-web#208/ }));
    expect(openExternalUrl).toHaveBeenCalledWith('https://github.com/parob/homecast-web/pull/208');

    // The report's own screenshot is there, but as context, not as evidence.
    expect(screen.getByRole('button', { name: 'Open screenshot.jpg' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open Before: invisible. After: legible. full size' })).toBeTruthy();
  });

  it('says so when the server has nothing recorded, rather than failing', async () => {
    fetchResolution.mockResolvedValue(null);
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);

    await screen.findByText('No resolution recorded yet.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says so when there are no pull requests and no pictures yet', async () => {
    fetchResolution.mockResolvedValue({ ...RESOLUTION, prs: [], evidence: [], summary: null, primary: null });
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);
    await screen.findByText('No resolution recorded yet.');
  });

  it('shows the failure when the load actually fails', async () => {
    fetchResolution.mockRejectedValue(new Error('Could not load the resolution right now.'));
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Could not load'));
  });

  it('goes back to the list', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    const onBack = vi.fn();
    render(<ResolutionView issue={FIXED} onBack={onBack} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to reports' }));
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
describe('merging from the resolution view', () => {
  it('offers no Merge on a server that predates merging, and says so on one that has it unset', async () => {
    fetchResolution.mockResolvedValue(RESOLUTION);
    const { unmount } = render(<ResolutionView issue={FIXED} onBack={() => {}} />);
    await screen.findByRole('button', { name: /homecast-web#208/ });
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
    expect(screen.queryByText(/isn.t set up/)).toBeNull();
    unmount();

    fetchResolution.mockResolvedValue({ ...RESOLUTION, merge: { configured: false, servingSha: '', plan: [] } });
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);
    await screen.findByText(/Merging isn.t set up on this server/);
    expect(screen.queryByRole('button', { name: /^Merge/ })).toBeNull();
  });

  it('shows each PR with its place in the plan, and names the one the button merges', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);

    // `^`: the Merge button's name carries the same PR, and the row is the one
    // whose name starts with it.
    const cloud = await screen.findByRole('button', { name: /^homecast-cloud#170/ });
    expect(cloud.textContent).toContain('Ready');
    expect(screen.getByRole('button', { name: /^homecast-web#214/ }).textContent).toContain('Waits for deploy');
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
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Merge homecast-cloud#170' }));
    // Nothing merged by pressing Merge: the confirmation is the gate.
    expect(mergeResolution).not.toHaveBeenCalled();
    expect(screen.getByText(/Merges homecast-cloud#170 to/).textContent).toContain('ships to production');
    expect(screen.getByText(/Merges homecast-cloud#170 to/).textContent).toContain('The rest waits for it to deploy');

    fireEvent.click(screen.getByRole('button', { name: 'Confirm merge' }));
    await waitFor(() => expect(mergeResolution).toHaveBeenCalledWith(167, 'tok'));

    await screen.findByText('Merged homecast-cloud#170.');
    // The plan re-rendered from the server's answer: cloud deploying, web waiting.
    expect(screen.getByRole('button', { name: /^homecast-cloud#170/ }).textContent).toContain('Merged · deploying');
    expect(screen.getByText(/homecast-web#214: homecast-cloud#170 is merged but not serving yet/)).toBeTruthy();
    // Nothing merges now, so the button is gone and a re-check is offered.
    expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fetchResolution).toHaveBeenCalledTimes(2));
  });

  it('cancels without merging', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Merge homecast-cloud#170' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm merge' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Merge homecast-cloud#170' })).toBeTruthy();
    expect(mergeResolution).not.toHaveBeenCalled();
  });

  it('shows the refusal when the merge fails, and keeps the plan', async () => {
    fetchResolution.mockResolvedValue(WITH_PLAN);
    mergeResolution.mockRejectedValue(new Error('GitHub refused the merge (405): Required status check is failing'));
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);
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
    render(<ResolutionView issue={FIXED} onBack={() => {}} />);
    await screen.findByText('All merged.');
    expect(screen.getByRole('button', { name: /^homecast-cloud#170/ }).textContent).toContain('Merged · serving');
    expect(screen.queryByRole('button', { name: /^Merge / })).toBeNull();
  });
});
