/**
 * Reading what has already been reported.
 *
 * Goes through the server for the same reason submitting does: the issue
 * reporter's credential lives there, not in a bundle.
 */

import { config } from '@/lib/config';

export interface ReportedIssue {
  issueNumber: number;
  title: string;
  state: 'open' | 'closed' | string;
  url: string;
  labels: string[];
  createdAt: string | null;
  updatedAt: string | null;
  commentCount: number;
}

export interface ReportedIssuePage {
  issues: ReportedIssue[];
  page: number;
  hasMore: boolean;
}

export type IssueFilter = 'open' | 'closed' | 'all';

/**
 * When a timestamp says, in milliseconds — NaN for anything unusable.
 *
 * The reporter answers `2026-09-22 07:00:03+00:00`: a space where ISO 8601
 * has a `T`, which `Date` is only required to parse for the ISO form. Node
 * takes it; JavaScriptCore is where this app actually runs, and a date that
 * silently reads as NaN there would blank every age in the view. Normalising
 * costs one replace.
 */
function timeOf(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return new Date(iso.replace(' ', 'T')).getTime();
}

/** `today`, `yesterday`, `3d ago`, `2mo ago`, `1y ago` — or '' for nothing usable. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  const then = timeOf(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

/**
 * The same, to the minute for anything recent: `just now`, `11m ago`, `3h ago`.
 *
 * A comment's own age is the thing a reader checks first — whether what they
 * are looking at is the answer that just arrived. `today` cannot say that, so
 * anything under a day is counted in hours and minutes and the rest falls
 * through to `relativeAge`, which is what the report's own age still uses.
 */
export function relativeMoment(iso: string | null | undefined, now: number = Date.now()): string {
  const then = timeOf(iso);
  if (Number.isNaN(then)) return '';
  const minutes = Math.floor((now - then) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return relativeAge(iso, now);
}

export async function fetchReportedIssues(
  { state, page, limit = 20 }: { state: IssueFilter; page: number; limit?: number },
  token: string,
): Promise<ReportedIssuePage> {
  const query = new URLSearchParams({
    state,
    page: String(page),
    limit: String(limit),
  });

  const response = await fetch(
    `${config.apiUrl}/rest/issue-report?${query.toString()}`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    if (response.status === 403) throw new Error('Reporting is limited to admin accounts.');
    throw new Error('Could not load reports right now.');
  }
  return (await response.json()) as ReportedIssuePage;
}
