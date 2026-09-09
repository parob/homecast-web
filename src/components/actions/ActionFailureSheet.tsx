import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from '@/components/ui/sheet';
import {
  closeActionFailures, useActionFailures, type ActionFailure,
} from './action-failures';

/**
 * A row per accessory an action could not reach, each with its own reason and
 * its own retry.
 *
 * Opened from the partial-run toast's Details button, and mounted once beside
 * `<Toaster/>` rather than inside the dashboard: the toast outlives whatever
 * was on screen when the action ran, and a pinned shortcut can be pressed from
 * anywhere.
 *
 * This is the only place the relay's per-accessory `error` survives. The toast
 * has one line for what may be several different faults — one bulb off at the
 * wall, one that timed out, one that refused the write — and flattening them
 * into "didn't respond" is the most it can honestly do.
 *
 * It has to survive a whole home failing at once. A Hue bridge dropping takes
 * every bulb behind it down together, so this opens on 130 rows about as often
 * as it opens on two — see parob/homecast#36 for why a batch that size times
 * out in the first place. Hence the bounded, scrolling shape below: a bottom
 * sheet has no height of its own, and unbounded this one grew ~12,900px
 * *upwards* out of a 926px phone, taking its title, its ✕ and 122 of its rows
 * off the top of the screen with nothing to scroll. Because the panel then
 * covered the viewport it also covered its own overlay, and with no Esc key and
 * no swipe-to-close on a bottom sheet, there was no way out of it at all.
 */
export function ActionFailureSheet() {
  const report = useActionFailures();
  /** Accessory ids with a retry in flight, so their row can say so. */
  const [retrying, setRetrying] = useState<string[]>([]);

  if (!report) return null;

  const runRetry = (failures: ActionFailure[]) => {
    setRetrying(failures.map(f => f.accessoryId));
    report.retry(failures);
  };

  const time = new Date(report.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) {
          closeActionFailures();
          setRetrying([]);
        }
      }}
    >
      {/* `dvh` rather than `vh` so the mobile browser chrome collapsing does not
          change the answer, and `gap-0` because the panel's own `gap-4` is inert
          while it is a block and would otherwise double the margins below the
          moment it becomes a flex column. */}
      <SheetContent
        side="bottom"
        className="flex max-h-[85dvh] flex-col gap-0 overflow-hidden rounded-t-2xl p-5 pb-8"
      >
        <SheetHeader className="shrink-0 space-y-1 text-left">
          <SheetTitle className="text-base">Didn’t respond</SheetTitle>
          <SheetDescription>
            {report.actionLabel} · {time}
          </SheetDescription>
        </SheetHeader>

        {/* The one part that grows, so the one part that scrolls.
            `overscroll-contain` keeps a flick at the end of the list from
            chaining to the page behind the sheet. */}
        <ul
          data-testid="failure-list"
          className="mt-4 min-h-0 flex-1 divide-y divide-border overflow-y-auto overscroll-contain"
        >
          {report.failures.map(failure => (
            <li key={failure.accessoryId} className="flex items-center gap-3 py-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400">
                <AlertCircle className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                {/* The id is a poor name, but it is the only one there is when
                    the action carried none, and a blank row is worse. */}
                <p className="truncate text-sm font-medium">{failure.name || failure.accessoryId}</p>
                <p className="text-xs leading-snug text-muted-foreground">{failure.reason}</p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="shrink-0"
                disabled={retrying.includes(failure.accessoryId)}
                onClick={() => runRetry([failure])}
              >
                {retrying.includes(failure.accessoryId)
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : 'Retry'}
              </Button>
            </li>
          ))}
        </ul>

        {/* Only worth offering when it does something the rows do not. */}
        {report.failures.length > 1 && (
          <Button
            className="mt-4 w-full shrink-0"
            disabled={retrying.length > 0}
            onClick={() => runRetry(report.failures)}
          >
            Retry all {report.failures.length}
          </Button>
        )}
      </SheetContent>
    </Sheet>
  );
}
