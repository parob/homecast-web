import { Fragment, useMemo, useState } from 'react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import {
  Blinds, ChevronRight, Fan, Lightbulb, Loader2, Lock, Plug, Play, Power, Shield, Thermometer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ActionConfirmDialog } from './ActionConfirmDialog';
import { TileEditActions } from '@/components/shared/EditActions';
import { useLayoutEdit } from '@/contexts/LayoutEditContext';
import { getIconColor } from '@/components/widgets/iconColors';
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

export function ActionsSection({ accessories, homeLayout, homeId, compact, isDarkBackground, open, isViewOnly, onRunAction }: {
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
}) {
  const actions = useVisibleActions(accessories, homeLayout);
  const { editMode } = useLayoutEdit();
  const [runningId, setRunningId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [confirming, setConfirming] = useState<HomeAction | null>(null);

  const run = async (action: HomeAction) => {
    setRunningId(action.id);
    setProgress({ done: 0, total: action.targetCount });
    try {
      await onRunAction(action, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
    } finally {
      setRunningId(null);
      setProgress(null);
    }
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
              ? 'grid items-start gap-2 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]'
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
              const inert = action.disabled || !!isViewOnly || running || editMode;

              const card = (
                <div
                  role="button"
                  tabIndex={inert ? -1 : 0}
                  aria-disabled={inert}
                  onClick={() => { if (!inert) press(action); }}
                  onKeyDown={(e) => {
                    if (inert) return;
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); press(action); }
                  }}
                  className={cn(
                    'relative rounded-2xl h-fit transition-all duration-300 ring-1 ring-inset',
                    isDarkBackground ? 'ring-transparent' : 'ring-slate-200',
                    inert ? 'opacity-50 cursor-default' : 'cursor-pointer',
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
                        {running ? action.runningLabel : action.label}
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
                    {/* Decorative: the whole card is the button, since an
                        action has nothing to open or edit. */}
                    <span className={cn('shrink-0 rounded-lg p-1.5', isDarkBackground ? 'text-white/70' : 'text-muted-foreground')}>
                      {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </span>
                  </div>
                </div>
              );

              // Pinning is an Edit Layout job now, so the tile carries a button
              // rather than hiding one in a long-press menu nothing else used.
              // The stored name comes from HOME_ACTION_NAMES, never action.label
              // — the label flips with live device state, so a pin made while the
              // lights were on would read "Turn all lights on".
              if (!editMode || !homeId) return <Fragment key={action.id}>{card}</Fragment>;
              return (
                <div key={action.id} className="relative">
                  {card}
                  <TileEditActions
                    action={null}
                    tab={{ type: 'action', id: action.id, name: HOME_ACTION_NAMES[action.id], homeId }}
                  />
                </div>
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
