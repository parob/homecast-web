// Unified automation card — used for both HomeKit and Homecast automations
// Identical style, differentiated only by a subtle outline icon

import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { Switch } from '@/components/ui/switch';
import { Trash2 } from 'lucide-react';
import { AutomationTriggerSummary } from './AutomationTriggerSummary';
import { SET_AUTOMATION_ENABLED } from '@/lib/graphql/mutations';
import type { HomeKitAutomation, SetAutomationEnabledResponse } from '@/lib/graphql/types';
import type { Automation } from '@/automation/types/automation';

interface AutomationCardProps {
  // Pass one or the other
  automation?: HomeKitAutomation;
  hcAutomation?: Automation;
  onClick: () => void;
  onUpdated?: () => void;
  onToggle?: (enabled: boolean) => void;
  onDelete?: () => void;
  compact?: boolean;
  isDarkBackground?: boolean;
}

export function AutomationCard({ automation, hcAutomation, onClick, onUpdated, onToggle, onDelete, compact, isDarkBackground }: AutomationCardProps) {
  const isHomeKit = !!automation;
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(null);
  const [setEnabled] = useMutation<SetAutomationEnabledResponse>(SET_AUTOMATION_ENABLED);

  // Normalize data from either type
  const name = isHomeKit ? automation.name : (hcAutomation?.name || 'Unnamed automation');
  const rawEnabled = isHomeKit ? automation.isEnabled : (hcAutomation?.enabled ?? true);
  const isEnabled = optimisticEnabled ?? rawEnabled;

  const subtitle = isHomeKit
    ? undefined // rendered by AutomationTriggerSummary
    : `${hcAutomation?.triggers?.length ?? 0} trigger${(hcAutomation?.triggers?.length ?? 0) !== 1 ? 's' : ''}, ${hcAutomation?.actions?.length ?? 0} action${(hcAutomation?.actions?.length ?? 0) !== 1 ? 's' : ''}`;

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
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
      }
    } else {
      onToggle?.(newEnabled);
    }
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete?.();
  };

  // Match WidgetWrapper: same bg regardless of dark/light background
  const colorClass = isEnabled
    ? 'bg-blue-200/75'
    : (isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80');

  const borderClass = !isEnabled && !isDarkBackground ? 'ring-1 ring-inset ring-slate-200' : '';
  const darkTextClass = !isEnabled && isDarkBackground
    ? '[&_h3]:!text-white [&_p]:!text-white/70 [&_span]:!text-white/70'
    : '';

  // When enabled: solid blue bg → dark text (same as widgets). When disabled on dark bg: white text.
  const textClass = (isDarkBackground && !isEnabled) ? 'text-white' : '';
  const subtextClass = (isDarkBackground && !isEnabled) ? 'text-white/60' : 'text-muted-foreground';
  return (
    <div
      className={`relative rounded-[20px] h-fit cursor-pointer transition-all ${borderClass} ${darkTextClass} ${!isEnabled ? 'opacity-60' : ''}`}
      style={{ contain: 'layout style paint' }}
      onClick={onClick}
      data-testid={isHomeKit ? `automation-${automation.id}` : `hc-automation-${hcAutomation?.id}`}
    >
      {/* Blur layer — matches WidgetWrapper */}
      <div className={`absolute inset-0 rounded-[20px] backdrop-blur-xl shadow-sm ${colorClass} transform-gpu`} />
      {/* Content */}
      <div className={`relative z-[1] ${compact ? 'p-2.5' : 'p-4'}`}>
        <div className={`flex items-center justify-between ${compact ? 'gap-1.5' : 'gap-2'}`}>
          <div className={`flex items-center min-w-0 ${compact ? 'gap-1.5' : 'gap-2.5'}`}>
            {/* Logo icon — only differentiator */}
            <img
              src={isHomeKit ? '/homekit_logo.png' : '/icon-192.png'}
              alt={isHomeKit ? 'HomeKit' : 'Homecast'}
              className={`${compact ? 'h-6 w-6' : 'h-8 w-8'} shrink-0 rounded-md`}
            />
            <div className="min-w-0 flex-1">
              <div className={`${compact ? 'text-xs' : 'text-sm'} font-medium truncate ${textClass}`}>
                {name}
              </div>
              <div className={`${compact ? 'text-[10px]' : 'text-xs'} ${subtextClass}`}>
                {isHomeKit && automation.trigger ? (
                  <AutomationTriggerSummary trigger={automation.trigger} compact automationName={automation.name} />
                ) : (
                  subtitle
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
            <div onClick={handleToggle}>
              <Switch checked={isEnabled} className={compact ? 'scale-75' : ''} />
            </div>
            {onDelete && (
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
    </div>
  );
}
