// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

import { ReportSheet } from '../ReportSheet';
import type { ReportedIssue } from '@/lib/report/issues';

/**
 * Sending a report to an issue that is already open.
 *
 * The point of the feature is one field on one request, so that is what these
 * pin down: that picking a report in Previous puts its number on the submitted
 * report, that clearing the banner takes it off again, and — the part that is
 * easy to get wrong — that the confirmation names where the report ACTUALLY
 * went rather than where it was asked to go.
 */

const ISSUES: ReportedIssue[] = [
  {
    issueNumber: 71,
    title: 'Analytics draws a value for the outage window',
    state: 'open',
    url: 'https://github.com/parob/homecast-cloud/issues/71',
    labels: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    commentCount: 2,
  },
];

const submitReport = vi.fn();
const toastSuccess = vi.fn();

vi.mock('@/lib/report/submit', () => ({
  submitReport: (...args: unknown[]) => submitReport(...args),
}));

vi.mock('@/lib/report/issues', () => ({
  fetchReportedIssues: async () => ({ issues: ISSUES, page: 1, hasMore: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: vi.fn(),
  },
}));

// Nothing here records or rasterises; the sheet only needs these to render.
vi.mock('@/lib/report/capture', () => ({
  MAX_ATTACHMENT_BYTES: 50 * 1024 * 1024,
  MAX_RECORDING_MS: 60_000,
  canRecord: () => false,
  prepareImageForUpload: async (file: Blob) => file,
  startRecording: async () => null,
}));

/** Write a report, optionally adding it to the one issue in the list. */
async function compose(addToIssue: boolean) {
  render(<ReportSheet open onOpenChange={() => {}} />);

  if (addToIssue) {
    // Radix switches tabs on mousedown, not click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Previous' }));
    fireEvent.click(await screen.findByRole('button', { name: /Add this report to #71/ }));
  }

  fireEvent.change(screen.getByLabelText('Your feedback'), {
    target: { value: 'It is still happening' },
  });
}

const sentReport = () => submitReport.mock.calls[0][0] as { issueNumber?: number };

describe('adding a report to an existing issue', () => {
  beforeEach(() => {
    submitReport.mockReset();
    toastSuccess.mockReset();
    localStorage.setItem('homecast-token', 'test-token');
    submitReport.mockResolvedValue({
      issueNumber: 71, issueUrl: '', deduplicated: true,
      attachmentsStored: 0, attachmentsSkipped: [],
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('sends no issue number when nothing was picked', async () => {
    submitReport.mockResolvedValue({
      issueNumber: 99, issueUrl: '', deduplicated: false,
      attachmentsStored: 0, attachmentsSkipped: [],
    });
    await compose(false);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(submitReport).toHaveBeenCalled());
    expect(sentReport().issueNumber).toBeUndefined();
  });

  it('carries the chosen issue on the report', async () => {
    await compose(true);

    // Picking one comes back to the compose tab, saying where it will go.
    expect(screen.getByText('Adding to #71')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(submitReport).toHaveBeenCalled());
    expect(sentReport().issueNumber).toBe(71);
  });

  it('goes back to a new issue when the banner is cleared', async () => {
    await compose(true);

    fireEvent.click(screen.getByRole('button', { name: 'File a new report instead' }));
    expect(screen.queryByText('Adding to #71')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(submitReport).toHaveBeenCalled());
    expect(sentReport().issueNumber).toBeUndefined();
  });

  it('names where the report actually landed, not where it was aimed', async () => {
    // What an un-promoted server does: the field is ignored and a new issue is
    // opened. Claiming "Added to #71" here would be a lie the reporter cannot
    // check.
    submitReport.mockResolvedValue({
      issueNumber: 104, issueUrl: '', deduplicated: false,
      attachmentsStored: 0, attachmentsSkipped: [],
    });
    await compose(true);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    const [message, options] = toastSuccess.mock.calls[0] as [string, { description?: string }];
    expect(message).toBe('Sent as #104.');
    expect(options.description).toContain('could not be added to #71');
  });

  it('confirms the issue it was added to when that worked', async () => {
    await compose(true);

    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toBe('Added to #71. Thank you.');
  });
});
