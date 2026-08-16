// Unified automation card — used for both HomeKit and Homecast automations
// Identical style, differentiated only by a subtle outline icon

import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { Switch } from '@/components/ui/switch';
import { Trash2 } from 'lucide-react';
import { AutomationTriggerSummary } from './AutomationTriggerSummary';
import { SET_AUTOMATION_ENABLED } from '@/lib/graphql/mutations';
import { toast } from 'sonner';
import { ViewOnlyHomeDialog } from '@/components/shared/ViewOnlyHomeDialog';
import { useRelayCannotEdit } from '@/hooks/useRelayCannotEdit';
import { translateHomeKitError } from '@/lib/homekit-errors';
import type { HomeKitAutomation, SetAutomationEnabledResponse } from '@/lib/graphql/types';
import type { Automation } from '@/automation/types/automation';
import { countEffectiveActions } from '@/automation/trigger-branches';

interface AutomationCardProps {
  // Pass one or the other
  automation?: HomeKitAutomation;
  hcAutomation?: Automation;
  onClick: () => void;
  onUpdated?: () => void;
  onToggle?: (enabled: boolean) => void;
  /** Edit Layout is running: arrange it, don't operate it. */
  editMode?: boolean;
  onDelete?: () => void;
  compact?: boolean;
  isDarkBackground?: boolean;
}

export function AutomationCard({ automation, hcAutomation, onClick, onUpdated, onToggle, onDelete, compact, isDarkBackground, editMode }: AutomationCardProps) {
  const isHomeKit = !!automation;
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);
  const [setEnabled] = useMutation<SetAutomationEnabledResponse>(SET_AUTOMATION_ENABLED);

  // Only HomeKit automations live in the HomeKit database — Homecast ones are
  // ours and stay editable whatever access the relay has in Apple Home.
  const [viewOnlyOpen, setViewOnlyOpen] = useState(false);
  const relayCannotEdit = useRelayCannotEdit(isHomeKit ? automation.homeId : undefined);

  // Normalize data from either type
  const name = isHomeKit ? automation.name : (hcAutomation?.name || 'Unnamed automation');
  const rawEnabled = isHomeKit ? automation.isEnabled : (hcAutomation?.enabled ?? true);
  const isEnabled = optimisticEnabled ?? rawEnabled;

  // Counted past the per-trigger `choose` the serializer folds branches into.
  // Reading the top-level list straight described a two-branch automation as
  // "2 triggers, 1 action" — the wrapper, not the work.
  const triggerCount = hcAutomation?.triggers?.length ?? 0;
  const actionCount = countEffectiveActions(hcAutomation?.actions);
  const subtitle = isHomeKit
    ? undefined // rendered by AutomationTriggerSummary
    : `${triggerCount} trigger${triggerCount !== 1 ? 's' : ''}, ${actionCount} action${actionCount !== 1 ? 's' : ''}`;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isHomeKit && relayCannotEdit) { setViewOnlyOpen(true); return; }

    const newEnabled = !isEnabled;
    setOptimisticEnabled(newEnabled);

    if (isHomeKit) {
      try {
        await setEnabled({
          variables: { automationId: automation.id, enabled: newEnabled, homeId: automation.homeId },
        });
        onUpdated?.();
      } catch (error) {
        console.error('Failed to toggle automation:', error);
        setOptimisticEnabled(null);
        toast.error('Could not update automation', { description: translateHomeKitError(error) });
      }
    } else {
      onToggle?.(newEnabled);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isHomeKit && relayCannotEdit) { setViewOnlyOpen(true); return; }
    onDelete?.();
  };

  // Match WidgetWrapper: same bg regardless of dark/light background
  const colorClass = isEnabled
    ? 'bg-blue-200/75'
    : (isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80');

  // Ring stays mounted and only recolours — an inset box-shadow can't
  // interpolate to `none`, so removing the class would snap. Matches WidgetWrapper.
  const borderClass = !isEnabled
    ? `ring-1 ring-inset ${isDarkBackground ? 'ring-transparent' : 'ring-slate-200'}`
    : '';
  const darkTextClass = !isEnabled && isDarkBackground
    ? '[&_h3]:!text-white [&_p]:!text-white/70 [&_span]:!text-white/70'
    : '';

  // When enabled: solid blue bg → dark text (same as widgets). When disabled on dark bg: white text.
  const textClass = (isDarkBackground && !isEnabled) ? 'text-white' : '';
  const subtextClass = (isDarkBackground && !isEnabled) ? 'text-white/60' : 'text-muted-foreground';
  return (
    <div
      className={`relative rounded-2xl h-fit ${editMode ? '' : 'cursor-pointer'} transition-all duration-300 [&_h3]:transition-colors [&_h3]:duration-300 [&_p]:transition-colors [&_p]:duration-300 ${borderClass} ${darkTextClass} ${!isEnabled ? 'opacity-60' : ''}`}
      style={{ contain: 'layout style paint' }}
      onClick={editMode ? undefined : onClick}
      data-testid={isHomeKit ? `automation-${automation.id}` : `hc-automation-${hcAutomation?.id}`}
    >
      {/* Blur layer — matches WidgetWrapper */}
      <div className={`absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 ${colorClass} transform-gpu`} />
      {/* Content */}
      {/* Fixed floors: this padding is what separates the icon and the toggle
          from the card edge, and rem units shrank it exactly at the text sizes
          where the card was already tightest. */}
      <div className={`relative z-[1] ${compact ? 'p-[max(0.625rem,12px)]' : 'p-[max(1rem,18px)]'}`}>
        {/* items-start, not items-center: the name wraps to as many lines as it
            needs, and centring the icon/controls against a 3-line name looks off. */}
        <div className={`flex items-start justify-between ${compact ? 'gap-1.5' : 'gap-2'}`}>
          <div className={`flex items-start min-w-0 ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
            {/* Logo icon — only differentiator */}
            <img
              src={isHomeKit ? '/homekit_logo.png' : '/icon-192.png'}
              alt={isHomeKit ? 'HomeKit' : 'Homecast'}
              // Matches the accessory tiles: these sit in the same grid, and a
              // smaller icon here read as a different, lesser kind of card.
              className={`${compact ? 'h-8 w-8' : 'h-9 w-9'} shrink-0 rounded-md`}
            />
            <div className="min-w-0 flex-1">
              {/* Wraps rather than truncating — automation names are frequently
                  descriptive ("Turn off the heating when a window opens") and a
                  single ellipsed line made them unreadable. */}
              <div
                title={name}
                className={`${compact ? 'text-xs' : 'text-sm'} font-medium break-words ${textClass}`}
              >
                {name}
              </div>
              <div className={`${compact ? 'text-[10px]' : 'text-xs'} truncate ${subtextClass}`}>
                {isHomeKit && automation.trigger ? (
                  <AutomationTriggerSummary trigger={automation.trigger} compact automationName={automation.name} />
                ) : (
                  subtitle
                )}
              </div>
            </div>
          </div>
          {/* Enabling an automation is operating it, not arranging it — and the
              switch sits exactly where a mis-grab on the way to a drag lands. */}
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            {!editMode && (
              <div onClick={handleToggle}>
                <Switch checked={isEnabled} className={compact ? 'scale-90' : ''} />
              </div>
            )}
            {onDelete && !editMode && (
              <button
                type="button"
                onClick={handleDelete}
                className={`p-1 rounded-md transition-colors ${isDarkBackground ? 'hover:bg-white/10 text-white/20 hover:text-red-400' : 'hover:bg-muted text-muted-foreground/20 hover:text-red-500'}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Stops click-through to onClick — portals bubble through the React tree,
          so a click inside the dialog would otherwise open the detail view.
          Mounted only while open: there is one card per automation. */}
      {viewOnlyOpen && isHomeKit && (
        <div onClick={(e) => e.stopPropagation()}>
          <ViewOnlyHomeDialog open onOpenChange={setViewOnlyOpen} homeId={automation.homeId} subject="automation" />
        </div>
      )}
    </div>
  );
}
