import { Pin, PinOff } from 'lucide-react';
import { ContextMenuItem } from '@/components/ui/context-menu';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { usePinnedTabs } from '@/contexts/PinnedTabsContext';
import { MAX_PINNED_TABS, type PinnedTab } from '@/lib/pinned-tabs';

/**
 * "Pin to Tab Bar", once.
 *
 * This markup used to exist eight times — three sortable sidebar rows, four
 * header dropdowns and the collection list — which is why pinning an accessory
 * or a scene meant eight more copies rather than one component. The three-way
 * label (pinned / full / pinnable) is the part that was easiest to get subtly
 * out of step between them.
 *
 * Renders nothing when pinning isn't on offer, so callers don't each need the
 * `isMobile` check the provider already makes.
 */
export function PinTabMenuItem({ tab, as = 'context' }: {
  tab: PinnedTab;
  /** Which menu this sits in — the two primitives aren't interchangeable. */
  as?: 'context' | 'dropdown';
}) {
  const { enabled, isPinned, isFull, toggle } = usePinnedTabs();
  if (!enabled) return null;

  const pinned = isPinned(tab);
  const full = !pinned && isFull;
  const Item = as === 'dropdown' ? DropdownMenuItem : ContextMenuItem;

  return (
    <Item
      onClick={(e) => {
        // Header dropdowns sit inside buttons that would otherwise also fire.
        e.preventDefault();
        e.stopPropagation();
        if (!full) toggle(tab);
      }}
      disabled={full}
    >
      {pinned ? (
        <>
          <PinOff className="h-4 w-4 mr-2" />
          Unpin from Tab Bar
        </>
      ) : full ? (
        <>
          <Pin className="h-4 w-4 mr-2" />
          Tab Bar Full ({MAX_PINNED_TABS}/{MAX_PINNED_TABS})
        </>
      ) : (
        <>
          <Pin className="h-4 w-4 mr-2" />
          Pin to Tab Bar
        </>
      )}
    </Item>
  );
}
