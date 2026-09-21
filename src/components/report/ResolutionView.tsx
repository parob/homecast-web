/**
 * The resolution for one reported issue: evidence first, prose last.
 *
 * A reviewer on a phone wants to know one thing — does the fix look right —
 * and the picture answers that in the time a PR body takes to scroll past.
 * So the pictures come first and full width, the one-line summary under them,
 * and the pull requests as a short list to follow through to GitHub. Nothing
 * here merges, comments or edits: this is a view, and every action it offers
 * is "open it where the action lives".
 *
 * Replaces the list in place rather than opening a second dialog: the sheet is
 * already a focus trap on a small screen, and a Back button is what a phone
 * user expects from a row they tapped.
 */

import { useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronLeft, CircleDot, ExternalLink, GitPullRequest, Loader2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/lib/open-url';
import type { ReportedIssue } from '@/lib/report/issues';
import {
  fetchResolution, shortPr, type Resolution, type ResolutionImage,
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMissing(false);
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setLoading(false);
      setError('You are signed out.');
      return;
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

  const nothing = !loading && !error && (missing || (
    resolution !== null && resolution.prs.length === 0 && resolution.evidence.length === 0
  ));

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
              {resolution.prs.map((pr) => (
                <button
                  key={pr.url}
                  type="button"
                  onClick={() => openExternalUrl(pr.url)}
                  className="flex w-full min-w-0 items-center gap-2 rounded-md border p-2 text-left text-sm transition-colors hover:bg-muted/50"
                >
                  <GitPullRequest className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{shortPr(pr)}</span>
                  {resolution.primary?.url === pr.url && resolution.prs.length > 1 && (
                    // Where a comment is picked up first. Only worth saying
                    // when there is more than one place it could go.
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      primary
                    </span>
                  )}
                  {resolution.reach && (
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {resolution.reach}
                    </span>
                  )}
                  <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </button>
              ))}
            </section>
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
