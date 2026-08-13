import { useMemo, useState } from 'react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import {
  Blinds, ChevronRight, Fan, Lightbulb, Loader2, Lock, Plug, Play, Power, Shield, Thermometer,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { getIconColor } from '@/components/widgets/iconColors';
import { isHomeActionVisible } from '@/lib/summary-sections';
import type { HomeLayoutData } from '@/hooks/useEntityLayout';
import type { HomeKitAccessory } from '@/native/homekit-bridge';
import { deriveHomeActions, type HomeAction, type HomeActionIcon } from './catalog';

/** Matches the choices in AccessoryPicker's SERVICE_TYPE_ICONS, so a chip looks like its widgets. */
const ACTION_ICONS: Record<HomeActionIcon, LucideIcon> = {
  lightbulb: Lightbulb,
  blinds: Blinds,
  lock: Lock,
  fan: Fan,
  outlet: Plug,
  thermostat: Thermometer,
  shield: Shield,
  power: Power,
};

const CONFIRM_DESCRIPTION_ID = 'home-action-confirm-description';

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

export function ActionsSection({ accessories, homeLayout, compact, isDarkBackground, open, isViewOnly, onRunAction }: {
  accessories: HomeKitAccessory[];
  homeLayout: HomeLayoutData | null | undefined;
  compact?: boolean;
  isDarkBackground?: boolean;
  /** Controlled expansion (pill in the summary row drives it). */
  open: boolean;
  isViewOnly?: boolean;
  onRunAction: (action: HomeAction) => Promise<void>;
}) {
  const actions = useVisibleActions(accessories, homeLayout);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<HomeAction | null>(null);

  const run = async (action: HomeAction) => {
    setRunningId(action.id);
    try {
      await onRunAction(action);
    } finally {
      setRunningId(null);
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
              const inert = action.disabled || !!isViewOnly || running;

              return (
                <div
                  key={action.id}
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
                        {action.label}
                      </p>
                      <p className={cn('text-[11px] transition-colors duration-300', isDarkBackground ? 'text-white/60' : 'text-muted-foreground/60')}>
                        {action.subtitle}
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
            })}
          </div>
        </div>
      </AnimatedCollapse>

      {/* Mounted only while there is something to confirm, so the content
          always carries a real title and description.

          `aria-describedby` is passed explicitly because the shared
          AlertDialogContent hard-codes it to `undefined` — shadcn's opt-out
          for dialogs that have no description, which also detaches the ones
          that do. Naming the id here reconnects it for this dialog without
          changing the behaviour of every other AlertDialog in the app. */}
      {confirming && (
        <AlertDialog open onOpenChange={(o) => { if (!o) setConfirming(null); }}>
          <AlertDialogContent aria-describedby={CONFIRM_DESCRIPTION_ID}>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirming.label}?</AlertDialogTitle>
              <AlertDialogDescription id={CONFIRM_DESCRIPTION_ID}>{confirming.confirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  const action = confirming;
                  setConfirming(null);
                  run(action);
                }}
              >
                {confirming.label}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
