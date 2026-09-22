/**
 * One reported issue, on one screen: what was reported, then what fixes it.
 *
 * The person opening this is usually the one who filed it, days ago, from a
 * phone. They want to recognise their own report — their words, their
 * screenshot — and then see what has been done about it without leaving the
 * app. So the report comes first, in the words they wrote; the fix second,
 * pictures before prose, because a before/after answers "does it look right"
 * faster than a PR body; and the pull requests as a short list with their
 * place in the merge plan.
 *
 * Then **Updates** — what has been said on the report, newest first. The fix
 * above it is four machine-readable things; this is the prose, and it is where
 * a reason, a judgement call, or a question put to the reporter actually
 * reaches them. Without it the screen had a box for saying something back and
 * nowhere to read the reply.
 *
 * Then, where the server holds a credential for it, **Merge**. It merges what
 * the server's plan says merges now — cloud before web before native, and
 * never a web or native PR while a cloud PR ahead of it is merged but not yet
 * serving. That order is decided server-side; this view only shows the plan
 * and asks once before acting on it, because a merge to `main` reaches
 * production and a tap on a phone deserves a sentence saying so.
 *
 * Nothing here leaves the app silently. Every link out — the issue, each pull
 * request — prints the full address it goes to, and says it opens on GitHub.
 * The old row tap that jumped straight to github.com was the one thing on
 * this sheet a reader could not predict.
 *
 * Replaces the list in place rather than opening a second dialog: the sheet is
 * already a focus trap on a small screen, and a Back button is what a phone
 * user expects from a row they tapped.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  CheckCircle2, ChevronLeft, CircleDot, ExternalLink, GitMerge, GitPullRequest, Loader2, MessageSquareWarning,
  Bot, GitCommitHorizontal, MessageSquare, RefreshCw, Send, Sparkles, User,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { openExternalUrl } from '@/lib/open-url';
import { readComment, type Block, type Inline } from '@/lib/report/comment-markdown';
import { relativeAge, relativeMoment, type ReportedIssue } from '@/lib/report/issues';
import {
  conflictsIn, feedbackPr, feedbackSiblings, feedbackTargets, fetchResolution, fixStatus, mergeLabel, mergedReportMessage,
  mergeOutstanding, mergeResolution, mergesNow, nudgeConflicts, planStatus, sendFeedback, shortPr,
  type ConflictNudge, type FeedbackResult, type FeedbackTarget, type MergePlanEntry, type MergeState,
  type Resolution, type ResolutionImage, type ResolutionPr, type ResolutionUpdate, type FixStatus,
} from '@/lib/report/resolution';

interface IssueViewProps {
  issue: ReportedIssue;
  onBack: () => void;
}

export function IssueView({ issue, onBack }: IssueViewProps) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setLoading(false);
      setError('You are signed out.');
      return () => {};
    }
    fetchResolution(issue.issueNumber, token)
      .then((result) => {
        if (cancelled) return;
        setResolution(result);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load this issue.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [issue.issueNumber]);

  useEffect(() => load(), [load]);

  const reportStatus = fixStatus({ state: resolution?.state ?? issue.state, labels: resolution?.labels ?? issue.labels });
  const fixed = reportStatus === 'Fixed';
  const age = relativeAge(resolution?.createdAt ?? issue.createdAt);
  const reportedText = (resolution?.reportedText ?? '').trim();
  const reported = resolution?.reported ?? [];
  const hasFix = resolution !== null && (
    resolution.prs.length > 0 || resolution.evidence.length > 0 || Boolean(resolution.summary)
  );

  const plan = resolution?.merge?.plan ?? [];
  const planByUrl = new Map(plan.map((entry) => [entry.url, entry]));

  return (
    <div className="w-full min-w-0 space-y-4">
      <div className="flex items-start gap-1">
        <Button
          type="button" variant="ghost" size="icon"
          onClick={onBack}
          aria-label="Back to issues"
          className="-ml-2 h-8 w-8 shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* The row the reader tapped, so they know which issue this is
            without the list to compare against. Not a link: where it goes
            on GitHub is printed at the bottom, in full. */}
        <div className="flex min-w-0 flex-1 items-start gap-2 py-1">
          {fixed ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          )}
          <div className="min-w-0 flex-1">
            <h2 className="line-clamp-3 break-words text-sm font-medium">{issue.title}</h2>
            <div className="text-xs text-muted-foreground">
              #{issue.issueNumber}
              {age && ` · reported ${age}`}
              {` · ${reportStatus}`}
            </div>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="py-6 text-center text-sm text-destructive">{error}</p>
      )}

      {!loading && !error && (
        <>
          <section aria-label="You reported" className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              You reported
            </h3>
            {reportedText ? (
              // The reporter's own words, as written — line breaks kept, and
              // nothing of the reporter's appended tables and logs.
              <p className="whitespace-pre-wrap break-words text-sm">{reportedText}</p>
            ) : (
              <p className="text-sm text-muted-foreground">
                {resolution === null
                  ? 'Your report is on GitHub — the link is below.'
                  : 'No description beyond the title.'}
              </p>
            )}
            {reported.length > 0 && (
              <div className="flex gap-2 overflow-x-auto">
                {reported.map((image) => (
                  <button
                    key={image.url}
                    type="button"
                    onClick={() => openExternalUrl(image.url)}
                    aria-label={`Open ${image.alt || 'your screenshot'} full size in your browser`}
                    className="h-24 w-24 shrink-0 overflow-hidden rounded-md border"
                  >
                    <img src={image.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </section>

          <section aria-label="Proposed fix" className="space-y-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {fixed ? 'The fix' : 'Proposed fix'}
            </h3>

            {!hasFix && (
              <p className="text-sm text-muted-foreground">No fix proposed yet.</p>
            )}

            {hasFix && resolution && (
              <>
                {resolution.evidence.length > 0 && (
                  <div className="space-y-2">
                    {resolution.evidence.map((image) => (
                      <Picture key={image.url} image={image} />
                    ))}
                  </div>
                )}

                {resolution.summary && (
                  <p className="text-sm">{resolution.summary}</p>
                )}

                {resolution.prs.length > 0 && (
                  <div className="space-y-1">
                    {/* In the plan's order where there is one — that is the
                        order they merge in, and the order the reader should
                        expect. Each one says where it goes, in full. */}
                    {(plan.length > 0 ? plan : resolution.prs).map((pr) => (
                      <PullRequestRow
                        key={pr.url}
                        pr={pr}
                        entry={planByUrl.get(pr.url)}
                        primary={resolution.primary?.url === pr.url && resolution.prs.length > 1}
                        reach={resolution.reach}
                      />
                    ))}
                  </div>
                )}

                {resolution.merge && resolution.prs.length > 0 && (
                  <MergeControls
                    reportStatus={reportStatus}
                    issueNumber={issue.issueNumber}
                    merge={resolution.merge}
                    onMerged={(state) => setResolution({ ...resolution, merge: state })}
                    onCheckAgain={() => { load(); }}
                  />
                )}
              </>
            )}
          </section>

          {resolution?.updates && resolution.updates.length > 0 && (
            <UpdatesSection
              updates={resolution.updates}
              issueUrl={issue.url}
              earlierOnGitHub={resolution.earlierUpdates ?? 0}
            />
          )}

          {resolution && <FeedbackSection issue={issue} resolution={resolution} />}

          <section aria-label="On GitHub" className="space-y-1">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              On GitHub
            </h3>
            <ExternalRow
              label={`Issue #${issue.issueNumber}`}
              url={issue.url}
            />
          </section>
        </>
      )}
    </div>
  );
}

/**
 * A link out of the app, with its destination printed in full.
 *
 * A button, not an anchor: inside the app's WKWebView a target=_blank
 * navigation is silently dropped — github.com is not an app-bound domain — so
 * `openExternalUrl` hands the URL to the native shell, which opens it in the
 * system browser, and falls back to window.open in a real browser.
 */
function ExternalRow({ label, url, children }: { label: string; url: string; children?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => openExternalUrl(url)}
      aria-label={`Open ${label} on GitHub — ${url}`}
      className="flex w-full min-w-0 items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate">{label}</span>
          {children}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{url}</div>
      </div>
      <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </button>
  );
}

interface PullRequestRowProps {
  pr: ResolutionPr;
  entry?: MergePlanEntry;
  primary: boolean;
  reach: string | null;
}

/** One pull request: its short name, where it stands, and its full address. */
function PullRequestRow({ pr, entry, primary, reach }: PullRequestRowProps) {
  return (
    <ExternalRow label={shortPr(pr)} url={pr.url}>
      <GitPullRequest className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1" />
      {entry ? (
        <PlanPill entry={entry} />
      ) : (
        <>
          {primary && (
            // Where a comment is picked up first. Only worth saying when
            // there is more than one place it could go.
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              primary
            </span>
          )}
          {reach && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
              {reach}
            </span>
          )}
        </>
      )}
    </ExternalRow>
  );
}

/** The pill beside a PR: its place in the merge plan, in a word or two. */
function PlanPill({ entry }: { entry: MergePlanEntry }) {
  const tone =
    entry.action === 'merged' ? 'bg-green-600/15 text-green-700 dark:text-green-400'
    : entry.action === 'merge' ? 'bg-primary/15 text-primary'
    : entry.action === 'blocked' ? 'bg-destructive/15 text-destructive'
    : 'bg-muted text-muted-foreground';
  return (
    <span className={`max-w-[45%] shrink-0 truncate rounded-full px-2 py-0.5 text-[11px] ${tone}`}>
      {planStatus(entry)}
    </span>
  );
}

interface MergeControlsProps {
  reportStatus: FixStatus;
  issueNumber: number;
  merge: MergeState;
  onMerged: (state: MergeState) => void;
  onCheckAgain: () => void;
}

/**
 * The Merge button, its confirmation, and what came of it.
 *
 * One tap merges what the plan says merges now and stops at the first deploy
 * gate; the sentence under the button says exactly which pull requests that
 * is, because "Merge" on its own does not say what ships. A plan with nothing
 * mergeable now says why and offers to look again — the usual reason is a
 * server still rolling out, which is a matter of minutes.
 *
 * A merge conflict is the one block a tap can do something about. The server
 * posts the ask — one comment on the primary pull request, where an agent is
 * woken straight away — when a Merge tap runs into one; when a conflict is all
 * that is left, the ask is offered as its own button. Either way what was
 * posted is shown, with the comment's address, or that it had already been
 * asked.
 */
function MergeControls({ issueNumber, merge, onMerged, onCheckAgain, reportStatus }: MergeControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // What the last tap merged, kept until the next load so the reader sees it.
  const [justMerged, setJustMerged] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);

  if (!merge.configured) {
    return (
      <p className="text-xs text-muted-foreground">
        Merging isn&rsquo;t set up on this server.
      </p>
    );
  }

  const plan = merge.plan;
  const now = mergesNow(plan);
  const label = mergeLabel(plan);
  const outstanding = mergeOutstanding(plan);
  // The first thing not merged and not mergeable now is what everyone is
  // waiting on; its reason is the sentence to show.
  const waitingOn = plan.find((entry) => entry.action !== 'merged' && entry.action !== 'merge');

  const conflicts = conflictsIn(plan);

  const ask = async () => {
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setMergeError('You are signed out.');
      return;
    }
    setAsking(true);
    setMergeError(null);
    try {
      onMerged(await nudgeConflicts(issueNumber, token));
    } catch (askFailure) {
      setMergeError(askFailure instanceof Error ? askFailure.message : 'Could not ask.');
    } finally {
      setAsking(false);
    }
  };

  const confirm = async () => {
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setMergeError('You are signed out.');
      return;
    }
    setMerging(true);
    setMergeError(null);
    try {
      const result = await mergeResolution(issueNumber, token);
      setJustMerged((result.merged ?? []).map((m) => {
        const entry = result.plan.find((p) => p.url === m.url);
        return entry ? shortPr(entry) : m.url;
      }));
      setConfirming(false);
      onMerged(result);
    } catch (mergeFailure) {
      setMergeError(mergeFailure instanceof Error ? mergeFailure.message : 'Could not merge.');
    } finally {
      setMerging(false);
    }
  };

  return (
    <section aria-label="Merge" className="space-y-2 rounded-md border p-2">
      {merge.error && (
        <p className="text-xs text-muted-foreground">{merge.error}</p>
      )}

      {justMerged.length > 0 && (
        <p className="text-sm">
          Merged {justMerged.join(', ')}.
        </p>
      )}

      {label && !confirming && (
        <Button type="button" className="w-full" onClick={() => setConfirming(true)}>
          <GitMerge className="mr-2 h-4 w-4" />
          {label}
        </Button>
      )}

      {label && confirming && (
        <div className="space-y-2">
          {/* The sentence the tap deserves: what, where, and what that means. */}
          <p className="text-sm">
            Merges {now.map(shortPr).join(', ')} to <code>main</code> — that ships to production.
            {now.length < plan.filter((e) => e.action !== 'merged').length && (
              <> The rest waits for it to deploy.</>
            )}
          </p>
          <div className="flex gap-2">
            <Button
              type="button" className="flex-1"
              disabled={merging}
              onClick={() => void confirm()}
            >
              {merging ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Merging…
                </>
              ) : (
                'Confirm merge'
              )}
            </Button>
            <Button
              type="button" variant="ghost"
              disabled={merging}
              onClick={() => { setConfirming(false); setMergeError(null); }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {!label && outstanding && waitingOn && (
        <p className="text-sm text-muted-foreground">
          {shortPr(waitingOn)}: {waitingOn.reason ?? planStatus(waitingOn)}.
        </p>
      )}

      {merge.nudge && <NudgeOutcome nudge={merge.nudge} />}

      {conflicts.length > 0 && !merge.nudge?.asked && !merge.nudge?.alreadyAsked && (
        // The ask, as its own action: a comment on the primary PR names the
        // conflicting one and is picked up straight away. Offered whether or
        // not something else can still merge — the conflict is not going to
        // fix itself while the rest ships.
        <Button
          type="button" variant="outline" className="w-full"
          disabled={asking || merging}
          onClick={() => void ask()}
        >
          {asking ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Asking…
            </>
          ) : (
            <>
              <MessageSquareWarning className="mr-2 h-4 w-4" />
              Ask for {conflicts.map(shortPr).join(', ')} to be fixed
            </>
          )}
        </Button>
      )}

      {!label && !outstanding && plan.length > 0 && (
        <p className="text-sm text-muted-foreground">{mergedReportMessage(reportStatus)}</p>
      )}

      {!label && (
        <Button type="button" variant="ghost" size="sm" onClick={onCheckAgain}>
          <RefreshCw className="mr-2 h-3.5 w-3.5" />
          Check again
        </Button>
      )}

      {mergeError && (
        <p role="alert" className="text-sm text-destructive">{mergeError}</p>
      )}
    </section>
  );
}

/** What an ask came to: posted, already posted, or refused — with the comment's address. */
function NudgeOutcome({ nudge }: { nudge: ConflictNudge }) {
  if (nudge.error) {
    return <p role="alert" className="text-sm text-destructive">{nudge.error}</p>;
  }
  if (!nudge.asked && !nudge.alreadyAsked) return null;
  const where = nudge.on ? shortPr(prFromUrl(nudge.on)) : 'the pull request';
  return (
    <div className="space-y-1 text-sm">
      <p>
        {nudge.asked ? 'Asked' : 'Already asked'} on {where} for the conflict to be fixed
        {nudge.asked ? ' — it gets picked up straight away.' : '.'}
      </p>
      {nudge.comment && (
        <ExternalRow label="The comment" url={nudge.comment} />
      )}
    </div>
  );
}

/** `homecast-web#208` from a PR or comment URL — enough to name it. */
function prFromUrl(url: string): ResolutionPr {
  const match = /github\.com\/([^/]+\/[^/]+)\/pull\/(\d+)/.exec(url);
  return match
    ? { repo: match[1], number: Number(match[2]), url }
    : { repo: url, number: 0, url };
}

/**
 * What has been said about the report, newest first.
 *
 * The screen above it says what the fix *is*; this says what was **said** — and
 * that is the half a reporter comes back for. The one-line summary cannot
 * carry a reason, a judgement call flagged for them, or a question put to
 * them, and until this existed none of those reached the app at all: an answer
 * written to the reporter ended at the endpoint, which read comments only to
 * mine four machine-readable things out of them.
 *
 * Newest first, because the complaint that produced this section was about the
 * *new* reply. **Every one of them is folded**, the newest to a taller height
 * than the rest: these answers run to four or five thousand characters, and an
 * unfolded one is a wall that pushes the whole conversation — and the box for
 * replying to it — off the bottom of a phone. Fourteen lines is the first two
 * paragraphs, which is the answer; the tap is there for the rest.
 *
 * Only the most recent {MAX_UPDATES_SHOWN} are listed, with a line saying how
 * many earlier ones there are and where to read them. A report that has been
 * going for a week is a scroll nobody finishes.
 *
 * It is **everything that happened to the fix**, not only the report's own
 * comments: the pull requests' comments, what their reviews concluded, and the
 * commits as they were pushed, in one timeline with each entry saying which
 * thread it came from. That is what someone needs in front of them to approve
 * a fix and merge it without leaving the app.
 *
 * Bot output and commits arrive **collapsed** — present as one line, opening
 * on a tap — rather than filtered out. Nothing is judged away, and the answers
 * written to the reporter are still what the eye lands on.
 *
 * The words are read rather than reprinted: `lib/report/comment-markdown.ts`
 * turns the Markdown that was typed into blocks, so a heading is a heading and
 * a hard-wrapped paragraph reflows. Shown raw it was barely legible on a phone
 * — the routine wraps its prose at about 80 columns, so every source newline
 * became a visual break mid-sentence, with `##` and `**` left as punctuation
 * for the reader to parse. Nothing is rewritten; it is only read as meant.
 */
function UpdatesSection(
  { updates, issueUrl, earlierOnGitHub }: {
    updates: ResolutionUpdate[]; issueUrl: string; earlierOnGitHub: number;
  },
) {
  const newestFirst = [...updates].reverse();
  const shown = newestFirst.slice(0, MAX_UPDATES_SHOWN);
  const earlier = newestFirst.length - shown.length + earlierOnGitHub;
  return (
    <section aria-label="Updates" className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Updates
      </h3>
      {shown.map((update, index) => (
        <Update key={update.id || update.url || index} update={update} newest={index === 0} />
      ))}
      {earlier > 0 && (
        <ExternalRow
          label={`${earlier} earlier ${earlier === 1 ? 'update' : 'updates'} on GitHub`}
          url={issueUrl}
        />
      )}
    </section>
  );
}

/** How many of a report's updates this screen lists before pointing at GitHub. */
const MAX_UPDATES_SHOWN = 10;
/** How much of one update shows before the tap: the newest gets the taller fold. */
const FOLD = { newest: 'line-clamp-[14]', rest: 'line-clamp-6' } as const;

/** Who said one update, in the words this screen can stand behind. */
function updateWho(update: ResolutionUpdate): string {
  if (update.by === 'claude') return 'Claude';
  if (update.by === 'app') return 'You, from the app';
  return update.author || 'Someone';
}

/**
 * What happened, in a couple of words — the part a one-line collapsed entry
 * has to carry on its own.
 */
function updateWhat(update: ResolutionUpdate): string | null {
  switch (update.kind) {
    case 'commit':
      return update.meta ? `pushed ${update.meta}` : 'pushed a commit';
    case 'review':
      return update.meta ?? 'reviewed';
    case 'review_comment':
      return update.meta ? `on ${update.meta.split('/').pop()}` : 'review note';
    default:
      return null;
  }
}

/** The icon for one entry's kind and author. */
function UpdateIcon({ update }: { update: ResolutionUpdate }) {
  const className = 'h-3.5 w-3.5 shrink-0';
  if (update.kind === 'commit') return <GitCommitHorizontal className={className} />;
  if (update.by === 'bot') return <Bot className={className} />;
  if (update.by === 'claude') return <Sparkles className={className} />;
  if (update.kind === 'review' || update.kind === 'review_comment') {
    return <MessageSquare className={className} />;
  }
  return <User className={className} />;
}

/**
 * One thing said: who, when, and the words.
 *
 * Folded to a readable height — taller for the newest — with the toggle shown
 * only when something is actually folded away, measured from the rendered
 * height: a "Show more" that reveals nothing is worse than no button. The
 * comment's own address is offered whenever the server had to shorten it —
 * not only once unfolded, because being cut off is the thing a reader needs to
 * know before they decide they have read it all.
 */
function Update({ update, newest }: { update: ResolutionUpdate; newest: boolean }) {
  // A collapsed entry starts as its one line and nothing else, so the body is
  // not rendered at all until it is opened. The newest is never collapsed by
  // the server, so this only ever hides bot output and commit bodies.
  const [open, setOpen] = useState(false);
  const body = useRef<HTMLDivElement>(null);
  // Whether anything is actually folded away, measured rather than guessed:
  // the text is rendered as reflowed blocks, so counting its source lines says
  // very little about how tall it ends up. Only measurable while it is folded,
  // and only where there is layout at all — under jsdom every height is 0, so
  // a null measurement falls back to the length.
  const [overflows, setOverflows] = useState<boolean | null>(null);
  useEffect(() => {
    if (open) return;
    const el = body.current;
    if (!el || el.clientHeight === 0) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [open, update.text]);
  const long = update.collapsed || (overflows ?? update.text.length > (newest ? 900 : 320));
  const when = relativeMoment(update.at);
  const what = updateWhat(update);
  // A collapsed entry shows its first line as the summary, so the body itself
  // stays out of the DOM until asked for.
  const summary = update.collapsed && !open ? update.text.split('\n')[0] : null;

  return (
    <article className="space-y-1 rounded-md border p-2">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <UpdateIcon update={update} />
        <span className="min-w-0 truncate font-medium text-foreground">{updateWho(update)}</span>
        {what && <span className="min-w-0 truncate">{what}</span>}
        {when && <span className="shrink-0">· {when}</span>}
        {/* Which thread this came from. The report's own comments say nothing
            — that is the default and naming it on every row is noise. */}
        {update.where !== 'issue' && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px]">
            {update.where}
          </span>
        )}
      </div>

      {summary !== null ? (
        <p className="min-w-0 truncate text-sm text-muted-foreground">{summary}</p>
      ) : (
        <div
          ref={body}
          className={`min-w-0 space-y-2 break-words text-sm ${
            open ? '' : newest ? FOLD.newest : FOLD.rest
          }`}
        >
          {readComment(update.text).map((block, index) => (
            <CommentBlock key={index} block={block} />
          ))}
        </div>
      )}

      {long && (
        <Button
          type="button" variant="ghost" size="sm"
          className="h-7 px-1 text-xs"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? 'Show less' : 'Show more'}
        </Button>
      )}

      {update.truncated && update.url && (
        <ExternalRow label="Read the rest of this comment" url={update.url} />
      )}
    </article>
  );
}

/**
 * One block of a comment, as the thing it is.
 *
 * Built from elements, never `dangerouslySetInnerHTML`: these are comments
 * from GitHub, and the one thing this screen must not do is let one of them
 * put markup into the app.
 *
 * A heading is a heading rather than `##`, a paragraph has its 80-column soft
 * wraps reflowed, and a fenced measurement keeps its own line breaks and
 * scrolls sideways rather than reflowing into nonsense — the routine's
 * before/after numbers only read as a pair when they stay in columns.
 */
function CommentBlock({ block }: { block: Block }) {
  switch (block.kind) {
    case 'heading':
      return (
        <p className={`font-semibold ${block.level <= 2 ? 'text-sm' : 'text-xs uppercase tracking-wide'}`}>
          <Spans spans={block.spans} />
        </p>
      );
    case 'code':
      return (
        <pre className="overflow-x-auto rounded bg-muted/60 p-2 text-[11px] leading-snug">
          <code>{block.text}</code>
        </pre>
      );
    case 'quote':
      return (
        <blockquote className="border-l-2 pl-2 italic text-muted-foreground">
          <Spans spans={block.spans} />
        </blockquote>
      );
    case 'list': {
      const Tag = block.ordered ? 'ol' : 'ul';
      return (
        <Tag className={`ml-4 space-y-1 ${block.ordered ? 'list-decimal' : 'list-disc'}`}>
          {block.items.map((item, index) => (
            <li key={index}><Spans spans={item} /></li>
          ))}
        </Tag>
      );
    }
    default:
      return <p><Spans spans={block.spans} /></p>;
  }
}

/** The runs inside one block: emphasis and inline code, nothing clickable. */
function Spans({ spans }: { spans: Inline[] }) {
  return (
    <>
      {spans.map((span, index) => {
        if (span.code) {
          return (
            <code key={index} className="rounded bg-muted/60 px-1 py-0.5 text-[0.95em]">
              {span.text}
            </code>
          );
        }
        if (span.bold) return <strong key={index}>{span.text}</strong>;
        if (span.italic) return <em key={index}>{span.text}</em>;
        return <span key={index}>{span.text}</span>;
      })}
    </>
  );
}

/**
 * Saying something back, and choosing who hears it.
 *
 * The two doors are not the same speed and the difference is the whole point:
 * a comment on the pull request wakes an agent on it straight away, while a
 * comment on the issue waits for the next scheduled sweep — about a day. So
 * the pull request is the default, and each option says what it costs rather
 * than leaving the reader to know.
 *
 * It goes to exactly **one** pull request. Three comments would start three
 * agents that each think they are working alone, so the server puts the words
 * on the primary one and names the others inside that comment; this says so
 * before the tap, because "who will read this" is the question the selector
 * is actually answering.
 *
 * The pull request is offered only while one is open to put it on. Where the
 * words went is shown afterwards with the comment's full address, the same
 * rule the rest of this screen follows: nothing leaves the app silently.
 */
function FeedbackSection({ issue, resolution }: { issue: ReportedIssue; resolution: Resolution }) {
  const [wanted, setWanted] = useState<FeedbackTarget>('pr');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<FeedbackResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A server that predates this sends no key at all, and offers no field —
  // the web half can ship before the server half without showing a door that
  // answers 404.
  if (!resolution.feedback) return null;

  const targets = feedbackTargets(resolution);
  if (targets.length === 0) {
    return (
      <section aria-label="Send feedback" className="space-y-1">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Send feedback
        </h3>
        <p className="text-xs text-muted-foreground">
          Sending feedback isn&rsquo;t set up on this server.
        </p>
      </section>
    );
  }

  const target = targets.includes(wanted) ? wanted : targets[0];
  const pr = feedbackPr(resolution);
  const siblings = feedbackSiblings(resolution);

  const send = async () => {
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setError('You are signed out.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      setSent(await sendFeedback(issue.issueNumber, token, target, text.trim()));
      setText('');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not send that.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section aria-label="Send feedback" className="space-y-2">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Send feedback
      </h3>

      {sent ? (
        <div className="space-y-1 text-sm">
          <p>
            Sent to {sent.target === 'issue' ? `issue #${issue.issueNumber}` : shortPr(prFromUrl(sent.on))}
            {sent.target === 'issue'
              ? ' — it gets picked up on the next sweep, about a day.'
              : ' — it gets picked up straight away.'}
          </p>
          {sent.named && sent.named.length > 0 && (
            <p className="text-xs text-muted-foreground">
              The comment names {sent.named.map((url) => shortPr(prFromUrl(url))).join(', ')} as part of the
              same fix. Nothing was posted on them.
            </p>
          )}
          {sent.comment && <ExternalRow label="The comment" url={sent.comment} />}
          <Button type="button" variant="ghost" size="sm" onClick={() => setSent(null)}>
            Say something else
          </Button>
        </div>
      ) : (
        <>
          {targets.length > 1 && pr && (
            <div role="radiogroup" aria-label="Where this goes" className="grid grid-cols-2 gap-2">
              <TargetChoice
                chosen={target === 'pr'}
                onChoose={() => setWanted('pr')}
                label={shortPr(pr)}
                detail="Picked up straight away"
              />
              <TargetChoice
                chosen={target === 'issue'}
                onChoose={() => setWanted('issue')}
                label={`Issue #${issue.issueNumber}`}
                detail="Next sweep — about a day"
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {target === 'issue' ? (
              <>Goes on the report itself, where a remark about what you asked for belongs.</>
            ) : siblings.length > 0 ? (
              <>
                Goes on {pr ? shortPr(pr) : 'the pull request'} only. The comment names{' '}
                {siblings.map(shortPr).join(', ')} as part of the same fix — commenting on all of them
                would start one agent per comment.
              </>
            ) : (
              <>Goes on {pr ? shortPr(pr) : 'the pull request'}, where it is read straight away.</>
            )}
          </p>

          <Textarea
            aria-label="Your feedback"
            rows={3}
            value={text}
            disabled={sending}
            onChange={(event) => setText(event.target.value)}
          />

          <Button
            type="button"
            className="w-full"
            disabled={sending || text.trim().length === 0}
            onClick={() => void send()}
          >
            {sending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Sending&hellip;
              </>
            ) : (
              <>
                <Send className="mr-2 h-4 w-4" />
                Send
              </>
            )}
          </Button>
        </>
      )}

      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}

/** One of the two doors: what it is, and how long it waits to be read. */
function TargetChoice(
  { chosen, onChoose, label, detail }: {
    chosen: boolean; onChoose: () => void; label: string; detail: string;
  },
) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={chosen}
      onClick={onChoose}
      className={`min-w-0 rounded-md border p-2 text-left transition-colors ${
        chosen ? 'border-primary bg-primary/10' : 'hover:bg-muted/50'
      }`}
    >
      <span className="block truncate text-sm">{label}</span>
      <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
    </button>
  );
}

/**
 * One piece of evidence, full width. Tapping opens it in the system browser,
 * which is where a phone can pinch into a before/after pair; a second overlay
 * inside the sheet would only be a smaller copy of what is already here.
 */
function Picture({ image }: { image: ResolutionImage }) {
  return (
    <figure className="min-w-0">
      <button
        type="button"
        onClick={() => openExternalUrl(image.url)}
        aria-label={`Open ${image.alt || 'the picture'} full size in your browser`}
        className="block w-full overflow-hidden rounded-md border bg-muted/30"
      >
        <img src={image.url} alt={image.alt} className="block h-auto w-full" loading="lazy" />
      </button>
      {image.alt && (
        <figcaption className="mt-1 text-xs text-muted-foreground">{image.alt}</figcaption>
      )}
    </figure>
  );
}
