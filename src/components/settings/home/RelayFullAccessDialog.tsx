/**
 * The long version of "give the relay Full access".
 *
 * The overview used to carry all of this inline, four lines of amber above the
 * home's own details, on a home that works perfectly well without it. The
 * notice is now one line and this is what it opens: what the permission buys,
 * what already works without it, and the exact path through Apple Home.
 *
 * It is also reachable from the "Apple Home access" row, so the instructions
 * outlive a permanently dismissed notice.
 */

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Sparkles } from 'lucide-react';
import {
  homeEditPermissionSteps,
  HOMEKIT_EDIT_PERMISSION_ALIAS,
  HOMEKIT_EDIT_PERMISSION_GAIN,
  HOMEKIT_EDIT_PERMISSION_WITHOUT,
  type RelayKind,
} from '@/lib/homekit-errors';

export function RelayFullAccessDialog({ open, onOpenChange, relayKind, relayEmail }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  relayKind: RelayKind;
  /** The relay's address in Apple Home's People list, when we know it. */
  relayEmail?: string | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-1">
            <DialogTitle className="text-base font-semibold">Give the relay Full access</DialogTitle>
            <DialogDescription>Optional — this home works without it.</DialogDescription>
          </div>
        </div>

        <div className="space-y-3 text-sm">
          <p>{HOMEKIT_EDIT_PERMISSION_GAIN}</p>
          <p className="text-muted-foreground">{HOMEKIT_EDIT_PERMISSION_WITHOUT}</p>

          <div className="rounded-lg border bg-muted/30 p-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              In the Apple Home app
            </p>
            <ol className="mt-2 space-y-1.5 text-xs">
              {homeEditPermissionSteps(relayKind, relayEmail).map((step, i) => (
                <li key={step} className="flex gap-2">
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
                    {i + 1}
                  </span>
                  <span className="min-w-0 break-words">{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              {HOMEKIT_EDIT_PERMISSION_ALIAS} Only the home's owner can change it.
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
