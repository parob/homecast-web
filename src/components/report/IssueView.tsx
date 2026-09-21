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

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2, ChevronLeft, CircleDot, ExternalLink, GitMerge, GitPullRequest, Loader2, MessageSquareWarning,
  RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/lib/open-url';
import { relativeAge, type ReportedIssue } from '@/lib/report/issues';
import {
  conflictsIn, fetchResolution, mergeLabel, mergeOutstanding, mergeResolution, mergesNow, nudgeConflicts,
  planStatus, shortPr,
  type ConflictNudge, type MergePlanEntry, type MergeState, type Resolution, type ResolutionImage,
  type ResolutionPr,
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

  const fixed = issue.state === 'closed';
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
              {` · ${fixed ? 'Fixed' : 'Open'}`}
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
                    issueNumber={issue.issueNumber}
                    merge={resolution.merge}
                    onMerged={(state) => setResolution({ ...resolution, merge: state })}
                    onCheckAgain={() => { load(); }}
                  />
                )}
              </>
            )}
          </section>

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
function MergeControls({ issueNumber, merge, onMerged, onCheckAgain }: MergeControlsProps) {
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
        <p className="text-sm text-muted-foreground">All merged.</p>
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
