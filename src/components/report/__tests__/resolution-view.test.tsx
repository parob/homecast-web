// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { ReportedIssues } from '../ReportedIssues';
import { ResolutionView } from '../ResolutionView';
import type { ReportedIssue } from '@/lib/report/issues';
import type { Resolution } from '@/lib/report/resolution';

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

const fetchResolution = vi.fn();
const openExternalUrl = vi.fn();

vi.mock('@/lib/report/issues', () => ({
  fetchReportedIssues: async () => ({ issues: [FIXED, UNTOUCHED], page: 1, hasMore: false }),
}));

vi.mock('@/lib/report/resolution', async (importActual) => ({
  ...(await importActual<typeof import('@/lib/report/resolution')>()),
  fetchResolution: (...args: unknown[]) => fetchResolution(...args),
}));

vi.mock('@/lib/open-url', () => ({
  openExternalUrl: (url: string) => openExternalUrl(url),
}));

beforeEach(() => {
  localStorage.setItem('homecast-token', 'tok');
  fetchResolution.mockReset();
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
