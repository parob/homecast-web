/**
 * Explains that Homecast can't edit this home, at the moment the user reaches
 * for an edit — not after they've built the thing.
 *
 * Shown by click-through rather than by disabling the button: a disabled
 * control can only carry its reason in a tooltip, and there is no hover on the
 * iPad and iPhone clients, so the explanation would simply never appear there.
 *
 * Mount it only while open (`{open && <ViewOnlyHomeDialog …/>}`) — it reads the
 * homes cache, and there is one of these per automation card.
 */

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Lock } from 'lucide-react';
import { useHomeRelayKind } from '@/hooks/useRelayCannotEdit';
import { homeEditPermissionFix, HOMEKIT_EDIT_PERMISSION_ALIAS } from '@/lib/homekit-errors';

const TITLES = {
  scene: 'Scenes are read-only here',
  automation: 'Automations are read-only here',
} as const;

export function ViewOnlyHomeDialog({ open, onOpenChange, homeId, subject }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId?: string | null;
  subject: 'scene' | 'automation';
}) {
  const relayKind = useHomeRelayKind(homeId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-500/10 text-amber-600">
            <Lock className="h-4 w-4" />
          </div>
          <div className="min-w-0 space-y-3">
            <DialogTitle className="text-base font-semibold">{TITLES[subject]}</DialogTitle>
            <DialogDescription className="space-y-3">
              <span className="block">
                Homecast can view this home but not change it. You can still run scenes and
                control accessories.
              </span>
              <span className="block font-medium text-foreground">
                {homeEditPermissionFix(relayKind)}
              </span>
              <span className="block text-xs text-muted-foreground/70">
                {HOMEKIT_EDIT_PERMISSION_ALIAS}
              </span>
            </DialogDescription>
          </div>
        </div>
        <div className="flex justify-end">
          <Button size="sm" variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
