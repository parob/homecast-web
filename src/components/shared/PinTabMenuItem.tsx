import { Pin, PinOff } from 'lucide-react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import { usePinAction } from '@/contexts/PinnedTabsContext';
import type { PinnedTab } from '@/lib/pinned-tabs';

/**
 * "Pin to Tab Bar", on a long press.
 *
 * Edit Layout is the deliberate, deliberate-feeling route — you go there to
 * arrange things, and every pinnable thing carries a Pin button while you are in
 * it. This is the quick one: you are looking at an accessory, you want it on the
 * bar, and entering a mode to say so is a detour.
 *
 * Context menu only. On a phone that means a long press; on the Mac there is no
 * tab bar to pin to, and `usePinAction` returns null there, so this renders
 * nothing rather than each caller repeating the check.
 *
 * The three-way state (pinned / bar full / pinnable) comes from the same hook
 * the Edit Layout badges use, so the two can never describe the bar differently.
 */
export function PinTabMenuItem({ tab }: { tab: PinnedTab }) {
  const pin = usePinAction(tab);
  if (!pin) return null;

  return (
    <ContextMenuItem
      onClick={(e) => {
        // Some of these sit inside buttons that would otherwise also fire.
        e.preventDefault();
        e.stopPropagation();
        pin.toggle();
      }}
      disabled={pin.full}
    >
      {pin.pinned ? <PinOff className="mr-2 h-4 w-4" /> : <Pin className="mr-2 h-4 w-4" />}
      {pin.label}
    </ContextMenuItem>
  );
}
