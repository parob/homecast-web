/**
 * What resolves a reported issue — the pull requests and the pictures.
 *
 * Read through the server for the same reason the list is: the issue
 * reporter's credential lives there. The server reads the issue's comments
 * and extracts a record; this side only renders it.
 *
 * The evidence for a fix has been the hardest thing for a reviewer to reach.
 * It sits in pull requests across three repositories, in bodies that cannot
 * carry an image, and in comments where the image markup often did not
 * survive posting. The server recovers all of those forms; what arrives here
 * is a plain list of URLs to show.
 */

import { config } from '@/lib/config';

import type { ReportedIssue } from './issues';

export interface ResolutionPr {
  /** `owner/name`, e.g. `parob/homecast-web`. */
  repo: string;
  number: number;
  url: string;
}

export interface ResolutionImage {
  url: string;
  alt: string;
}

export interface Resolution {
  issueNumber: number;
  title: string | null;
  state: string | null;
  url: string | null;
  labels: string[];
  /** One line on what the fix does, when the routine wrote one. */
  summary: string | null;
  /** `web` / `native` / `server`, when the record says. */
  reach: string | null;
  /** Where feedback goes to be picked up immediately. */
  primary: ResolutionPr | null;
  prs: ResolutionPr[];
  /** Before/after pictures of the fix. */
  evidence: ResolutionImage[];
  /** The report's own screenshots — what was reported, not what fixed it. */
  reported: ResolutionImage[];
}

/** The label the routine puts on an issue while it has a PR open for it. */
export const PR_OPEN_LABEL = 'claude-pr-open';

/**
 * Whether a row should offer its resolution at all.
 *
 * A PR is open for it, or it is closed — a closed report is usually a fixed
 * one, and the label comes off once the PR has merged. A closed issue with no
 * PR (a duplicate, not a bug) shows an empty resolution, which is the honest
 * answer and costs one tap.
 */
export function offersResolution(issue: Pick<ReportedIssue, 'labels' | 'state'>): boolean {
  return issue.labels.includes(PR_OPEN_LABEL) || issue.state === 'closed';
}

/** The part of a PR URL worth reading: `homecast-web#208`. */
export function shortPr(pr: ResolutionPr): string {
  return `${pr.repo.split('/').pop() ?? pr.repo}#${pr.number}`;
}

/**
 * Fetch the resolution for one issue.
 *
 * `null` when there is nothing to show because the server does not know how
 * to answer — a server that predates the endpoint, or an issue it has no
 * record of. Both answer 404, and neither is an error worth alarming anyone
 * with: the row still opens on GitHub.
 */
export async function fetchResolution(
  issueNumber: number,
  token: string,
): Promise<Resolution | null> {
  const response = await fetch(
    `${config.apiUrl}/rest/issue-report/${issueNumber}/resolution`,
    { headers: { authorization: `Bearer ${token}` } },
  );

  if (response.status === 404) return null;
  if (!response.ok) {
    if (response.status === 403) throw new Error('Reporting is limited to admin accounts.');
    throw new Error('Could not load the resolution right now.');
  }
  return (await response.json()) as Resolution;
}
