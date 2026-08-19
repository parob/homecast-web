import { Fragment } from 'react';
import { Loader2, Play, EyeOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { actionKey } from '@/lib/pending-writes';
import { PendingRing } from '@/components/widgets/shared/PendingRing';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { PinTabMenuItem } from '@/components/shared/PinTabMenuItem';
import { TileEditActions } from '@/components/shared/EditActions';
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
  running, progress, runningTextOf, onPress, onRun, onHideAction,
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
  onHideAction?: (id: HomeActionId) => void;
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

  const card = (
    <div
      data-testid={`action-${action.id}`}
      role={toggle ? undefined : 'button'}
      tabIndex={toggle ? undefined : (inert ? -1 : 0)}
      aria-disabled={toggle ? undefined : inert}
      onClick={toggle ? undefined : () => { if (!inert) onPress(action); }}
      onKeyDown={toggle ? undefined : (e) => {
        if (inert) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPress(action); }
      }}
      className={cn(
        'relative rounded-2xl h-fit transition-all duration-300 ring-1 ring-inset',
        isDarkBackground ? 'ring-transparent' : 'ring-slate-200',
        inert && 'opacity-50',
        toggle ? 'cursor-default' : (inert ? 'cursor-default' : 'cursor-pointer'),
      )}
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
  if (editMode && homeId && onHideAction) {
    return (
      <div className="relative">
        {card}
        <TileEditActions
          action={{ kind: 'remove', label: `Hide ${HOME_ACTION_NAMES[action.id]}`, onRemove: () => onHideAction(action.id) }}
          tab={{ type: 'action', id: action.id, name: HOME_ACTION_NAMES[action.id], homeId }}
        />
      </div>
    );
  }

  // Two different menus in one, by platform. Desktop has no edit
  // mode, so hiding lives where every other desktop hide does — the
  // right-click menu. A phone hides from Edit Layout, but a long
  // press is still the quick way onto the tab bar.
  const canHideHere = !touchMode && !!homeId && !!onHideAction;
  if (!canHideHere && !homeId) return <Fragment>{card}</Fragment>;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
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
        {canHideHere && (
          <ContextMenuItem onClick={() => onHideAction!(action.id)}>
            <EyeOff className="mr-2 h-4 w-4" />
            Hide Scene
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
