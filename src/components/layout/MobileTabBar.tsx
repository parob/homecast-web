import { useCallback, useState } from 'react';
import { cn } from '@/lib/utils';
import { Folder, House, Layers, Loader2, Plus, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { getRoomIcon } from '@/components/widgets/roomIcons';
import { getAccessoryIcon } from '@/components/widgets/serviceIcons';
import { HOME_ACTION_TAB_ICONS } from '@/components/actions/icons';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import { EditBadge } from '@/components/shared/EditBadge';
import { MAX_PINNED_TABS, pinBehaviour, pinKey, type PinnedTab, type PinTarget } from '@/lib/pinned-tabs';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import type { HomeActionId } from '@/lib/summary-sections';

export { MAX_PINNED_TABS };

/**
 * Whether a pin still points at something.
 *
 * `missing` is deliberately not the same as "hide it". A relay that is merely
 * offline, or a home that has not synced yet, would otherwise silently empty
 * the user's tab bar — so an unresolved tab stays put, dimmed, and says so when
 * pressed. The cached `name` is what it draws in the meantime.
 */
export type PinnedTabStatus = 'ready' | 'loading' | 'missing';

/** Height reserved above the bar so a control panel never sits under it. */
const TAB_BAR_INSET = 76;

/** Longest a custom tab label may be — the bar has room for about this much. */
const MAX_LABEL_LENGTH = 20;

interface MobileTabBarProps {
  pinnedTabs: PinnedTab[];
  selectedHomeId: string | null;
  selectedRoomId: string | null;
  selectedCollectionId: string | null;
  selectedCollectionGroupId: string | null;
  onSelectHome: (homeId: string) => void;
  onSelectRoom: (homeId: string, roomId: string) => void;
  onSelectCollection: (collectionId: string) => void;
  onSelectCollectionGroup: (collectionId: string, groupId: string) => void;
  /** Runs a pinned scene or action. Resolves when it's done, for the spinner. */
  onActivate: (tab: PinnedTab) => Promise<void>;
  /** The control panel for a popover-type tab, or null while it can't resolve. */
  renderControl: (tab: PinnedTab) => React.ReactNode;
  /** Looks the pin's target up, so a dead one can be dimmed rather than dropped. */
  resolveStatus: (tab: PinnedTab) => PinnedTabStatus;
  /** For an accessory tab's icon — the same glyph its tile wears. */
  resolveAccessory: (tab: PinnedTab) => HomeKitAccessory | undefined;
  isDarkBackground?: boolean;
  /**
   * Edit Layout is running. The bar stops navigating and becomes the thing being
   * arranged: drag to reorder, ⊗ to unpin, tap a label to rename it.
   *
   * This used to live in Settings → Tab Bar, which was gated on `isInMobileApp`
   * and therefore unreachable in the mobile browser where the bar actually
   * renders. Editing the bar on the bar also means you can see the result at the
   * size it will be, which a list of rows in a dialog could not show.
   */
  editMode?: boolean;
  onReorder?: (reordered: PinnedTab[]) => void;
  onRename?: (target: PinTarget, customName: string | undefined) => void;
  onUnpin?: (target: PinTarget) => void;
  /** Tapping the empty slot — the Dashboard explains how to pin something. */
  onRequestPin?: () => void;
}

export function MobileTabBar({
  pinnedTabs,
  selectedHomeId,
  selectedRoomId,
  selectedCollectionId,
  selectedCollectionGroupId,
  onSelectHome,
  onSelectRoom,
  onSelectCollection,
  onSelectCollectionGroup,
  onActivate,
  renderControl,
  resolveStatus,
  resolveAccessory,
  isDarkBackground,
  editMode = false,
  onReorder,
  onRename,
  onUnpin,
  onRequestPin,
}: MobileTabBarProps) {
  /** Which popover tab is open, by pin key. At most one at a time. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Which run tab is mid-flight, by pin key. */
  const [runningKey, setRunningKey] = useState<string | null>(null);
  /** Which tab's label is currently an input, by pin key. Edit mode only. */
  const [renamingKey, setRenamingKey] = useState<string | null>(null);

  const runTab = useCallback(async (tab: PinnedTab) => {
    const key = pinKey(tab);
    setRunningKey(key);
    try {
      await onActivate(tab);
    } finally {
      // Guard against a second press having started something else meanwhile.
      setRunningKey(prev => (prev === key ? null : prev));
    }
  }, [onActivate]);

  // Same split as DraggableGrid: a pointer needs to travel before it counts as a
  // drag, a finger needs to dwell. Without the dwell, every tap to rename would
  // be swallowed as the start of a reorder.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const itemIds = pinnedTabs.map(pinKey);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder?.(arrayMove(pinnedTabs, oldIndex, newIndex));
  }, [itemIds, pinnedTabs, onReorder]);

  // Outside edit mode an empty bar is nothing to draw. Inside it, the empty slot
  // is the only thing telling you how to fill the bar, so it has to render.
  if (pinnedTabs.length === 0 && !editMode) return null;

  const getIcon = (tab: PinnedTab): LucideIcon => {
    switch (tab.type) {
      case 'home': return House;
      case 'room': return getRoomIcon(tab.name);
      case 'collection': return Folder;
      case 'collectionGroup': return Layers;
      case 'scene': return Zap;
      // Keyed, not derived: the tab has to draw itself before the home's
      // accessories have loaded, and deriving would leave it blank until then.
      case 'action': return HOME_ACTION_TAB_ICONS[tab.id as HomeActionId] ?? Zap;
      case 'accessory': return getAccessoryIcon(resolveAccessory(tab));
      case 'serviceGroup': return Layers;
    }
  };

  /**
   * Three different meanings of "active", which is the whole point of the bar
   * holding three kinds of pin:
   *
   * - navigate — you are looking at it.
   * - popover  — its panel is open.
   * - run      — never latches. A tab that stayed lit after running "Everything
   *              off" would be claiming to be a place you are, which it isn't.
   *
   * None of them apply while editing: the bar is the subject then, not a
   * pointer at somewhere else.
   */
  const isActive = (tab: PinnedTab): boolean => {
    if (editMode) return false;
    switch (tab.type) {
      case 'home': return selectedHomeId === tab.id && !selectedRoomId && !selectedCollectionId;
      case 'room': return selectedRoomId === tab.id;
      case 'collection': return selectedCollectionId === tab.id && !selectedCollectionGroupId;
      case 'collectionGroup': return selectedCollectionGroupId === tab.id;
      case 'accessory':
      case 'serviceGroup': return openKey === pinKey(tab);
      case 'action':
      case 'scene': return runningKey === pinKey(tab);
    }
  };

  const handleTap = (tab: PinnedTab, status: PinnedTabStatus) => {
    // While editing, a tap renames. Navigating away mid-edit would drop you into
    // another room with the toolbar still up and nothing explaining the move.
    if (editMode) {
      setRenamingKey(pinKey(tab));
      return;
    }

    if (status === 'missing') {
      void onActivate(tab); // Dashboard explains what's gone.
      return;
    }

    switch (pinBehaviour(tab.type)) {
      case 'navigate':
        setOpenKey(null);
        switch (tab.type) {
          case 'home': return onSelectHome(tab.id);
          case 'room': return onSelectRoom(tab.homeId!, tab.id);
          case 'collection': return onSelectCollection(tab.id);
          case 'collectionGroup': return onSelectCollectionGroup(tab.collectionId!, tab.id);
        }
        return;
      case 'popover': {
        const key = pinKey(tab);
        setOpenKey(prev => (prev === key ? null : key));
        return;
      }
      case 'run':
        if (runningKey) return; // Don't queue a second press on a slow relay.
        void runTab(tab);
        return;
    }
  };

  const commitRename = (tab: PinnedTab, raw: string) => {
    const trimmed = raw.trim();
    const next = trimmed || undefined;
    if (next !== (tab.customName ?? undefined)) onRename?.(tab, next);
    setRenamingKey(null);
  };

  const tabs = pinnedTabs.map((tab) => {
    const key = pinKey(tab);
    const status = resolveStatus(tab);
    const Icon = getIcon(tab);
    const active = isActive(tab);
    const running = runningKey === key;
    const isOpen = openKey === key && !editMode;
    const missing = status === 'missing';

    return (
      <TabSlot key={key} id={key} sortable={editMode && renamingKey !== key}>
        {(dragProps) => (<>
        <button
          {...dragProps}
          onClick={() => handleTap(tab, status)}
          aria-current={active ? 'true' : undefined}
          aria-disabled={missing || undefined}
          className={cn(
            'flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg min-w-0 transition-colors',
            active
              ? isDarkBackground ? 'bg-white/20' : 'bg-black/10'
              : 'active:bg-white/10',
            missing && !editMode && 'opacity-50',
          )}
        >
          {running ? (
            <Loader2 className={cn(
              'h-5 w-5 shrink-0 animate-spin',
              isDarkBackground ? 'text-white' : 'text-foreground',
            )} />
          ) : (
            <Icon className={cn(
              'h-5 w-5 shrink-0',
              isDarkBackground ? 'text-white' : active ? 'text-foreground' : 'text-muted-foreground'
            )} />
          )}
          {editMode && renamingKey === key ? (
            <input
              autoFocus
              defaultValue={tab.customName ?? ''}
              placeholder={tab.name}
              maxLength={MAX_LABEL_LENGTH}
              aria-label={`Rename ${tab.name}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              onBlur={(e) => commitRename(tab, e.currentTarget.value)}
              // Space and Enter are dnd-kit's keyboard drag activators, and the
              // handle is the button this field sits inside. Without this, typing
              // a space in a label starts a reorder.
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') e.currentTarget.blur();
                if (e.key === 'Escape') setRenamingKey(null);
              }}
              className={cn(
                'w-16 text-[10px] font-medium text-center rounded bg-white/80 text-black',
                'px-1 py-px outline-none ring-1 ring-primary',
              )}
            />
          ) : (
            <span className={cn(
              'text-[10px] font-medium truncate max-w-16',
              isDarkBackground ? 'text-white/80' : active ? 'text-foreground' : 'text-muted-foreground'
            )}>
              {tab.customName || tab.name}
            </span>
          )}
        </button>

        {editMode && onUnpin && (
          <EditBadge
            kind="remove"
            size="sm"
            label={`Unpin ${tab.customName || tab.name}`}
            onClick={() => {
              if (renamingKey === key) setRenamingKey(null);
              onUnpin(tab);
            }}
            // Inside the slot's box, not overhanging it: the pill scrolls
            // horizontally while editing, and `overflow-x: auto` forces
            // `overflow-y` to compute to `auto` as well — an overhanging badge
            // would be clipped off the top rather than drawn over the edge.
            className="absolute top-0 right-0"
          />
        )}

        {isOpen && !missing && (
          <ExpandedOverlay
            isExpanded
            onClose={() => setOpenKey(null)}
            bottomInset={TAB_BAR_INSET}
          >
            {renderControl(tab)}
          </ExpandedOverlay>
        )}
        </>)}
      </TabSlot>
    );
  });

  const addSlot = editMode && pinnedTabs.length < MAX_PINNED_TABS ? (
    <button
      key="__add"
      onClick={onRequestPin}
      className="shrink-0 flex flex-col items-center gap-0.5 px-3 py-1.5 rounded-lg border border-dashed border-current/40 text-muted-foreground active:bg-white/10"
    >
      <Plus className="h-5 w-5 shrink-0" />
      <span className="text-[10px] font-medium">Add</span>
    </button>
  ) : null;

  const pill = (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-1 px-2 py-1.5 rounded-2xl transition-colors duration-300',
        isDarkBackground ? 'material-regular-dark' : 'material-regular',
        // Badges and a rename field don't fit five tabs at phone widths.
        editMode && 'overflow-x-auto scrollbar-hidden',
      )}
      style={{ maxWidth: 'calc(100% - 32px)' }}
    >
      {tabs}
      {addSlot}
    </div>
  );

  return (
    <div className="fixed bottom-0 left-0 right-0 z-[10001] pointer-events-none safe-area-bottom safe-area-x">
      <div className="flex justify-center px-4 pb-2">
        {editMode ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={itemIds} strategy={horizontalListSortingStrategy}>
              {pill}
            </SortableContext>
          </DndContext>
        ) : (
          pill
        )}
      </div>
    </div>
  );
}

/**
 * One tab's box. It anchors the popover overlay (whose placeholder can't live
 * inside a `<button>`, and which anchoring here lets a press on the open tab
 * count as "inside", so tapping it closes cleanly instead of closing then
 * reopening), and in edit mode it is also the sortable node and the wiggle.
 *
 * Two placements matter:
 *
 * - **The drag handle goes on the tab's own `<button>`, not on this wrapper.**
 *   dnd-kit's `attributes` include `role="button"` and a tabIndex; putting them
 *   here nested one button inside another, which is invalid, made the unpin
 *   badge part of the outer control's accessible name, and gave screen readers
 *   two things to press for one tab. Handed down instead, so the sortable node
 *   and the drag handle are different elements — which is also what keeps the
 *   badge pressable, since it is a sibling of the handle rather than inside it.
 * - **The wiggle is here rather than on the pill**, because the pill is a
 *   `backdrop-filter` surface: an animated transform on an ancestor of one makes
 *   it a new backdrop root and the glass switches off for as long as it runs.
 *   `src/index.css` documents the same trap for widget tiles.
 */
function TabSlot({ id, sortable, children }: {
  id: string;
  /** False outside edit mode, and while this tab's label is being typed into. */
  sortable: boolean;
  children: (dragProps: Record<string, unknown>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });

  if (!sortable) return <div className="relative">{children({})}</div>;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="relative shrink-0 touch-none"
      // Marks the element dnd-kit writes its inline transform onto. The wiggle
      // must never land here — a test asserts these stay two elements.
      data-sortable-node=""
    >
      {/* The wiggle MUST be on a different element from the sortable transform.
          `.wiggle` sets `transform: rotate(...)` through a CSS animation, and a
          running animation outranks an inline style — so sharing one element
          meant the rotate silently replaced dnd-kit's translate, and the other
          tabs never moved aside as you dragged. Nothing appeared to happen until
          the drop reordered the DOM. The dashboard tiles are already split this
          way (SortableItem carries the transform, WidgetCard the wiggle); this
          collapsed the two into one and reintroduced the clash. */}
      <div
        className={cn(!isDragging && 'wiggle')}
        style={{
          // Derived from the id so neighbouring tabs don't wiggle in lockstep.
          '--wiggle-offset': `${(id.charCodeAt(0) % 5) * 0.05}deg`,
        } as React.CSSProperties}
      >
        {children({ ...attributes, ...listeners })}
      </div>
    </div>
  );
}
