/**
 * The resolution for one reported issue: evidence first, prose last.
 *
 * A reviewer on a phone wants to know one thing — does the fix look right —
 * and the picture answers that in the time a PR body takes to scroll past.
 * So the pictures come first and full width, the one-line summary under them,
 * and the pull requests as a short list to follow through to GitHub.
 *
 * Then, where the server holds a credential for it, **Merge**. It merges what
 * the server's plan says merges now — cloud before web before native, and
 * never a web or native PR while a cloud PR ahead of it is merged but not yet
 * serving. That order is decided server-side; this view only shows the plan
 * and asks once before acting on it, because a merge to `main` reaches
 * production and a tap on a phone deserves a sentence saying so.
 *
 * Replaces the list in place rather than opening a second dialog: the sheet is
 * already a focus trap on a small screen, and a Back button is what a phone
 * user expects from a row they tapped.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronLeft, CircleDot, ExternalLink, GitMerge, GitPullRequest, Loader2, RefreshCw,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/lib/open-url';
import type { ReportedIssue } from '@/lib/report/issues';
import {
  fetchResolution, mergeLabel, mergeOutstanding, mergeResolution, mergesNow, planStatus, shortPr,
  type MergePlanEntry, type MergeState, type Resolution, type ResolutionImage,
} from '@/lib/report/resolution';

interface ResolutionViewProps {
  issue: ReportedIssue;
  onBack: () => void;
}

export function ResolutionView({ issue, onBack }: ResolutionViewProps) {
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Distinguishes "the server has no record" from "still loading": both have
  // a null resolution, and only one of them should say so.
  const [missing, setMissing] = useState(false);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMissing(false);
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
        setMissing(result === null);
      })
      .catch((loadError) => {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Could not load the resolution.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [issue.issueNumber]);

  useEffect(() => load(), [load]);

  const nothing = !loading && !error && (missing || (
    resolution !== null && resolution.prs.length === 0 && resolution.evidence.length === 0
  ));

  const plan = resolution?.merge?.plan ?? [];
  const planByUrl = new Map(plan.map((entry) => [entry.url, entry]));

  return (
    <div className="w-full min-w-0 space-y-3">
      <div className="flex items-start gap-1">
        <Button
          type="button" variant="ghost" size="icon"
          onClick={onBack}
          aria-label="Back to reports"
          className="-ml-2 h-8 w-8 shrink-0"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        {/* The row the reader tapped, so they know which issue this is
            without the list to compare against. */}
        <button
          type="button"
          onClick={() => openExternalUrl(issue.url)}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md py-1 text-left hover:bg-muted/50"
        >
          {issue.state === 'closed' ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          )}
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 break-words text-sm">{issue.title}</span>
            <span className="block text-xs text-muted-foreground">#{issue.issueNumber}</span>
          </span>
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="py-10 text-center text-sm text-destructive">{error}</p>
      )}

      {nothing && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No resolution recorded yet.
        </p>
      )}

      {!loading && !error && resolution && !nothing && (
        <>
          {resolution.evidence.length > 0 && (
            <section aria-label="Evidence" className="space-y-2">
              {resolution.evidence.map((image) => (
                <Picture key={image.url} image={image} />
              ))}
            </section>
          )}

          {resolution.summary && (
            <p className="text-sm">{resolution.summary}</p>
          )}

          {resolution.prs.length > 0 && (
            <section aria-label="Pull requests" className="space-y-1">
              {/* In the plan's order where there is one — that is the order
                  they merge in, and the order the reader should expect. */}
              {(plan.length > 0 ? plan : resolution.prs).map((pr) => {
                const entry = planByUrl.get(pr.url);
                return (
                  <button
                    key={pr.url}
                    type="button"
                    onClick={() => openExternalUrl(pr.url)}
                    className="flex w-full min-w-0 items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/50"
                  >
                    <GitPullRequest className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{shortPr(pr)}</span>
                    {entry ? (
                      <PlanPill entry={entry} />
                    ) : (
                      <>
                        {resolution.primary?.url === pr.url && resolution.prs.length > 1 && (
                          // Where a comment is picked up first. Only worth
                          // saying when there is more than one place it could go.
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            primary
                          </span>
                        )}
                        {resolution.reach && (
                          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                            {resolution.reach}
                          </span>
                        )}
                      </>
                    )}
                    <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                );
              })}
            </section>
          )}

          {resolution.merge && resolution.prs.length > 0 && (
            <MergeControls
              issueNumber={issue.issueNumber}
              merge={resolution.merge}
              onMerged={(state) => setResolution({ ...resolution, merge: state })}
              onCheckAgain={() => { load(); }}
            />
          )}

          {resolution.reported.length > 0 && (
            // Smaller and last: what was reported is context for the fix,
            // not the thing being reviewed.
            <section aria-label="As reported" className="space-y-1">
              <div className="text-xs text-muted-foreground">As reported</div>
              <div className="flex gap-2 overflow-x-auto">
                {resolution.reported.map((image) => (
                  <button
                    key={image.url}
                    type="button"
                    onClick={() => openExternalUrl(image.url)}
                    aria-label={`Open ${image.alt || 'the reported screenshot'}`}
                    className="h-20 w-20 shrink-0 overflow-hidden rounded-md border"
                  >
                    <img src={image.url} alt="" className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
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
 */
function MergeControls({ issueNumber, merge, onMerged, onCheckAgain }: MergeControlsProps) {
  const [confirming, setConfirming] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  // What the last tap merged, kept until the next load so the reader sees it.
  const [justMerged, setJustMerged] = useState<string[]>([]);

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
        aria-label={`Open ${image.alt || 'the picture'} full size`}
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
