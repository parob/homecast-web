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
      <SheetContent side="bottom" className="rounded-t-2xl p-5 pb-8">
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="text-base">Didn’t respond</SheetTitle>
          <SheetDescription>
            {report.actionLabel} · {time}
          </SheetDescription>
        </SheetHeader>

        <ul className="mt-4 divide-y divide-border">
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
            className="mt-4 w-full"
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
