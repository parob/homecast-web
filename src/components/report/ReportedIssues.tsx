/**
 * What has already been reported.
 *
 * Three jobs, all about not wasting anyone's time. Someone about to report a
 * problem can see it is already known — and, if it is closed, that it has been
 * fixed, which is often the actual answer they wanted. Given `onOpen`, a row
 * opens the issue here in the app — what was reported and what fixes it, on
 * one screen, with the GitHub link spelled out inside it rather than a tap
 * that silently leaves the app. And, given `onAddTo`, they can send what they
 * were writing to one of these rather than opening a second issue for a fault
 * we already have.
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
  Check, CheckCircle2, ChevronLeft, ChevronRight, Circle, CircleAlert, CircleDashed, CircleDot,
  CircleDotDashed, CircleSlash, CircleX, Loader2, MessageSquare, Plus, type LucideIcon,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  fetchReportedIssues, relativeAge, relativeMoment, type IssueFilter, type LinkedPr, type ReportedIssue,
} from '@/lib/report/issues';
import {
  commentWho, prChipName, prWord, prWordTone, reportStatus, showsLastComment,
  type PrWord, type StatusTone,
} from '@/lib/report/resolution';

/**
 * How each status reads. Muted for `idle` on purpose: "No PR yet" is the
 * absence of news, and it should be legible without competing with the rows
 * that actually have some.
 */
const STATUS_TONE: Record<StatusTone, string> = {
  done: 'bg-green-600/15 text-green-700 dark:text-green-400',
  active: 'bg-primary/15 text-primary',
  waiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  idle: 'bg-muted text-muted-foreground',
};

/** The same tones as ink alone, for a chip that has no pill of its own. */
const INK_TONE: Record<StatusTone, string> = {
  done: 'text-green-700 dark:text-green-400',
  active: 'text-primary',
  waiting: 'text-amber-700 dark:text-amber-400',
  idle: 'text-muted-foreground',
};

/**
 * One glyph per word, after GitHub's own: a dashed ring is a draft, a filled
 * dot is ready, a tick is merged. Shape as well as colour, so the row reads
 * the same in either theme and to someone who does not see the colour.
 */
const PR_GLYPH: Record<PrWord, LucideIcon> = {
  Draft: CircleDashed,
  Open: Circle,
  Ready: Circle,
  'Checks running': CircleDotDashed,
  'Checks failing': CircleX,
  Conflict: CircleAlert,
  'Merged · live': Check,
  'Merged · deploying': Check,
  Merged: Check,
  Closed: CircleSlash,
};

/**
 * One linked pull request: its glyph, its short name and its word.
 *
 * Text, not a link. The row is the tap target — it opens the issue, where
 * each pull request is listed with its full address — and an 11px link
 * inside it would be a target too small to hit and one that fights the row
 * for every tap near it.
 */
function PrChip({ pr }: { pr: LinkedPr }) {
  const word = prWord(pr);
  const ink = INK_TONE[prWordTone(word)];
  const Glyph = PR_GLYPH[word];
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1" data-pr-chip={pr.url}>
      {/* A filled dot reads heavier than a ring, so it is drawn a size down. */}
      <Glyph
        aria-hidden
        className={`shrink-0 ${ink} ${word === 'Ready' ? 'mx-px h-2.5 w-2.5 fill-current' : 'h-3 w-3'}`}
      />
      <span className="min-w-0 truncate text-muted-foreground">{prChipName(pr)}</span>{' '}
      <span className={`shrink-0 ${ink}`}>{word}</span>
    </span>
  );
}

/**
 * Open, closed as done, or closed without a fix. A duplicate or a "not
 * planned" is not a green tick: nothing was fixed.
 */
export function ReportStateIcon({ state, word }: { state: string | null; word: string }) {
  if (state !== 'closed') return <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />;
  if (word === 'Duplicate' || word === 'Not planned') {
    return <CircleSlash className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />;
  }
  return <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" />;
}

const FILTERS: { value: IssueFilter; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Fixed' },
  { value: 'all', label: 'All' },
];

interface ReportedIssuesProps {
  /**
   * Offer each row as somewhere to add the report being written. Tapping the
   * row chooses it, the same as the Add button beside it: in a picker there
   * is exactly one thing a row can mean.
   */
  onAddTo?: (issue: ReportedIssue) => void;
  /**
   * Open the issue in the app — what was reported and what fixes it. Where
   * this is given, that is what a tap on the row does; nothing here leaves
   * the app without saying so.
   */
  onOpen?: (issue: ReportedIssue) => void;
}

export function ReportedIssues({ onAddTo, onOpen }: ReportedIssuesProps = {}) {
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
        // Given `onAddTo`, the reader pressed something that said "add to an
        // existing report" and is here to choose one — so the line says which
        // of the two things a tap does, rather than advertising that adding is
        // possible at all.
        <p className="text-xs text-muted-foreground">
          <strong className="font-medium">Add</strong> sends your report to that
          one instead of opening a new one. Tapping the title opens it on GitHub.
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

        {!loading && !error && issues.map((issue) => {
          const status = reportStatus(issue);
          const age = relativeAge(issue.createdAt);
          const prs = issue.prs ?? [];
          const comment = showsLastComment(issue) ? issue.lastComment ?? null : null;
          const said = comment ? relativeMoment(comment.at) : '';
          // In the app, or chosen: the row's one tap. A row with neither
          // is a plain reference (nothing here does that today).
          const onRow = onOpen ?? onAddTo;
          return (
          // The card is a container and each action is its own button — a
          // button inside a button is invalid, and making the whole row do
          // both would mean guessing which one a tap meant.
          <div
            key={issue.issueNumber}
            className="flex w-full min-w-0 items-stretch rounded-md border"
          >
            <button
              type="button"
              onClick={onRow ? () => onRow(issue) : undefined}
              disabled={!onRow}
              aria-label={onOpen ? `Open #${issue.issueNumber}` : undefined}
              className="flex min-w-0 flex-1 items-start gap-2 rounded-l-md p-2 text-left transition-colors hover:bg-muted/50"
            >
              <ReportStateIcon state={issue.state} word={status.word} />
              <div className="min-w-0 flex-1">
                {/* Two lines, then ellipsis. `truncate` at one line lost the end of
                    almost every real issue title; a bug report's title is where
                    the information is, so give it the room to be read. */}
                <div className="line-clamp-2 break-words text-sm">{issue.title}</div>
                {/* Wraps: the status word is additive, and on a narrow row it must
                    take its own line rather than eat the comment count beside it.
                    The count is a glyph and a number so that, on a 390pt phone,
                    it rarely has to: "3 comments" alone pushed most words down. */}
                <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
                  <span className="truncate">
                    #{issue.issueNumber}
                    {age && ` · ${age}`}
                    {issue.commentCount > 0 && (
                      <>
                        {' · '}
                        <MessageSquare aria-hidden className="mb-px inline h-3 w-3" />
                        <span className="sr-only">
                          {issue.commentCount === 1 ? 'comment' : 'comments'}:
                        </span>
                        {' '}{issue.commentCount}
                      </>
                    )}
                  </span>
                  {/* A word, not a button: where the report stands is a fact
                      about the row, and the row itself is what opens it. Every
                      open row carries one — a row with no news used to render
                      blank, which read as "being worked on" and was the whole
                      of homecast-cloud#181. Read from GitHub, not labels,
                      wherever the server sends the linked PRs. */}
                  <span
                    className={`shrink-0 rounded-full px-1.5 py-px text-[11px] ${STATUS_TONE[status.tone]}`}
                  >
                    {status.word}
                  </span>
                </div>
                {/* One chip per linked PR, so a row with three says which of
                    the three is holding it up. Wraps rather than truncating
                    the set: a hidden chip would be the one that mattered. */}
                {prs.length > 0 && (
                  <span className="mt-0.5 flex min-w-0 flex-wrap gap-x-2.5 gap-y-0.5 text-[11px]">
                    {prs.map((pr) => <PrChip key={pr.url} pr={pr} />)}
                  </span>
                )}
                {/* The latest word on the report, where it is the news — a
                    question from Claude is not a status, so it reads as what
                    it is. Two lines, because one cut every real question off
                    before its question mark; the age leads, so a long line
                    never clips it. */}
                {comment && (
                  <span className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">
                    <span className="font-medium text-foreground/80">
                      {commentWho(comment)}{said && `, ${said}`}:
                    </span>{' '}
                    {comment.text}
                  </span>
                )}
              </div>
              {onOpen && (
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              )}
            </button>

            {onAddTo && (
              // Beside the row rather than under it: a footer per card would
              // add a third of the list's height for a button most rows never
              // get pressed. The label is short because the column is narrow;
              // what it adds to is in the aria-label and, once pressed, in the
              // banner that replaces the picker.
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
          );
        })}
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
