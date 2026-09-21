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

/**
 * What a merge would do with one pull request, decided server-side:
 *
 *   merged       already merged; `serving` says whether production carries it
 *   merge        next in line and mergeable now
 *   wait_deploy  a cloud PR ahead of it is merged but not yet serving
 *   after        waits for an earlier PR in the plan
 *   blocked      cannot merge as it stands — `reason` says why
 */
export type MergeAction = 'merged' | 'merge' | 'wait_deploy' | 'after' | 'blocked';

export interface MergePlanEntry extends ResolutionPr {
  title: string | null;
  state: string | null;
  merged: boolean;
  mergeSha: string | null;
  mergeable: boolean | null;
  checks: 'success' | 'failure' | 'pending' | 'none';
  action: MergeAction;
  reason: string | null;
  serving?: boolean | null;
}

export interface MergeState {
  /** Whether this server holds a credential that can merge. */
  configured: boolean;
  /** The commit the server is running — what a cloud PR has to reach. */
  servingSha: string;
  /** In merge order: cloud → web → native → the rest. Empty when not configured. */
  plan: MergePlanEntry[];
  /** Set when the plan could not be read; the rest of the resolution stands. */
  error?: string;
  /** After a merge request: what that request merged. */
  merged?: { url: string; sha: string | null }[];
  /**
   * After a merge or nudge request that found a conflict: the ask for it to
   * be fixed, posted (once) on the primary pull request.
   */
  nudge?: ConflictNudge;
}

export interface ConflictNudge {
  /** A comment was posted by this request. */
  asked: boolean;
  /** The conflicting PRs' URLs. Empty when nothing conflicts. */
  conflicts: string[];
  /** The PR the comment is (or already was) on. */
  on?: string;
  /** The comment's URL — this request's, or the earlier one that already asked. */
  comment?: string;
  /** The same conflict had already been asked about; nothing was posted. */
  alreadyAsked?: boolean;
  /** Why nothing could be posted. */
  error?: string;
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
  /**
   * What the reporter wrote — the body above the Context table the reporter
   * appends. Absent on a server that predates it; empty for an issue written
   * by hand with nothing above the marker.
   */
  reportedText?: string | null;
  /** When the issue was opened. Absent on a server that predates it. */
  createdAt?: string | null;
  /** Absent on a server that predates merging. */
  merge?: MergeState;
  /**
   * Whether feedback can be sent from here. Its own key, not `merge`: a
   * server that predates feedback answers `merge.configured: true` and has no
   * feedback route, so the *absence* of this is the signal to offer no field.
   */
  feedback?: { configured: boolean };
}

/** Where a piece of feedback goes, and how long it waits to be read. */
export type FeedbackTarget = 'pr' | 'issue';

export interface FeedbackResult {
  posted: boolean;
  target: FeedbackTarget;
  /** The pull request or issue the comment landed on. */
  on: string;
  /** The comment's own address. */
  comment?: string;
  /** The sibling pull requests the comment named as part of the same fix. */
  named?: string[];
  error?: string;
}

/**
 * Where feedback on this resolution can go.
 *
 * The pull request is offered only while there is an open one to put it on.
 * The server refuses `pr` otherwise rather than silently sending the words
 * somewhere the sender did not choose, and an option that always fails is
 * worse than no option. The issue is always there — it is the report's home.
 */
export function feedbackTargets(resolution: Resolution): FeedbackTarget[] {
  if (!resolution.feedback?.configured) return [];
  const anyOpen = (resolution.merge?.plan ?? []).some((entry) => entry.state === 'open');
  return anyOpen ? ['pr', 'issue'] : ['issue'];
}

/**
 * The one pull request a comment would land on: the primary while it is open,
 * else the first open one — the same choice the server makes. Named here so
 * the view can print where the words are going before they go.
 */
export function feedbackPr(resolution: Resolution): MergePlanEntry | null {
  const open = (resolution.merge?.plan ?? []).filter((entry) => entry.state === 'open');
  return open.find((entry) => entry.url === resolution.primary?.url) ?? open[0] ?? null;
}

/** The open pull requests that will *not* be commented on, so the view can say so. */
export function feedbackSiblings(resolution: Resolution): MergePlanEntry[] {
  const target = feedbackPr(resolution);
  if (!target) return [];
  return (resolution.merge?.plan ?? []).filter((entry) => entry.url !== target.url);
}

/** The PRs one tap of Merge would merge right now, in order. */
export function mergesNow(plan: MergePlanEntry[]): MergePlanEntry[] {
  return plan.filter((entry) => entry.action === 'merge');
}

/** The PRs that cannot merge because of a conflict — the one block a tap can act on. */
export function conflictsIn(plan: MergePlanEntry[]): MergePlanEntry[] {
  return plan.filter((entry) => entry.action === 'blocked' && entry.reason === 'merge conflict');
}

/** Whether the plan has anything left that is not merged. */
export function mergeOutstanding(plan: MergePlanEntry[]): boolean {
  return plan.some((entry) => entry.action !== 'merged');
}

/**
 * The label on the Merge button, or null when there is nothing to merge now.
 * Names the PR when it is one, counts them when it is more: what the tap
 * ships is the one thing the button must not be vague about.
 */
export function mergeLabel(plan: MergePlanEntry[]): string | null {
  const now = mergesNow(plan);
  if (now.length === 0) return null;
  if (now.length === 1) return `Merge ${shortPr(now[0])}`;
  return `Merge ${now.length} pull requests`;
}

/** One short phrase for a PR's place in the plan, for the pill beside it. */
export function planStatus(entry: MergePlanEntry): string {
  switch (entry.action) {
    case 'merged':
      if (entry.serving === true) return 'Merged · serving';
      if (entry.serving === false) return 'Merged · deploying';
      return 'Merged';
    case 'merge':
      return 'Ready';
    case 'wait_deploy':
      return 'Waits for deploy';
    case 'after':
      return entry.reason ?? 'Waits';
    case 'blocked':
      return entry.reason ?? 'Blocked';
  }
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

/**
 * The word on a row for where its fix stands, or null for a row with nothing
 * to say. Closed reads as fixed — the label comes off once the PR has merged,
 * and a closed report is usually a fixed one.
 */
export function fixStatus(issue: Pick<ReportedIssue, 'labels' | 'state'>): 'Fixed' | 'Fix proposed' | null {
  if (issue.state === 'closed') return 'Fixed';
  if (issue.labels.includes(PR_OPEN_LABEL)) return 'Fix proposed';
  return null;
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

/**
 * Merge the resolution's pull requests, in order, up to the first deploy gate.
 *
 * The server decides what merges: one request merges the cloud PR and reports
 * the web PR as waiting for that deploy, rather than merging both 23 seconds
 * apart. The answer is the plan as GitHub holds it afterwards, so the view
 * re-renders from what actually happened rather than from what was asked.
 */
export async function mergeResolution(
  issueNumber: number,
  token: string,
): Promise<MergeState> {
  const response = await fetch(
    `${config.apiUrl}/rest/issue-report/${issueNumber}/resolution/merge`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    if (response.status === 403) throw new Error('Reporting is limited to admin accounts.');
    if (response.status === 409) throw new Error("Merging isn't set up on this server.");
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      // A body that is not JSON says nothing more than the status did.
    }
    throw new Error(detail || 'Could not merge right now.');
  }
  return (await response.json()) as MergeState;
}

/**
 * Ask for the resolution's merge conflicts to be fixed.
 *
 * One comment on the primary pull request naming every conflicting one —
 * where an agent is woken straight away — and only once per conflicting
 * head, so a second tap is answered with the comment that already exists.
 * The answer is the plan plus what was asked.
 */
export async function nudgeConflicts(
  issueNumber: number,
  token: string,
): Promise<MergeState> {
  const response = await fetch(
    `${config.apiUrl}/rest/issue-report/${issueNumber}/resolution/nudge`,
    { method: 'POST', headers: { authorization: `Bearer ${token}` } },
  );

  if (!response.ok) {
    if (response.status === 403) throw new Error('Reporting is limited to admin accounts.');
    if (response.status === 409) throw new Error("Merging isn't set up on this server.");
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      // A body that is not JSON says nothing more than the status did.
    }
    throw new Error(detail || 'Could not ask right now.');
  }
  return (await response.json()) as MergeState;
}

/**
 * Send one piece of feedback, to one place.
 *
 * `pr` reaches the primary pull request, where an agent is woken on it
 * straight away; `issue` reaches the report itself and waits for the next
 * scheduled sweep. One comment, on one pull request — the server names the
 * siblings inside it rather than commenting on them, because three comments
 * start three agents that each think they are alone.
 */
export async function sendFeedback(
  issueNumber: number,
  token: string,
  target: FeedbackTarget,
  body: string,
): Promise<FeedbackResult> {
  const response = await fetch(
    `${config.apiUrl}/rest/issue-report/${issueNumber}/resolution/feedback`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ target, body }),
    },
  );

  if (!response.ok) {
    if (response.status === 403) throw new Error('Reporting is limited to admin accounts.');
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: string }).error ?? '';
    } catch {
      // A body that is not JSON says nothing more than the status did.
    }
    throw new Error(detail || 'Could not send that right now.');
  }
  return (await response.json()) as FeedbackResult;
}
