import { Fragment, useMemo, useRef, useState } from 'react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import {
  Blinds, ChevronRight, Fan, Lightbulb, Loader2, Lock, Plug, Play, Power, Shield, Thermometer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionConfirmDialog } from './ActionConfirmDialog';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { EyeOff } from 'lucide-react';
import { TileEditActions } from '@/components/shared/EditActions';
import { useLayoutEdit } from '@/contexts/LayoutEditContext';
import { type HomeActionId } from '@/lib/summary-sections';
import { getIconColor } from '@/components/widgets/iconColors';
import { TriStateToggle } from '@/components/ui/tri-state-toggle';
import { isHomeActionVisible } from '@/lib/summary-sections';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { deriveHomeActions, HOME_ACTION_NAMES, type HomeAction } from './catalog';
import type { RunHomeActionOverrides } from './useRunHomeAction';
import { ACTION_ICONS } from './icons';


function useVisibleActions(accessories: HomeKitAccessory[], homeLayout: HomeLayoutData | null | undefined) {
  return useMemo(
    () => deriveHomeActions(accessories).filter(a => isHomeActionVisible(homeLayout, a.id)),
    [accessories, homeLayout],
  );
}

/**
 * Compact bubble button for the summary row. Toggles the ActionsSection
 * content rendered elsewhere on the page.
 *
 * Unlike the Scenes and Automations pills this fetches nothing — the catalog
 * is a pure function of the accessories already on screen, so it can never
 * flash or lag behind them.
 */
export function ActionsPill({ accessories, homeLayout, open, onToggle, isDarkBackground, hideAccessoryCounts }: {
  accessories: HomeKitAccessory[];
  homeLayout: HomeLayoutData | null | undefined;
  open: boolean;
  onToggle: () => void;
  isDarkBackground?: boolean;
  /** The "Show counts" display setting, inverted. Same toggle the sidebar obeys. */
  hideAccessoryCounts?: boolean;
}) {
  const actions = useVisibleActions(accessories, homeLayout);

  // Nothing to create here, so unlike Scenes there is nothing to strand by
  // hiding at zero — a home of sensors simply has no Actions.
  if (actions.length === 0) return null;

  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors',
        isDarkBackground
          ? (open ? 'bg-white/25 text-white' : 'bg-black/25 text-white/90 hover:bg-black/35')
          : (open ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground hover:bg-muted/80'),
      )}
    >
      <span>Actions{!hideAccessoryCounts ? ` ${actions.length}` : ''}</span>
      <ChevronRight className={cn('h-3 w-3 transition-transform', open && 'rotate-90')} />
    </button>
  );
}

export function ActionsSection({ accessories, homeLayout, homeId, compact, isDarkBackground, open, isViewOnly, onRunAction, onHideAction }: {
  accessories: HomeKitAccessory[];
  homeLayout: HomeLayoutData | null | undefined;
  /** Which home these actions belong to. Required to pin one — the catalog is
   *  derived per-home, so the id alone does not identify it. */
  homeId?: string | null;
  compact?: boolean;
  isDarkBackground?: boolean;
  /** Controlled expansion (pill in the summary row drives it). */
  open: boolean;
  isViewOnly?: boolean;
  onRunAction: (action: HomeAction, opts?: RunHomeActionOverrides) => Promise<void>;
  /**
   * Turn an action off for this home. Writes the same per-home `hiddenActions`
   * list Settings writes, so hiding one here unticks it there. Absent where
   * there is nothing to write to (a shared home, a view-only member).
   */
  onHideAction?: (id: HomeActionId) => void;
}) {
  const actions = useVisibleActions(accessories, homeLayout);
  const { editMode, touchMode } = useLayoutEdit();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState<HomeAction | null>(null);
  // Which way the run in flight is going, so it can be narrated. A two-way
  // action's own runningLabel follows the direction the *catalog* picked, which
  // is the opposite of what the user chose exactly when they overrode it.
  const [runningDirection, setRunningDirection] = useState<boolean | undefined>(undefined);

  /**
   * The run in flight, so the next press can call it off.
   *
   * A two-way action stays live while it works: half a house changing its mind
   * is exactly when you want the control back, and blocking the press until the
   * last bulb answers is how "I pressed it twice" happens. The replacement run
   * aborts this one, which drops every write still queued — and because an
   * interruptible run only moves accessories it has confirmed, the reversal is
   * computed from what actually changed rather than from what was intended.
   */
  const inFlight = useRef<AbortController | null>(null);

  const run = async (action: HomeAction, direction?: boolean) => {
    const total = direction === undefined || !action.toggle
      ? action.targetCount
      : (direction ? action.toggle.onSteps : action.toggle.offSteps).flatMap(s => s.writes).length;

    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    setRunningId(action.id);
    setRunningDirection(direction);
    setProgress({ done: 0, total });
    try {
      await onRunAction(action, {
        direction,
        signal: action.toggle ? controller.signal : undefined,
        onProgress: (done, t) => {
          // A superseded run keeps settling its issued writes; its counts are
          // no longer what the card is reporting on.
          if (inFlight.current === controller) setProgress({ done, total: t });
        },
      });
    } finally {
      // Only the current run owns the running state. An aborted one finishes
      // late, and clearing here would wipe its replacement's.
      if (inFlight.current === controller) {
        inFlight.current = null;
        setRunningId(null);
        setRunningDirection(undefined);
        setProgress(null);
      }
    }
  };

  /** What the card calls itself right now: the set, or the direction in flight. */
  const titleOf = (action: HomeAction, running: boolean) => {
    if (!running) return action.label;
    if (action.toggle && runningDirection !== undefined) {
      return runningDirection ? action.toggle.onRunning : action.toggle.offRunning;
    }
    return action.runningLabel;
  };

  const press = (action: HomeAction) => {
    if (action.confirm) setConfirming(action);
    else run(action);
  };

  return (
    <>
      <AnimatedCollapse open={open}>
        <div className={compact ? 'mb-3' : 'mb-6'}>
          <div className={
            compact
              ? 'grid items-start gap-2 grid-cols-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
              : 'grid items-start gap-3 grid-cols-[repeat(auto-fill,minmax(240px,1fr))]'
          }>
            {actions.map(action => {
              const Icon = ACTION_ICONS[action.icon];
              const colors = getIconColor(action.serviceType);
              const running = runningId === action.id;
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
                  onClick={toggle ? undefined : () => { if (!inert) press(action); }}
                  onKeyDown={toggle ? undefined : (e) => {
                    if (inert) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(action); }
                  }}
                  className={cn(
                    'relative rounded-2xl h-fit transition-all duration-300 ring-1 ring-inset',
                    isDarkBackground ? 'ring-transparent' : 'ring-slate-200',
                    inert && 'opacity-50',
                    toggle ? 'cursor-default' : (inert ? 'cursor-default' : 'cursor-pointer'),
                  )}
                  style={{ contain: 'layout style paint' }}
                >
                  {/* Blur layer — matches WidgetWrapper */}
                  <div className={cn(
                    'absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 transform-gpu',
                    isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80',
                  )} />
                  <div className="relative z-[1] flex items-center gap-2 p-3">
                    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-full shadow-sm', colors.bg, colors.text)}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn('text-sm font-medium break-words line-clamp-2 transition-colors duration-300', isDarkBackground && 'text-white')}>
                        {titleOf(action, running)}
                      </p>
                      {/* While it runs the subtitle carries progress instead of
                          state: the state it describes is mid-change and about
                          to be wrong, and a count is the only thing that
                          distinguishes a slow action from a stuck one.
                          aria-live so it is announced, not just seen. */}
                      <p
                        aria-live={running ? 'polite' : undefined}
                        className={cn('text-[11px] transition-colors duration-300', isDarkBackground ? 'text-white/60' : 'text-muted-foreground/60')}
                      >
                        {running && progress
                          ? `${progress.done} of ${progress.total} accessor${progress.total === 1 ? 'y' : 'ies'}`
                          : action.subtitle}
                      </p>
                    </div>
                    {toggle ? (
                      // No spinner swap: the run writes optimistically before it
                      // touches the network and the catalog re-derives from the
                      // accessories, so the thumb moves on its own. The subtitle
                      // above is already carrying the progress count.
                      <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
                        <TriStateToggle
                          state={toggle.state}
                          wide
                          onCheckedChange={(next) => { if (!inert) run(action, next); }}
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
                      <span className={cn('shrink-0 rounded-lg p-1.5', isDarkBackground ? 'text-white/70' : 'text-muted-foreground')}>
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
                  <div key={action.id} className="relative">
                    {card}
                    <TileEditActions
                      action={{ kind: 'remove', label: `Hide ${HOME_ACTION_NAMES[action.id]}`, onRemove: () => onHideAction(action.id) }}
                      tab={{ type: 'action', id: action.id, name: HOME_ACTION_NAMES[action.id], homeId }}
                    />
                  </div>
                );
              }

              // Desktop has no edit mode, so hiding lives where every other
              // desktop hide does: the right-click menu.
              if (touchMode || !homeId || !onHideAction) return <Fragment key={action.id}>{card}</Fragment>;
              return (
                <ContextMenu key={action.id}>
                  <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
                  <ContextMenuContent className="w-56">
                    <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
                      {HOME_ACTION_NAMES[action.id]}
                    </ContextMenuLabel>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onHideAction(action.id)}>
                      <EyeOff className="mr-2 h-4 w-4" />
                      Hide Action
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>
      </AnimatedCollapse>

      <ActionConfirmDialog
        action={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={(action) => { setConfirming(null); run(action); }}
      />
    </>
  );
}
