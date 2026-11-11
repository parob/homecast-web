/**
 * What resolves a reported issue — the pull requests, the pictures, and what
 * has been said about it.
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

import type { LastComment, LinkedPr, ReportedIssue } from './issues';

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
  /** GitHub's own: `open` or `closed` — a merged PR is `closed` with `merged`. */
  state: string | null;
  merged: boolean;
  mergeSha: string | null;
  mergeable: boolean | null;
  checks: 'success' | 'failure' | 'pending' | 'none' | 'unknown';
  /** Absent only on an entry GitHub could not be read for. */
  draft?: boolean;
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

/**
 * One thing said about a report — a comment on the issue, as prose.
 *
 * `by` is who said it: `claude` the routine, `app` someone typing into the
 * feedback box on this screen, `person` a comment written on GitHub. The
 * server decides it (the routine's footer is the only discriminator — it
 * comments under the same account a person does), so nothing here has to
 * guess from the author's name.
 */
export interface ResolutionUpdate {
  id: string;
  /** The entry's own address on GitHub. */
  url: string | null;
  /** When it happened. */
  at: string | null;
  /** The GitHub login behind it. */
  author: string | null;
  /**
   * Who: `claude` the routine, `app` someone typing into the feedback box,
   * `person` a comment written on GitHub, `bot` a review or CI account.
   * The server decides it from GitHub's own author type, never from wording —
   * the routine posts under the same account a person does.
   */
  by: 'claude' | 'app' | 'person' | 'bot';
  /** What kind of thing happened. */
  kind: 'comment' | 'review' | 'review_comment' | 'commit';
  /** The thread it came from: `issue`, or a short pull request name. */
  where: string;
  /** That thread's address, for the one-line label. */
  whereUrl: string | null;
  /** A review's verdict, a commit's short sha, an inline note's file. */
  meta: string | null;
  /**
   * Starts folded to a single line. Bot output and commits do; an answer
   * written to the reporter never does. Included rather than filtered, so
   * nothing is judged away and nothing drowns the answer either.
   */
  collapsed: boolean;
  /** The wording as written, with the record, footer and markers taken out. */
  text: string;
  /** Longer than the server will send; the rest is on GitHub. */
  truncated: boolean;
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
  /**
   * Everything that has happened to the report, oldest first — its own
   * comments and its pull requests' comments, reviews and commits, in one
   * timeline. Absent on a server that predates it, which is the signal to show
   * no section at all rather than an empty one reading as "nothing happened".
   */
  updates?: ResolutionUpdate[];
  /** How many older entries the server left on GitHub. */
  earlierUpdates?: number;
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
      return 'Code merged';
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

/**
 * What the plan adds to a pull request's own word, or null when the word
 * already says it.
 *
 * The word ({@link prWord}) is the PR as GitHub holds it; the plan is where it
 * stands in the merge order. The two part ways only when a PR is fine on its
 * own and still will not merge on this tap — Ready, but waiting for the cloud
 * PR ahead of it to deploy — and that is the one case worth a second phrase.
 * A draft, a conflict or red checks are already the word.
 */
export function planNote(entry: MergePlanEntry): string | null {
  if (entry.action === 'wait_deploy' || entry.action === 'after') return planStatus(entry);
  if (entry.action === 'blocked') {
    const word = prWord(planEntryPr(entry));
    if (word === 'Ready' || word === 'Open') return planStatus(entry);
  }
  return null;
}

/**
 * What to say once every linked pull request has merged — read from the
 * report's state and the plan, not a label.
 *
 * Merged code is only part of an open report's resolution: until the report
 * is closed it is waiting on someone to see the fix work, and a cloud PR that
 * is merged but not yet serving cannot be seen working at all.
 */
export function mergedReportMessage(issueState: string | null, plan: MergePlanEntry[]): string {
  const merged = 'All linked pull requests are merged.';
  const deploying = plan.filter((entry) => entry.action === 'merged' && entry.serving === false);
  if (deploying.length > 0) {
    return `${merged} ${deploying.map(shortPr).join(', ')} ${deploying.length === 1 ? 'is' : 'are'} still deploying.`;
  }
  if (issueState === 'closed') return merged;
  return `${merged} This report is still open pending verification.`;
}

/* ------------------------------------------------------------------------
 * Where a report stands, read from GitHub.
 *
 * The word on a row used to be computed from labels the routine had to
 * remember to add and take off, and it drifted: a PR merged with
 * `claude-pr-open` still on, a report worked in depth and never labelled at
 * all. The server now sends each report's linked pull requests as GitHub
 * holds them — draft, open, merged, closed, mergeable, CI — and the word is
 * read from those. No label decides anything here any more.
 *
 * A question put to the owner is not a status. It is the latest comment, and
 * the row shows it as one ("Claude: …"), where it can be read as what it is.
 * ---------------------------------------------------------------------- */

/** How loudly a status reads. Decided beside the word: they are one fact. */
export type StatusTone = 'done' | 'active' | 'waiting' | 'idle';

/** One pull request, in a word — what GitHub says about it right now. */
export type PrWord =
  | 'Draft'
  | 'Conflict'
  | 'Checks failing'
  | 'Checks running'
  | 'Ready'
  | 'Open'
  | 'Merged · live'
  | 'Merged · deploying'
  | 'Merged'
  | 'Closed';

/**
 * The word for one linked pull request.
 *
 * `Ready` is a non-draft whose checks are green (or it has none) and that
 * GitHub has not said conflicts — an uncomputed `mergeable: null` counts, the
 * same as it does for the row's headline, so a row never reads "Ready" over a
 * chip that says otherwise. `Open` is what is left: CI that could not be read.
 */
export function prWord(pr: Pick<LinkedPr, 'state' | 'draft' | 'mergeable' | 'checks' | 'serving'>): PrWord {
  if (pr.state === 'merged') {
    if (pr.serving === true) return 'Merged · live';
    if (pr.serving === false) return 'Merged · deploying';
    return 'Merged';
  }
  if (pr.state === 'closed') return 'Closed';
  if (pr.draft) return 'Draft';
  if (pr.mergeable === false) return 'Conflict';
  if (pr.checks === 'failure') return 'Checks failing';
  if (pr.checks === 'pending') return 'Checks running';
  if (pr.checks === 'success' || pr.checks === 'none') return 'Ready';
  return 'Open';
}

/** How loudly one pull request's word reads: what can merge stands out. */
export function prWordTone(word: PrWord): StatusTone {
  switch (word) {
    case 'Merged · live':
    case 'Merged · deploying':
    case 'Merged':
      return 'done';
    case 'Ready':
      return 'active';
    case 'Conflict':
    case 'Checks failing':
      return 'waiting';
    case 'Draft':
    case 'Open':
    case 'Checks running':
    case 'Closed':
      return 'idle';
  }
}

/** Repositories named by the part that tells them apart. Native stays `homecast`. */
const CHIP_REPO_NAMES: Record<string, string> = {
  'homecast-cloud': 'cloud',
  'homecast-web': 'web',
};

/**
 * `cloud#232`, `web#296`, `homecast#83` — short enough for two on one line of
 * a phone-width row. The issue screen keeps {@link shortPr}'s full names,
 * where there is room and the Merge button has to be unambiguous.
 */
export function prChipName(pr: Pick<ResolutionPr, 'repo' | 'number'>): string {
  const name = pr.repo.split('/').pop() ?? pr.repo;
  return `${CHIP_REPO_NAMES[name] ?? name}#${pr.number}`;
}

/** A report's one word, read from its state and its pull requests. */
export type Headline =
  | 'Duplicate'
  | 'Not planned'
  | 'Closed'
  | 'No PR yet'
  | 'Merged'
  | 'PR closed'
  | 'Conflict'
  | 'Checks failing'
  | 'Ready'
  | `${number} ready`
  | 'Checks running'
  | 'Draft'
  | 'PR open';

/**
 * Where a report stands, in one word, from GitHub's state alone.
 *
 * A closed report says why it was closed. An open one is read from its open
 * pull requests, the first match winning — what blocks a merge, then what can
 * merge, then what is still on its way:
 *
 *   Conflict → Checks failing → Ready / N ready → Checks running → Draft
 *
 * With nothing open, it is `Merged` if anything merged (a superseded PR that
 * was closed alongside does not undo that), `PR closed` if every one was
 * closed unmerged, and `No PR yet` with none at all. `PR open` is the last
 * resort, for open PRs whose CI could not be read.
 */
export function issueHeadline(issue: {
  state: string | null;
  stateReason?: ReportedIssue['stateReason'];
  prs: readonly LinkedPr[];
}): Headline {
  if (issue.state === 'closed') {
    if (issue.stateReason === 'duplicate') return 'Duplicate';
    if (issue.stateReason === 'not_planned') return 'Not planned';
    return 'Closed';
  }

  const open = issue.prs.filter((pr) => pr.state === 'open');
  if (open.length === 0) {
    if (issue.prs.some((pr) => pr.state === 'merged')) return 'Merged';
    return issue.prs.length === 0 ? 'No PR yet' : 'PR closed';
  }

  const words = open.map(prWord);
  if (words.includes('Conflict')) return 'Conflict';
  if (words.includes('Checks failing')) return 'Checks failing';
  const ready = words.filter((word) => word === 'Ready').length;
  if (ready === 1) return 'Ready';
  if (ready > 1) return `${ready} ready`;
  if (words.includes('Checks running')) return 'Checks running';
  if (words.includes('Draft') && words.every((word) => word === 'Draft' || word === 'Open')) return 'Draft';
  return 'PR open';
}

/**
 * How loudly a headline reads. `No PR yet` is muted on purpose — the absence
 * of news should be legible without competing with the rows that have some —
 * and the two a person has to act on are the loud ones.
 */
export function headlineTone(headline: Headline): StatusTone {
  if (headline === 'Closed' || headline === 'Merged') return 'done';
  if (headline === 'Conflict' || headline === 'Checks failing') return 'waiting';
  if (
    headline === 'No PR yet' || headline === 'PR closed'
    || headline === 'Duplicate' || headline === 'Not planned'
  ) return 'idle';
  return 'active';
}

/** A report's status: its word, and how loudly that reads. */
export interface ReportStatus {
  word: string;
  tone: StatusTone;
}

/**
 * The status a row (or the issue screen's header) shows.
 *
 * From GitHub wherever the server sent `prs`; from the labels, exactly as
 * before, where it did not. The web ships to production on merge and may
 * well land before the server, and a missing field is not "no pull request".
 */
export function reportStatus(
  issue: Pick<ReportedIssue, 'state' | 'labels' | 'stateReason' | 'prs'>,
): ReportStatus {
  if (issue.prs === undefined) {
    const word = fixStatus(issue);
    return { word, tone: fixStatusTone(word) };
  }
  const word = issueHeadline({ state: issue.state, stateReason: issue.stateReason, prs: issue.prs });
  return { word, tone: headlineTone(word) };
}

/** A merge plan entry, read as the linked pull request it describes. */
export function planEntryPr(entry: MergePlanEntry): LinkedPr {
  return {
    repo: entry.repo,
    number: entry.number,
    url: entry.url,
    title: entry.title,
    state: entry.merged ? 'merged' : entry.state === 'closed' ? 'closed' : 'open',
    draft: entry.draft ?? false,
    mergeable: entry.mergeable ?? null,
    checks: entry.checks ?? 'unknown',
    serving: entry.serving,
  };
}

/**
 * The pull requests the issue screen reads its status from.
 *
 * The merge plan where the server could build one — it is read when the
 * screen opens, and re-read after every merge, so it is the freshest there
 * is — else the list row's. `undefined` on a server that predates linked PRs,
 * which is the cue for the labels.
 */
export function livePrs(
  issue: Pick<ReportedIssue, 'prs'>,
  resolution: Pick<Resolution, 'merge'> | null,
): LinkedPr[] | undefined {
  if (issue.prs === undefined) return undefined;
  const merge = resolution?.merge;
  if (merge?.configured && !merge.error) return merge.plan.map(planEntryPr);
  return issue.prs;
}

/** Who said the last thing, as a row prints it. `app` and `person` are the owner. */
export function commentWho(comment: Pick<LastComment, 'by' | 'author'>): string {
  if (comment.by === 'claude') return 'Claude';
  if (comment.by === 'app' || comment.by === 'person') return 'You';
  return comment.author || 'A bot';
}

/**
 * Whether a row carries its latest comment.
 *
 * Where nothing is waiting to merge — no PR yet, only drafts, everything
 * merged but the report still open — the conversation *is* the news: it is
 * where a question to the owner, or the reason a fix is parked, lives. Where
 * a PR is ready, conflicting or in CI, its chip already says what happens
 * next, and one more line per row costs a phone more than it tells. Closed
 * reports are history.
 */
export function showsLastComment(issue: Pick<ReportedIssue, 'state' | 'prs' | 'lastComment'>): boolean {
  if (!issue.lastComment || !issue.lastComment.text || issue.prs === undefined) return false;
  if (issue.state === 'closed') return false;
  return !issue.prs.some((pr) => pr.state === 'open' && !pr.draft);
}

/* ------------------------------------------------------------------------
 * The old server's answer: labels.
 *
 * Kept only for a server that sends no `prs` — the web reaches production
 * first — and read through `reportStatus`, never directly. Delete once every
 * server sends linked pull requests.
 * ---------------------------------------------------------------------- */

/** Old-server fallback: the label the routine puts on an issue while it has a PR open for it. */
export const PR_OPEN_LABEL = 'claude-pr-open';

/** Old-server fallback: an agent has read the issue — "someone is on this". */
export const ATTEMPTED_LABEL = 'claude-attempted';

/** Old-server fallback: waiting on a fix in a repository this product does not own. */
export const BLOCKED_LABEL = 'blocked-upstream';

/** Old-server fallback: deliberately parked for a person to decide. */
export const NEEDS_HUMAN_LABEL = 'needs-human';

/**
 * Whether a row should offer its resolution at all.
 *
 * Every row, wherever the server says what is linked: the screen is where a
 * report's conversation and pull requests are read, whether or not there is
 * a fix yet. On an old server, as before — a PR is open for it, or it is
 * closed.
 */
export function offersResolution(issue: Pick<ReportedIssue, 'labels' | 'state' | 'prs'>): boolean {
  if (issue.prs !== undefined) return true;
  return issue.labels.includes(PR_OPEN_LABEL) || issue.state === 'closed';
}

/**
 * Old-server fallback: where a report stands, in one word, from its labels.
 *
 * Every open row gets one, and the reason is homecast-cloud#181. This used to
 * answer `null` for anything without a pull request, which made two very
 * different rows render identically: one an agent was part-way through
 * investigating, and one that nothing had ever opened. On 21 Sep four reports
 * were filed and never picked up — two of them asked about twice — and the
 * screen showed the same blank for those as for the ones being worked. The
 * reporter's only possible reading was "nothing is happening", and they had no
 * way to know whether that was true.
 *
 * So the absence is now a word. `Not picked up yet` is the honest answer when
 * no label says otherwise, and it is deliberately the one this errs towards:
 * `claude-attempted` is written by a routine that has been seen to skip it
 * (homecast-web#207 was worked in depth and never labelled), so a row can read
 * as unclaimed while someone is in fact on it. Under-claiming shows the queue
 * as worse than it is, which is the safe direction — the opposite mistake is
 * the one that produced this issue.
 *
 * Ordered most-resolved first: a closed report is fixed whatever else it
 * carries, and a pull request outranks the investigation that produced it.
 */
export type FixStatus =
  | 'Fixed'
  | 'Fix proposed'
  | 'Blocked upstream'
  | 'Needs review'
  | 'Investigating'
  | 'Not picked up yet';

export function fixStatus(issue: Pick<ReportedIssue, 'labels' | 'state'>): FixStatus {
  if (issue.state === 'closed') return 'Fixed';
  if (issue.labels.includes(BLOCKED_LABEL)) return 'Blocked upstream';
  if (issue.labels.includes(NEEDS_HUMAN_LABEL)) return 'Needs review';
  if (issue.labels.includes(PR_OPEN_LABEL)) return 'Fix proposed';
  if (issue.labels.includes(ATTEMPTED_LABEL)) return 'Investigating';
  return 'Not picked up yet';
}

/**
 * Old-server fallback: how loudly a label status reads.
 *
 * `Not picked up yet` is muted on purpose. It is the absence of news, and an
 * absence that shouts is worse than one that is simply legible.
 */
export function fixStatusTone(status: FixStatus): StatusTone {
  switch (status) {
    case 'Fixed':
      return 'done';
    case 'Fix proposed':
    case 'Investigating':
      return 'active';
    case 'Blocked upstream':
    case 'Needs review':
      return 'waiting';
    case 'Not picked up yet':
      return 'idle';
  }
}

/* -- end of the old-server fallback ----------------------------------- */

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
