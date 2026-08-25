/**
 * What has already been reported.
 *
 * Two jobs, both about not wasting anyone's time. Someone about to report a
 * problem can see it is already known — and, if it is closed, that it has been
 * fixed, which is often the actual answer they wanted. And anyone can follow a
 * report through to GitHub rather than wondering where it went.
 *
 * Paginated rather than infinite-scrolled: the list is a reference, not a feed,
 * and a page button is easier to operate one-handed on a phone than a scroll
 * that keeps growing.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2, ChevronLeft, ChevronRight, CircleDot, ExternalLink, Loader2,
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

export function ReportedIssues() {
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
          // A button, not an anchor. Inside the app's WKWebView a target=_blank
          // navigation is silently dropped — github.com is not an app-bound
          // domain — so the tap did nothing at all. `openExternalUrl` hands the
          // URL to the native shell, which opens it in the system browser, and
          // falls back to window.open in a real browser.
          <button
            key={issue.issueNumber}
            type="button"
            onClick={() => openExternalUrl(issue.url)}
            className="flex w-full min-w-0 items-start gap-2 rounded-md border p-2 text-left transition-colors hover:bg-muted/50"
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
