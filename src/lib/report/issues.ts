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

/** `today`, `yesterday`, `3d ago`, `2mo ago`, `1y ago` — or '' for nothing usable. */
export function relativeAge(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((now - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
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
