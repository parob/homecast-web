/**
 * Sending a report to the server, which files it as a GitHub issue.
 *
 * The client never holds the issue reporter's credential and never talks to it
 * directly — it posts here, and the server attaches the key. That also puts the
 * admin check somewhere it cannot be edited out of a bundle.
 */

import { buildDiagnosticsBundle } from '@/lib/relay-diagnostics';
import { config } from '@/lib/config';

import type { CapturedMedia } from './capture';

export interface SubmitReportInput {
  summary: string;
  severity: 'info' | 'warning' | 'critical';
  media: CapturedMedia[];
  /** Extra context worth recording, e.g. the route the user was on. */
  extra?: Record<string, unknown>;
  /**
   * Add this report to an issue that is already open, rather than filing a
   * new one. What the reporter picked in Previous.
   *
   * The answer still comes back from the server — never assume the report
   * landed where it was asked to. A server that predates the field ignores it
   * and files a new issue, and saying otherwise would be a lie the reporter
   * cannot check.
   */
  issueNumber?: number;
}

export interface SubmitReportResult {
  issueNumber: number;
  issueUrl: string;
  deduplicated: boolean;
  attachmentsStored: number;
  attachmentsSkipped: string[];
}

/**
 * A report can carry a screen recording, so the ceiling is generous. It is
 * still bounded: a request that hangs forever leaves the user staring at a
 * spinner with no idea whether their report was filed.
 */
const SUBMIT_TIMEOUT_MS = 120_000;

export async function submitReport(
  input: SubmitReportInput,
  token: string,
): Promise<SubmitReportResult> {
  const form = new FormData();
  form.append('summary', input.summary);
  form.append('severity', input.severity);
  if (input.issueNumber !== undefined) {
    form.append('issueNumber', String(input.issueNumber));
  }
  form.append(
    'diagnostics',
    JSON.stringify(
      buildDiagnosticsBundle({
        route: window.location.pathname + window.location.hash,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        ...(input.extra || {}),
      }),
    ),
  );
  for (const item of input.media) {
    form.append('file', item.blob, item.filename);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${config.apiUrl}/rest/issue-report`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('That took too long — the report was not filed.');
    }
    throw new Error('Could not reach the server — the report was not filed.');
  }
  clearTimeout(timer);

  if (!response.ok) {
    // Say plainly that nothing was recorded. A user who believes a problem is
    // filed when it is not stops reporting things.
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      /* body was not JSON */
    }
    if (response.status === 403) {
      throw new Error('Reporting is limited to admin accounts.');
    }
    throw new Error(detail || `The report was not filed (${response.status}).`);
  }

  return (await response.json()) as SubmitReportResult;
}
