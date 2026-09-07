/**
 * What has already been reported.
 *
 * Three jobs, all about not wasting anyone's time. Someone about to report a
 * problem can see it is already known — and, if it is closed, that it has been
 * fixed, which is often the actual answer they wanted. Anyone can follow a
 * report through to GitHub rather than wondering where it went. And, given
 * `onAddTo`, they can send what they were writing to one of these rather than
 * opening a second issue for a fault we already have.
 *
 * A closed issue can be added to on purpose. "This came back" is the most
 * useful thing a reporter can tell us, and hiding fixed issues from selection
 * would throw it away.
 *
 * Paginated rather than infinite-scrolled: the list is a reference, not a feed,
 * and a page button is easier to operate one-handed on a phone than a scroll
 * that keeps growing.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronLeft, ChevronRight, CircleDot, ExternalLink, Loader2, Plus,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { openExternalUrl } from '@/lib/open-url';
import {
  fetchReportedIssues, type IssueFilter, type ReportedIssue,
} from '@/lib/report/issues';

const FILTERS: { value: IssueFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Fixed' },
  { value: 'all', label: 'All' },
];

function when(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

interface ReportedIssuesProps {
  /**
   * Offer each row as somewhere to add the report being written. Absent — as
   * it is anywhere this list is only a reference — and the rows keep their
   * single action of opening the issue on GitHub.
   */
  onAddTo?: (issue: ReportedIssue) => void;
}

export function ReportedIssues({ onAddTo }: ReportedIssuesProps = {}) {
  const [filter, setFilter] = useState<IssueFilter>('open');
  const [page, setPage] = useState(1);
  const [issues, setIssues] = useState<ReportedIssue[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextFilter: IssueFilter, nextPage: number) => {
    setLoading(true);
    setError(null);
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setLoading(false);
      setError('You are signed out.');
      return;
    }
    try {
      const result = await fetchReportedIssues(
        { state: nextFilter, page: nextPage }, token,
      );
      setIssues(result.issues);
      setHasMore(result.hasMore);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load reports.');
      setIssues([]);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(filter, page); }, [filter, page, load]);

  return (
    // `min-w-0` all the way down: the dialog lays its children out in a grid,
    // and a grid item defaults to min-width:auto — so without this a long issue
    // title widens the column and the whole sheet overflows the screen.
    <div className="w-full min-w-0 space-y-3">
      <div className="flex gap-1">
        {FILTERS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => { setFilter(option.value); setPage(1); }}
            className={`rounded-md px-3 py-1 text-sm transition-colors ${
              filter === option.value
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {onAddTo && (
        // The plus on each row is small and easy to miss when you came here to
        // read rather than to file. One line saying what it does costs less
        // than a reporter opening a second issue for the same fault.
        <p className="text-xs text-muted-foreground">
          Tap a report to open it, or <strong className="font-medium">Add</strong> to
          send yours to it instead of opening a new one.
        </p>
      )}

      <div className="min-h-[12rem] min-w-0 space-y-1">
        {loading && (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        )}

        {!loading && error && (
          <p className="py-10 text-center text-sm text-destructive">{error}</p>
        )}

        {!loading && !error && issues.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {filter === 'closed'
              ? 'Nothing has been fixed yet.'
              : 'Nothing reported yet.'}
          </p>
        )}

        {!loading && !error && issues.map((issue) => (
          // Two actions per row once adding is offered, so the card is a
          // container and each action is its own button — a button inside a
          // button is invalid, and making the whole row do both would mean
          // guessing which one a tap meant.
          <div
            key={issue.issueNumber}
            className="flex w-full min-w-0 items-stretch rounded-md border"
          >
            {/* A button, not an anchor. Inside the app's WKWebView a
                target=_blank navigation is silently dropped — github.com is not
                an app-bound domain — so the tap did nothing at all.
                `openExternalUrl` hands the URL to the native shell, which opens
                it in the system browser, and falls back to window.open in a
                real browser. */}
            <button
              type="button"
              onClick={() => openExternalUrl(issue.url)}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-l-md p-2 text-left transition-colors hover:bg-muted/50"
            >
              {issue.state === 'closed' ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />
              ) : (
                <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              )}
              <div className="min-w-0 flex-1">
                {/* Two lines, then ellipsis. `truncate` at one line lost the end of
                    almost every real issue title; a bug report's title is where
                    the information is, so give it the room to be read. */}
                <div className="line-clamp-2 break-words text-sm">{issue.title}</div>
                <div className="truncate text-xs text-muted-foreground">
                  #{issue.issueNumber}
                  {when(issue.createdAt) && ` · ${when(issue.createdAt)}`}
                  {issue.commentCount > 0 &&
                    ` · ${issue.commentCount} ${issue.commentCount === 1 ? 'comment' : 'comments'}`}
                </div>
              </div>
              <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>

            {onAddTo && (
              // Beside the row rather than under it: a footer per card would
              // add a third of the list's height for a button most rows never
              // get pressed. The label is short because the column is narrow;
              // what it adds to is in the aria-label and, once pressed, in the
              // banner on the compose tab.
              <button
                type="button"
                onClick={() => onAddTo(issue)}
                aria-label={`Add this report to #${issue.issueNumber}`}
                className="flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-r-md border-l px-2 text-[11px] text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              >
                <Plus className="h-4 w-4" />
                Add
              </button>
            )}
          </div>
        ))}
      </div>

      {(page > 1 || hasMore) && (
        <div className="flex items-center justify-between">
          <Button
            type="button" variant="ghost" size="sm"
            disabled={page === 1 || loading}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            <ChevronLeft className="mr-1 h-4 w-4" />
            Newer
          </Button>
          <span className="text-xs text-muted-foreground">Page {page}</span>
          <Button
            type="button" variant="ghost" size="sm"
            disabled={!hasMore || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Older
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}
