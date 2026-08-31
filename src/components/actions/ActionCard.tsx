import { useEffect, useState } from 'react';
import { Loader2, Play, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import { actionKey } from '@/lib/pending-writes';
import { PendingRing } from '@/components/widgets/shared/PendingRing';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { PinTabMenuItem } from '@/components/shared/PinTabMenuItem';
import { TileEditActions, HiddenLabel } from '@/components/shared/EditActions';
import { type HomeActionId } from '@/lib/summary-sections';
import { getIconColor } from '@/components/widgets/iconColors';
import { TriStateToggle } from '@/components/ui/tri-state-toggle';
import { HOME_ACTION_NAMES, type HomeAction } from './catalog';
import { ACTION_ICONS } from './icons';

/**
 * One shortcut card in the Scenes section.
 *
 * Extracted from ActionsSection when Scenes and Actions merged. The markup and
 * every comment on it are unchanged — see SceneCard, which was brought to these
 * measurements so the two read as one grid.
 */
export function ActionCard({
  action, homeId, isDarkBackground, isViewOnly, editMode, touchMode,
  running, progress, runningTextOf, onPress, onRun, isHidden, onToggleHidden,
  renderPanel,
}: {
  action: HomeAction;
  homeId?: string | null;
  isDarkBackground?: boolean;
  isViewOnly?: boolean;
  editMode: boolean;
  touchMode: boolean;
  running: boolean;
  progress: { done: number; total: number } | null;
  runningTextOf: (action: HomeAction) => string;
  onPress: (action: HomeAction) => void;
  onRun: (action: HomeAction, direction?: boolean) => void;
  /**
   * Hidden, and being shown anyway — Edit Layout on touch, Show Hidden Items on
   * a desktop. A hidden card that is not being revealed is never rendered at
   * all, so this is only ever true where there is a way to bring it back.
   */
  isHidden?: boolean;
  /** Flips this shortcut's visibility. Bound to the id by the caller. */
  onToggleHidden?: () => void;
  /**
   * The panel this card opens into, if it has one.
   *
   * A render prop rather than a node so the panel — a whole ServiceGroupWidget
   * over every member — is not built for every card on every render of the
   * grid, only for the one that is actually open. Absent ⇒ the card does not
   * expand, which is the case for every one-way shortcut.
   */
  renderPanel?: () => React.ReactNode;
}) {
  const Icon = ACTION_ICONS[action.icon];
  const colors = getIconColor(action.serviceType);
  // Nothing left to do, or no permission to do it. Either way the
  // card stays in place so the row doesn't reflow under the press.
  // Editing joins the existing reasons a card must not fire: an
  // action runs the moment you touch it, and a mis-grab on the way
  // to a drag would turn the whole house off.
  // `running` bars a one-way action, which has no way to express
  // "actually, stop" — pressing Lock up twice is just two runs. A
  // two-way one stays live: its press means something new.
  const inert = action.disabled || !!isViewOnly || editMode
    || (running && !action.toggle);
  // A two-way action carries its own control, and the card must then
  // stop being one: leaving the press on the card too would run the
  // catalog's chosen direction from anywhere outside the toggle,
  // which is the guess the toggle exists to stop making.
  const toggle = editMode ? undefined : action.toggle;
  // A revealed card carries `data-hidden-item` as well as this dimming (below),
  // which is what fades it out when the reveal ends — see index.css.
  const dimClass = isHidden ? 'opacity-40' : (inert ? 'opacity-50' : '');

  const [panelOpen, setPanelOpen] = useState(false);
  /**
   * The body opens the panel, and only on a two-way card.
   *
   * There is no conflict to resolve: on a card carrying a toggle the body is
   * already inert — the toggle owns the press and the body deliberately does
   * nothing, so that a click landing anywhere else cannot run the catalog's
   * chosen direction. Giving that dead area the panel takes no behaviour away.
   *
   * A one-way card is left exactly as it was: its body IS the button, and a
   * press has to keep running the action.
   *
   * `inert` covers the rest — editing (a mis-grab on the way to a drag must not
   * open anything), view-only, and a disabled card.
   */
  const canExpand = !!renderPanel && !!toggle && !inert;
  const openPanel = () => setPanelOpen(true);
  // Entering Edit Layout under an open panel takes the panel away; leaving must
  // not bring it back. Without this the flag survives the mode and the panel
  // reappeared on its own the moment editing ended.
  useEffect(() => { if (!canExpand) setPanelOpen(false); }, [canExpand]);

  const card = (
    <div
      data-testid={`action-${action.id}`}
      role={toggle ? (canExpand ? 'button' : undefined) : 'button'}
      tabIndex={toggle ? (canExpand ? 0 : undefined) : (inert ? -1 : 0)}
      aria-disabled={toggle ? undefined : inert}
      // Named for what the press does, not for the card — the label beside it
      // already says "All lights", and a button announced as "All lights" twice
      // says nothing about where it goes.
      aria-label={toggle && canExpand ? `${HOME_ACTION_NAMES[action.id]} controls` : undefined}
      aria-expanded={toggle && canExpand ? panelOpen : undefined}
      onClick={toggle
        ? (canExpand ? openPanel : undefined)
        : () => { if (!inert) onPress(action); }}
      onKeyDown={toggle
        ? (canExpand ? (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPanel(); }
          } : undefined)
        : (e) => {
            if (inert) return;
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress(action); }
          }}
      className={cn(
        'relative rounded-2xl h-fit transition-all duration-300 ring-1 ring-inset',
        isDarkBackground ? 'ring-transparent' : 'ring-slate-200',
        // One class, not two conditions: a revealed hidden card that is also
        // inert would otherwise carry `opacity-40` and `opacity-50` at once.
        // Hidden wins — it is the fact the badge is offering to change, and an
        // inert card that is also hidden still just reads as hidden.
        dimClass,
        toggle
          ? (canExpand ? 'cursor-pointer' : 'cursor-default')
          : (inert ? 'cursor-default' : 'cursor-pointer'),
      )}
      {...(isHidden ? { 'data-hidden-item': 'true' } : {})}
      style={{ contain: 'layout style paint' }}
      // The arithmetic the subtitle no longer carries. Native title rather than
      // a Radix tooltip: this card is a press target on touch, and Radix closes
      // on pointerdown, so a tooltip here would fight the thing it sits on.
      title={action.detail}
    >
      {/* Blur layer — matches WidgetWrapper */}
      <div className={cn(
        'absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 transform-gpu',
        isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80',
      )} />
      {/* Everything on this row is a little smaller than a tile's,
          to buy the name room. On the compact grid a 180px card
          spends ~115px on chrome — a 32px chip, the toggle, gaps and
          padding — leaving the name about 65px, which "All switches
          & outlets" wrapped into two lines and then clipped. A 24px
          chip, tighter padding and 13px type give back enough that
          most names fit, and the ones that do not now trail off on
          one line rather than losing their second. */}
      <div className="relative z-[1] flex items-center gap-2 p-2.5">
        {/* The ring rides this chip's rim while the action's
            writes are still travelling. It is the only thing on a
            two-way card that moves: the toggle's thumb follows the
            catalog, which follows the accessories, which do not
            change until the relay confirms. */}
        <PendingRing pendingKey={actionKey(action.id)} className={cn('h-6 w-6', colors.text)}>
          <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm', colors.bg, colors.text)}>
            <Icon className="h-3 w-3" />
          </div>
        </PendingRing>
        <div className="min-w-0 flex-1">
          <p
            title={action.label}
            className={cn('text-[13px] font-medium leading-tight truncate transition-colors duration-300', isDarkBackground && 'text-white')}
          >
            {action.label}
          </p>
          {/* While it runs the subtitle carries what is happening
              instead of the state: the state it describes is
              mid-change and about to be wrong. The count rides
              along because it is the only thing that distinguishes
              a slow action from a stuck one — a wedged accessory
              holds its write for the native 10s timeout, and a bare
              verb gives no way to tell that apart from nothing
              happening. aria-live so it is announced, not just
              seen. */}
          <p
            aria-live={running ? 'polite' : undefined}
            className={cn('text-[10px] truncate transition-colors duration-300', isDarkBackground ? 'text-white/60' : 'text-muted-foreground/60')}
          >
            {running
              ? `${runningTextOf(action)}${progress ? ` · ${progress.done} of ${progress.total}` : ''}`
              : action.subtitle}
          </p>
        </div>
        {toggle ? (
          // No spinner swap here, and the thumb does NOT move on
          // its own — a two-way action always supplies an
          // AbortSignal, which skips the optimistic pass, so
          // nothing moves until the relay confirms. That is why the
          // icon chip above carries a PendingRing: without it a
          // press of All lights showed no thumb, no spinner and no
          // ring for as long as the slowest accessory took.
          // `flex items-center`, not a bare span: blockified as a flex item it
          // still builds a line box around the toggle, and the leading under
          // the button pushed it visibly above the row's centre line.
          <span className="shrink-0 flex items-center" onClick={(e) => e.stopPropagation()}>
            <TriStateToggle
              state={toggle.state}
              wide
              onCheckedChange={(next) => { if (!inert) onRun(action, next); }}
              disabled={inert}
              // No description: the subtitle beside it already
              // reads "1 of 2 on", and an sr-only copy would say
              // the same thing twice to the only people who cannot
              // see it is already there.
              label={HOME_ACTION_NAMES[action.id]}
              checkedColorClass={colors.switchBg}
            />
          </span>
        ) : (
          /* Decorative: the whole card is the button, since a
             one-way action has nothing to open or edit. */
          <span className={cn('shrink-0 flex items-center rounded-lg p-1.5', isDarkBackground ? 'text-white/70' : 'text-muted-foreground')}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </span>
        )}
      </div>
    </div>
  );

  // Editing: the same two buttons a tile carries. Hiding an action is
  // the only "get rid of this" there is — they are derived from what
  // the home contains, not authored, so there is nothing to delete.
  // The pinned name comes from HOME_ACTION_NAMES, never action.label:
  // a one-way action's label flips with live device state, so a pin
  // made while the doors were open would read "Lock up" for ever, and
  // a two-way one's names the set rather than the press.
  // The wrapper is unconditional and only the badges are behind `editMode` —
  // the mode now flips mid-drag, and swapping element trees at that moment
  // would remount the card dnd-kit is tracking. See SceneCard.
  const editable = (
    <div className="relative">
      {card}
      {/* Not gated on `editMode`: a desktop reveals hidden cards through Show
          Hidden Items without ever entering edit mode, and a dimmed card with
          nothing saying why is just a mysterious one. */}
      {isHidden && <HiddenLabel />}
      {/* Gated by `visible` so it can animate away — see SceneCard. The props
          are only meaningful when there is a home to hide it from, so they are
          built defensively rather than under the render condition. */}
      <TileEditActions
        visible={!!(editMode && homeId && onToggleHidden)}
        action={homeId && onToggleHidden
          ? { kind: 'hide', isHidden: !!isHidden, onToggle: onToggleHidden, name: HOME_ACTION_NAMES[action.id] }
          : null}
        tab={homeId
          ? { type: 'action', id: action.id, name: HOME_ACTION_NAMES[action.id], homeId }
          : null}
      />
      {/* Anchored to this wrapper — ExpandedOverlay places itself against its
          own DOM parent, which is why it lives here beside the card rather than
          up in the section. Rendered only while open: `renderPanel` builds a
          widget over every member of the home, and building one per card per
          render of the grid is not free at 130 lights. */}
      {canExpand && panelOpen && (
        <ExpandedOverlay
          isExpanded={panelOpen}
          onClose={() => setPanelOpen(false)}
          onMouseLeave={() => setPanelOpen(false)}
          // Same width the group tile's own panel uses: two control bars side
          // by side plus a two-column member grid need the room.
          width={360}
        >
          {renderPanel()}
        </ExpandedOverlay>
      )}
    </div>
  );
  if (editMode) return editable;

  // Desktop has no edit mode, so hiding lives where every other desktop hide
  // does — the right-click menu. On touch there is no menu at all now: a long
  // press lifts the card into Edit Layout, which is where hiding and pinning
  // both live.
  const canHideHere = !touchMode && !!homeId && !!onToggleHidden;
  if (touchMode || (!canHideHere && !homeId)) return editable;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{editable}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
          {HOME_ACTION_NAMES[action.id]}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {/* The stored name is HOME_ACTION_NAMES, never action.label:
            the label flips with live device state, so a pin made
            while the lights were on would read "Turn all lights on"
            for ever. */}
        <PinTabMenuItem
          tab={{ type: 'action', id: action.id, name: HOME_ACTION_NAMES[action.id], homeId: homeId! }}
        />
        {/* Both directions, because a desktop has no Edit Layout to hide or
            unhide from. Unhide is reachable because Show Hidden Items puts the
            card back on screen to be right-clicked. */}
        {canHideHere && (
          <ContextMenuItem onClick={onToggleHidden}>
            {isHidden ? <Eye className="mr-2 h-4 w-4" /> : <EyeOff className="mr-2 h-4 w-4" />}
            {isHidden ? 'Unhide Scene' : 'Hide Scene'}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
