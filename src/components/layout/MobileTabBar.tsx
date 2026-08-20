import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import { Folder, House, Layers, Zap } from 'lucide-react';
import { PendingRing } from '@/components/widgets/shared/PendingRing';
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
import { DEFAULT_TAB_BAR_MODE, tabBarScrolls, type TabBarMode } from '@/lib/tab-bar-mode';
import { TabEditSheet } from './TabEditSheet';
import { tabIconComponent } from './tabIconComponents';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import type { HomeActionId } from '@/lib/summary-sections';

export { MAX_PINNED_TABS };

/** How long a chip takes to reach the middle. */
const CENTRE_MS = 220;

/**
 * Where the row must scroll for `key` to sit in the middle of it.
 *
 * Measured, not `offsetLeft`. Every chip sits in a `TabSlot`, which is
 * `position: relative` so it can anchor the unpin badge — which makes it the
 * chip's offsetParent, so `offsetLeft` is the chip's position inside its own
 * wrapper: about zero, for all of them. The target came out at 0 every time and
 * the bar never moved.
 */
function targetFor(el: HTMLElement, key: string): number {
  const chip = [...el.querySelectorAll<HTMLElement>('[data-tab-key]')]
    .find(n => n.dataset.tabKey === key);
  if (!chip) return el.scrollLeft;
  const chipBox = chip.getBoundingClientRect();
  const elBox = el.getBoundingClientRect();
  const centreWithinRow = el.scrollLeft + (chipBox.left - elBox.left) + chipBox.width / 2;
  return Math.max(0, Math.min(
    centreWithinRow - el.clientWidth / 2,
    el.scrollWidth - el.clientWidth,
  ));
}

/** Leaves fast and settles — the same shape as the `ease-standard` token. */
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Scroll `el` to `left`, in our own time.
 *
 * `scroll-behavior: smooth` is the obvious way and the wrong one twice over:
 * its duration is the browser's to choose and is slower than a tab bar wants,
 * and it emits scroll events on its own schedule — which the open panel is
 * following, so the panel inherited whatever cadence the browser felt like.
 * Driving it here means both move on the same frames.
 */
function animateScrollTo(el: HTMLElement, left: number, onFrame?: () => void): () => void {
  const from = el.scrollLeft;
  const distance = left - from;
  if (Math.abs(distance) < 1) return () => {};

  // Someone who has asked for less motion gets the destination, not the trip.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.scrollLeft = left;
    onFrame?.();
    return () => {};
  }

  let raf = 0;
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / CENTRE_MS);
    el.scrollLeft = from + distance * easeOut(t);
    onFrame?.();
    if (t < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

/**
 * Whether a pin still points at something.
 *
 * `missing` is deliberately not the same as "hide it". A relay that is merely
 * offline, or a home that has not synced yet, would otherwise silently empty
 * the user's tab bar — so an unresolved tab stays put, dimmed, and says so when
 * pressed. The cached `name` is what it draws in the meantime.
 */
export type PinnedTabStatus = 'ready' | 'loading' | 'missing';

/**
 * Fallback height to keep clear at the bottom for a panel opened from the bar,
 * used until the bar has been measured.
 *
 * Measured rather than assumed, because the bar is not one height: compact
 * stacks a two-line name under each icon and stands a good deal taller than a
 * row of chips. A constant sized for one left the panel sitting on top of the
 * other.
 */
const TAB_BAR_INSET = 96;

/** Wallpaper left between the bar and the panel above it. */
const PANEL_GAP = 12;

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
   * How much of each pin to draw. A Display setting; see lib/tab-bar-mode.ts.
   *
   * Arranging always uses `compact` whatever this says — five chips at their
   * full width do not fit a phone, and a row you have to scroll is a row you
   * cannot see to reorder.
   */
  mode?: TabBarMode;
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
  /**
   * Both overrides at once. They travel together because the receiver rewrites
   * the whole `pinnedTabs` blob — two calls would each save from their own
   * copy of state and the second would undo the first.
   */
  onRename?: (target: PinTarget, next: { customName?: string; customIcon?: string }) => void;
  onUnpin?: (target: PinTarget) => void;
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
  mode = DEFAULT_TAB_BAR_MODE,
  editMode = false,
  onReorder,
  onRename,
  onUnpin,
}: MobileTabBarProps) {
  /** Which popover tab is open, by pin key. At most one at a time. */
  const [openKey, setOpenKey] = useState<string | null>(null);
  /** Which run tab is mid-flight, by pin key. */
  const [runningKey, setRunningKey] = useState<string | null>(null);
  /** Which tab the edit dialog is open for, by pin key. Edit mode only. */
  const [editingKey, setEditingKey] = useState<string | null>(null);
  /**
   * The tab the finger is currently over, mid-press. Null when idle.
   *
   * The bar is a row of small targets at the bottom edge of a phone, which is
   * the worst place to have to hit something first time. So a press is not
   * committed until it is released: slide along the bar and the tab under your
   * thumb is the one that expands, and that is the one you get. Sliding off the
   * bar and letting go picks nothing, which is how you back out.
   */
  const [dragKey, setDragKey] = useState<string | null>(null);
  /** Set by the gesture below so the click it also produces does nothing. */
  const suppressClickRef = useRef(false);

  const barRef = useRef<HTMLDivElement>(null);
  /** The bar's own height, so a panel clears whichever shape it is wearing. */
  const [barHeight, setBarHeight] = useState(TAB_BAR_INSET - PANEL_GAP);
  const scrollerRef = useRef<HTMLDivElement>(null);
  /** The last glyph each accessory pin actually resolved to. */
  const iconMemoRef = useRef(new Map<string, LucideIcon>());
  /** Stops an in-flight centring when a second press starts another. */
  const cancelCentreRef = useRef<() => void>(() => {});
  /** Whether the row is wider than the bar, and which ends have more beyond them. */
  const [scrollable, setScrollable] = useState(false);
  const [fadeLeft, setFadeLeft] = useState(false);
  const [fadeRight, setFadeRight] = useState(false);

  /**
   * Which ends of the row have more beyond them.
   *
   * Directional on purpose: a fade on an end you have already reached claims
   * there is more that way when there is not, which is worse than no fade at
   * all — it reads as a rendering fault rather than an affordance.
   */
  const measureScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setScrollable(max > 1);
    setFadeLeft(el.scrollLeft > 1);
    setFadeRight(el.scrollLeft < max - 1);
  }, []);

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
      // Every non-navigation pin now opens a panel, scenes and shortcuts
      // included — none of them latch as somewhere you are, only as something
      // that is open.
      case 'accessory':
      case 'serviceGroup':
      case 'action':
      case 'scene': return openKey === pinKey(tab);
    }
  };

  const activeKey = pinnedTabs.find(isActive) ? pinKey(pinnedTabs.find(isActive)!) : null;

  // Layout effect, not an effect: the fade must be right on the first paint,
  // or the bar flashes an end-cap it is about to remove.
  useLayoutEffect(() => { measureScroll(); });

  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const measure = () => setBarHeight(el.getBoundingClientRect().height);
    measure();
    // Its height changes with the shape, with the safe area, and with a name
    // that wraps to a second line.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.addEventListener('scroll', measureScroll, { passive: true });
    window.addEventListener('resize', measureScroll);
    // The row's own width changes when a pin is renamed or its icon swapped,
    // neither of which is a scroll or a resize.
    const observer = new ResizeObserver(measureScroll);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measureScroll);
      window.removeEventListener('resize', measureScroll);
      observer.disconnect();
    };
  }, [measureScroll]);

  const itemIds = pinnedTabs.map(pinKey);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(String(active.id));
    const newIndex = itemIds.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;
    onReorder?.(arrayMove(pinnedTabs, oldIndex, newIndex));
  }, [itemIds, pinnedTabs, onReorder]);

  if (pinnedTabs.length === 0) return null;

  const getIcon = (tab: PinnedTab): LucideIcon =>
    tabIconComponent(tab.customIcon) ?? derivedIcon(tab);

  /** What the tab wears with no override — and the reset target in the editor. */
  const derivedIcon = (tab: PinnedTab): LucideIcon => {
    switch (tab.type) {
      case 'home': return House;
      case 'room': return getRoomIcon(tab.name);
      case 'collection': return Folder;
      case 'collectionGroup': return Layers;
      case 'scene': return Zap;
      // Keyed, not derived: the tab has to draw itself before the home's
      // accessories have loaded, and deriving would leave it blank until then.
      case 'action': return HOME_ACTION_TAB_ICONS[tab.id as HomeActionId] ?? Zap;
      // Remembered, not just derived.
      //
      // `getAccessoryIcon` answers CircleDot for an accessory it cannot see,
      // and switching home empties the list for a moment while the new one
      // loads — so a pinned accessory blinked into a plain circle and back
      // every time you changed home. Its glyph has not changed; the data
      // describing it went away and came back.
      //
      // Same reasoning as HOME_ACTION_TAB_ICONS being keyed rather than
      // derived: a tab has to draw itself before the home's accessories have
      // arrived, and deriving alone leaves it wrong until they do.
      case 'accessory': {
        const accessory = resolveAccessory(tab);
        const key = pinKey(tab);
        if (accessory) {
          const icon = getAccessoryIcon(accessory);
          iconMemoRef.current.set(key, icon);
          return icon;
        }
        return iconMemoRef.current.get(key) ?? getAccessoryIcon(undefined);
      }
      case 'serviceGroup': return Layers;
    }
  };

  /**
   * The shape actually drawn. Arranging overrides the setting: it needs every
   * name legible and every chip on screen at once, which is what compact is.
   */
  const shape: TabBarMode = editMode ? 'compact' : mode;
  /** Only `regular` may be wider than the bar; the others are sized to fit. */
  const scrolls = tabBarScrolls(shape);

  /**
   * Put the tab you pressed in the middle of the bar.
   *
   * Driven by the press rather than by whatever became active, which is the
   * only version that behaves: keyed off "active" it also fired when a panel
   * closed and handed that state back to the page you were already on, so
   * shutting a panel slid the bar as though you had navigated somewhere.
   *
   * The panel opened by that same press travels with the chip — see
   * ExpandedOverlay, which repositions on a scroll that carries its trigger
   * instead of reading it as the page moving out from under it.
   */
  const centreTab = (key: string) => {
    // Compact never scrolls, so there is no middle to bring anything to.
    if (!scrolls) return;
    const el = scrollerRef.current;
    if (!el) return;
    const chip = [...el.querySelectorAll<HTMLElement>('[data-tab-key]')]
      .find(n => n.dataset.tabKey === key);
    if (!chip) return;
    const target = targetFor(el, key);
    cancelCentreRef.current();
    cancelCentreRef.current = animateScrollTo(el, target);
  };

  const handleTap = (tab: PinnedTab, status: PinnedTabStatus, centre = true) => {
    // While editing, a tap opens the tab's editor — name and icon. Navigating
    // away mid-edit would drop you into another room with the toolbar still up
    // and nothing explaining the move.
    if (editMode) {
      setEditingKey(pinKey(tab));
      return;
    }

    if (centre) centreTab(pinKey(tab));

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

  /**
   * Which tab a gesture at this x belongs to — the nearest one, never nothing.
   *
   * Hit testing the point was the obvious way and the wrong one. The lit tab is
   * the wide one, so every step along the bar re-lays the bar out underneath the
   * finger: the tab you just reached puts its label on, its neighbour takes one
   * off, the pill changes width and re-centres. Aim at the last tab and the end
   * of the bar arrives before your thumb does — the finger is off the end of
   * something that moved, the point hits nothing, and the swipe dies exactly
   * where it was going.
   *
   * So the bar keeps the gesture it started, and distance along x picks the tab.
   * One rule settles all three ways a point misses: the gap between two capsules
   * goes to the nearer of them, past either end goes to the tab at that end, and
   * y is not consulted at all — sliding up over the dashboard or down into the
   * home indicator holds the selection rather than dropping it.
   */
  const nearestKey = (bar: Element, x: number): string | null => {
    let nearest: string | null = null;
    let shortest = Infinity;
    for (const slot of bar.querySelectorAll<HTMLElement>('[data-tab-key]')) {
      const { left, right } = slot.getBoundingClientRect();
      const distance = x < left ? left - x : x > right ? x - right : 0;
      if (distance < shortest) {
        shortest = distance;
        nearest = slot.dataset.tabKey ?? null;
      }
      if (distance === 0) break; // Inside one; nothing can be nearer.
    }
    return nearest;
  };

  /**
   * Track a press across the bar and act on where it is released.
   *
   * Listens on the window rather than capturing the pointer: capture would
   * redirect the click to the element that took it, and the buttons still need
   * their own click for the keyboard path. Instead the release does the work
   * and flags the click that follows it as already spent.
   *
   * Once it has begun, the press always lands on a tab — there is no dragging
   * it off to think better of it. pointercancel is still the way out, and it is
   * the one the system uses.
   */
  const beginGesture = (e: React.PointerEvent) => {
    if (editMode) return; // dnd-kit owns the pointer while arranging.
    // Read now, synchronously: React clears currentTarget once dispatch ends,
    // and every listener below outlives this handler.
    const bar = e.currentTarget;
    const start = nearestKey(bar, e.clientX);
    if (!start) return; // Nothing pinned to aim at.
    setDragKey(start);

    /**
     * Collapsed, a swipe opens each pin as it reaches it rather than waiting
     * for the release. The bar is icons only then, so you cannot read your way
     * along it — you find what you want by watching the screen behind change.
     *
     * Never centred mid-swipe: centring moves the row, and moving the row under
     * a travelling finger changes which chip it is over. The centring happens
     * once, on release.
     */
    const openedRef = { current: null as string | null };
    const openLive = (key: string | null) => {
      if (shape !== 'icon' || !key || key === openedRef.current) return;
      openedRef.current = key;
      const tab = pinnedTabs.find(t => pinKey(t) === key);
      if (tab) handleTap(tab, resolveStatus(tab), false);
    };
    openLive(start);

    const move = (ev: PointerEvent) => {
      const key = nearestKey(bar, ev.clientX);
      setDragKey(key);
      openLive(key);
    };
    const done = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', done);
      setDragKey(null);
    };
    const up = (ev: PointerEvent) => {
      const end = nearestKey(bar, ev.clientX);
      done();
      if (!end) return; // The last pin was removed mid-press.
      suppressClickRef.current = true;
      // Already open, if the swipe opened it on the way: tapping again would
      // toggle a panel shut. All that is left is to bring it to the middle.
      if (openedRef.current === end) { centreTab(end); return; }
      const tab = pinnedTabs.find(t => pinKey(t) === end);
      if (tab) handleTap(tab, resolveStatus(tab));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', done);
  };

  /**
   * The fill follows the finger: it is what letting go would commit to.
   *
   * An open panel outranks the page you are on. `activeKey` is the FIRST tab
   * that reads as active, and a pinned room you are looking at reads as active
   * the whole time — so opening a scene's card lit nothing, because the room
   * was found first and kept the fill. Whatever is open is the thing you are
   * doing; the room is only where you happen to be standing.
   */
  const litKey = dragKey ?? (!editMode && openKey) ?? activeKey;

  /**
   * Which chips show their name.
   *
   * Everything, unless the setting says otherwise — and then only the one that
   * is current, so the bar still says where you are. Arranging always shows
   * them all: you cannot reorder or rename what you cannot read.
   *
   * Mid-slide the lit chip's name comes off too. A capsule that grows its name
   * under a thumb has put that name in the one place on screen it cannot be
   * read, and moved the rest of the bar sideways to do it. The callout above
   * takes over the naming instead — one shrink at the point you leave, rather
   * than a reflow at every chip you cross.
   */
  const namedKey = shape !== 'icon'
    ? 'all' as const
    // Nothing at all while a finger is down. Swiping opens each pin as it
    // reaches it, so the chip under the thumb IS the active one — and naming it
    // would grow it under the thumb and shift the rest of the row sideways,
    // which is the reflow the callout exists to avoid.
    //
    // Otherwise: whatever wears the fill wears the name. Keyed off `activeKey`
    // these two disagreed — a pinned page you are still on stays active, so its
    // chip kept its name open while the panel you had just opened took the fill
    // and stayed nameless. Two chips claiming to be the current one.
    : (dragKey !== null ? null : litKey);

  /** What the callout says: the tab a release would land on. */
  const aimedAt = shape === 'icon' && dragKey
    ? pinnedTabs.find(t => pinKey(t) === dragKey)
    : undefined;
  const AimedIcon = aimedAt ? getIcon(aimedAt) : undefined;

  const tabs = pinnedTabs.map((tab) => {
    const key = pinKey(tab);
    const status = resolveStatus(tab);
    const Icon = getIcon(tab);
    const active = isActive(tab);
    const running = runningKey === key;
    const isOpen = openKey === key && !editMode;
    const missing = status === 'missing';
    // The fill is the only thing that moves with a finger now; every chip
    // carries its own name the whole time.
    const lit = litKey === key;
    const label = tab.customName || tab.name;
    const named = namedKey === 'all' || namedKey === key;
    /**
     * `basis-0` in both flexible cases: a slot sized from the free space it is
     * given rather than from what is in it. Content-sized, a long name took
     * more of the row than a short one — and in icons, more of it than there
     * was.
     */
    const slotClass = shape === 'compact'
      // An equal share each, capped so two pins do not become two huge tabs.
      ? 'min-w-0 flex-1 basis-0 max-w-16'
      : shape === 'icon' && named
        // Whatever is left after the glyph-only ones, and not a pixel more.
        ? 'min-w-0 flex-1 basis-0'
        // Regular holds every name in full; the row scrolls to suit.
        : 'shrink-0';

    return (
      <TabSlot key={key} id={key} sortable={editMode} className={slotClass}>
        {(dragProps) => (<>
        <button
          {...dragProps}
          data-tab-key={key}
          // The release does the work (see beginGesture); this is the keyboard
          // path, and the flag stops a committed press from firing twice.
          onClick={() => {
            if (suppressClickRef.current) { suppressClickRef.current = false; return; }
            handleTap(tab, status);
          }}
          aria-current={active ? 'true' : undefined}
          aria-disabled={missing || undefined}
          // Icon-only tabs still have to say what they are.
          aria-label={label}
          title={editMode ? undefined : label}
          className={cn(
            'transition-[background-color,color,width] duration-base ease-standard',
            // Fills its slot; the slot is what divides the row.
            'w-full min-w-0',
            shape === 'compact'
              // The name under the icon, on two reserved lines so every bubble
              // is the same height — sized to their own labels, a one-line name
              // made a visibly shorter tab than a two-line one beside it.
              ? 'flex flex-col items-center gap-0.5 rounded-2xl px-1 py-1.5'
              : cn(
                  'flex flex-row items-center rounded-full py-2',
                  named ? 'gap-1.5 pl-2.5 pr-3.5' : 'gap-0 px-2.5',
                ),
            lit && 'bg-primary text-primary-foreground',
            // The bar's glass follows the wallpaper — white over a light one,
            // black over a dark one — so the text on it has to as well. An
            // unlit chip carried no colour at all and inherited the page's,
            // which is black, and vanished into the dark bar.
            !lit && cn(
              'active:bg-white/10',
              isDarkBackground ? 'text-white/85' : 'text-foreground/80',
            ),
            missing && !editMode && 'opacity-50',
          )}
        >
          {/* The icon stays put and the ring goes round it, rather than the
              spinner replacing it. Swapping it out cost the one thing the row
              is for: with five pins running you could not tell which tab was
              the one you pressed. Same ring the tiles and the Actions cards
              use, so "still working" reads the same everywhere.

              Driven by `running` rather than a registry key: a pin can be a
              scene or a room, and only actions have writes to track. */}
          <PendingRing
            pending={running}
            outset
            // Inherits the chip's colour rather than working it out again:
            // they were computed from different rules and drifted apart, which
            // is how the label ended up black on a dark bar while the glyph
            // beside it stayed white.
            className="h-5 w-5 shrink-0"
          >
            <Icon className="h-5 w-5 shrink-0" />
          </PendingRing>
          {shape === 'compact' ? (
            // Two lines, then ellipsis. A long room name truncated to "Livin…"
            // on one line is a worse tab than one wrapped over two, and while
            // arranging every name is on show at once. No colour of its own:
            // it takes the chip's, so the two bars read the same.
            // `px-1` on the name and not on the tab: it narrows the text
            // without narrowing the bubble behind it. Given the tab's full
            // width the last line ran right to the edge of its own background
            // — and with the clamp's ellipsis on the end of it, slightly past.
            // Two characters' worth of margin at this size.
            <span className="h-[23px] w-full px-2 text-[10px] font-medium leading-tight text-center break-words line-clamp-2">
              {label}
            </span>
          ) : (
            /* Collapsed to nothing rather than unmounted: animating a width is
               what makes the capsule look like it grew the name, and an element
               that is not there has no width to animate from. */
            <span
              aria-hidden
              className={cn(
                'overflow-hidden whitespace-nowrap text-[12.5px] font-semibold leading-none',
                'transition-[max-width,opacity] duration-base ease-standard',
                named ? 'max-w-[220px] opacity-100' : 'max-w-0 opacity-0',
                // `min-w-0` because a flex item will not shrink below its own
                // content without it, whatever the ellipsis says.
                shape === 'icon' && 'min-w-0 text-ellipsis',
              )}
            >
              {label}
            </span>
          )}
        </button>

        {editMode && onUnpin && (
          <EditBadge
            kind="remove"
            size="sm"
            label={`Unpin ${tab.customName || tab.name}`}
            onClick={() => {
              // Unpinning the tab whose editor is open would leave the
              // dialog pointing at something that no longer exists.
              if (editingKey === key) setEditingKey(null);
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
            bottomInset={barHeight + PANEL_GAP}
            // The chip is on its way to the middle, so the panel starts there
            // rather than setting off from wherever the chip happens to be and
            // chasing it across.
            centred
            // Below the bar's own 10001. That comparison only means anything
            // because the bar is portalled to the body as well — see the render.
            zIndex={9990}
          >
            {renderControl(tab)}
          </ExpandedOverlay>
        )}
        </>)}
      </TabSlot>
    );
  });

  const row = (
    <div
      ref={scrollerRef}
      // The scroller sits INSIDE the glass rather than being it, so the fade
      // below can mask the tabs at the ends without eating the bar's own
      // rounded background along with them.
      //
      // `touch-action` is the whole arbitration between the two gestures that
      // want this axis. While the row overflows, a horizontal drag belongs to
      // the browser as a pan: it takes the pointer, we get a pointercancel, and
      // `beginGesture` abandons the selection it had started — so a swipe
      // scrolls and only a tap picks. While it all fits there is nothing to
      // pan, so the axis goes back to slide-to-select.
      data-tab-row
      className={cn(
        'flex min-w-0 max-w-full gap-1 scrollbar-hidden',
        shape === 'compact' ? 'items-start' : 'items-center',
        // Only `regular` may outgrow the bar. The other two are sized to fit,
        // so there is nothing to scroll and nothing to fade — a name too long
        // for the room it has left truncates inside its own chip rather than
        // pushing the row wider than the phone.
        scrolls
          ? cn(
              'overflow-x-auto',
              scrollable ? 'touch-pan-x' : 'touch-none',
              fadeLeft && fadeRight && 'tab-fade-both',
              fadeLeft && !fadeRight && 'tab-fade-left',
              !fadeLeft && fadeRight && 'tab-fade-right',
            )
          : 'overflow-hidden touch-none',
      )}
    >
      {tabs}
    </div>
  );

  const pill = (
    <div
      // The whole bar takes the press, not each tab: a finger that starts on
      // one tab and ends on another crosses the gaps between them, and a
      // handler per button would lose the gesture in those gaps.
      onPointerDown={editMode ? undefined : beginGesture}
      className={cn(
        // `min-w-0` on the bar itself as well as on the tab that gives: a flex
        // item's automatic minimum size is its content, and that beats
        // `max-width` — so without it the bar simply refused to come down to
        // the width it had been told it could have.
        'pointer-events-auto flex gap-1 min-w-0 overflow-hidden transition-colors duration-300',
        shape === 'compact'
          // Stacked tabs make a taller row, where a full stadium reads as a
          // lozenge — but it keeps the real bar's roundness as far as it can.
          ? 'items-start rounded-3xl px-2 py-1.5'
          // A row of capsules wants a capsule around it.
          : 'items-center rounded-full p-1.5',
        isDarkBackground ? 'material-regular-dark' : 'material-regular',
      )}
      style={{ maxWidth: 'calc(100% - 32px)' }}
    >
      {row}
    </div>
  );

  const editingTab = editingKey ? pinnedTabs.find(t => pinKey(t) === editingKey) : undefined;

  /*
   * Portalled to the body, and that is what makes the chip float over the blur.
   *
   * The bar is `fixed z-[10001]` and the panel's scrim is 9990, so the bar
   * should simply win — but z-index only compares within a stacking context,
   * and rendered in place the bar sits inside the dashboard's while the scrim,
   * being portalled, sits in the body's. The two numbers were never being
   * compared at all, which is why lowering the scrim under the bar changed
   * nothing. Same parent, same context, and 10001 beats 9990.
   *
   * Two approaches were tried and abandoned before this. `clip-path` cuts a
   * hole in a scrim's paint but not in its `backdrop-filter`, so the chip
   * stayed blurred inside its own cut-out. Stopping the scrim short of the
   * bottom of the screen did work, but left a clear band the full width of the
   * phone rather than a floating pill.
   *
   * The bar is `position: fixed` already, so moving it in the tree costs no
   * layout, and portals carry React context so everything it reads still works.
   */
  return createPortal(
    <div ref={barRef} className="fixed bottom-0 left-0 right-0 z-[10001] pointer-events-none safe-area-bottom safe-area-x">
      {editingTab && (
        <TabEditSheet
          open
          onOpenChange={(next) => { if (!next) setEditingKey(null); }}
          derivedName={editingTab.name}
          DerivedIcon={derivedIcon(editingTab)}
          customName={editingTab.customName}
          customIcon={editingTab.customIcon}
          onSave={(next) => onRename?.(editingTab, next)}
        />
      )}
      {/* The name of the tab a release would land on, while the chips are
          collapsed and a finger is travelling. Above the bar because that is
          the one place a thumb is not covering.

          aria-hidden, like the chips' own labels: every tab is a button that
          already says its name, and a live readout of a gesture in progress is
          something to announce to a pointer, not to a screen reader. */}
      {aimedAt && (
        <div className="flex justify-center px-4 pb-2">
          <div
            aria-hidden
            data-testid="tab-callout"
            className={cn(
              'flex max-w-full items-center gap-2 rounded-full px-3 py-1.5',
              // The same glass as the bar below it, so the two read as one
              // control rather than a tooltip that happened to land there.
              isDarkBackground ? 'material-regular-dark text-white' : 'material-regular text-foreground',
            )}
          >
            {AimedIcon && <AimedIcon className="h-4 w-4 shrink-0" />}
            <span className="min-w-0 truncate text-[13px] font-semibold leading-none">
              {aimedAt.customName || aimedAt.name}
            </span>
          </div>
        </div>
      )}
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
    </div>,
    document.body,
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
function TabSlot({ id, sortable, className, children }: {
  id: string;
  /** False outside edit mode, and while this tab's label is being typed into. */
  sortable: boolean;
  /**
   * How this tab divides the row.
   *
   * On the slot, not on the button inside it. The row's flex items are these
   * wrappers, so flex sizing on the button reached nothing at all: the slot
   * stayed content-sized and every rule about equal shares or taking only the
   * leftover space was quietly inert. It is why compact tabs came out uneven
   * and why a long name in icons still pushed the glyphs off the bar.
   */
  className?: string;
  children: (dragProps: Record<string, unknown>) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled: !sortable,
  });

  if (!sortable) return <div data-tab-slot className={cn('relative', className)}>{children({})}</div>;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      data-tab-slot
      className={cn('relative touch-none', className)}
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
