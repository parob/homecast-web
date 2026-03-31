import React, { memo } from 'react';
import { Flower2, Timer, Droplets, Calendar } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { WidgetCard } from './WidgetCard';
import { ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

const PROGRAM_MODES = ['None', 'Scheduled', 'Manual'];

export const IrrigationWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
  getEffectiveValue,
  compact,
  onExpandToggle,
  onDebug,
  
  iconStyle,
  
  
  editMode,
  editModeType,
  isHiddenUi,
  homeName,
  disableTooltip,
  onRemove,
  removeLabel,
  onHide,
  hideLabel,
  isHidden,
  showHiddenItems,
  onToggleShowHidden,
  onShare,
  locationSubtitle,
}) => {
  const activeChar = getCharacteristic(accessory, 'active');
  const inUseChar = getCharacteristic(accessory, 'in_use');
  const programModeChar = getCharacteristic(accessory, 'program_mode');
  const remainingChar = getCharacteristic(accessory, 'remaining_duration');
  const configuredChar = getCharacteristic(accessory, 'is_configured');

  const isActive = activeChar ? getEffectiveValue(accessory.id, 'active', activeChar.value) === true : false;
  const inUse = inUseChar?.value === true || inUseChar?.value === 1;
  const programMode = programModeChar?.value ?? 0;
  const remaining = remainingChar?.value;
  const isConfigured = configuredChar?.value === true || configuredChar?.value === 1;

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2 flex-wrap">
          <Badge variant={inUse ? 'default' : 'secondary'}>
            {inUse ? 'Watering' : 'Idle'}
          </Badge>
          {programMode > 0 && (
            <Badge variant="outline" className="gap-1">
              <Calendar className="h-3 w-3" />
              {PROGRAM_MODES[programMode]}
            </Badge>
          )}
        </span>
      }
      icon={
        <Flower2 className={`h-4 w-4 ${inUse ? 'text-green-500' : ''}`} />
      }
      serviceType="irrigation_system"
      iconStyle={iconStyle}
      isOn={inUse}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      
      
      editMode={editMode}
      editModeType={editModeType}
      isHiddenUi={isHiddenUi}
      homeName={homeName}
      disableTooltip={disableTooltip}
      onRemove={onRemove}
      removeLabel={removeLabel}
      onHide={onHide}
      hideLabel={hideLabel}
      isHidden={isHidden}
      showHiddenItems={showHiddenItems}
      onToggleShowHidden={onToggleShowHidden}
      onShare={onShare}
      locationSubtitle={locationSubtitle}
      headerAction={
        activeChar?.isWritable && (
          <ColoredSwitch
            checked={isActive}
            onCheckedChange={() => onToggle(accessory.id, 'active', isActive)}
            disabled={!accessory.isReachable}
          />
        )
      }
    >
      <div className="space-y-3">
        {/* Active watering indicator */}
        {inUse && remaining !== null && remaining !== undefined && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Timer className="h-3 w-3" />
                Time Remaining
              </span>
              <span className="font-medium">{formatDuration(remaining)}</span>
            </div>
            <div className="flex items-center gap-2">
              <Droplets className="h-4 w-4 text-blue-500 animate-pulse" />
              <Progress value={75} className="flex-1 h-2 [&>div]:bg-blue-500" />
            </div>
          </div>
        )}

        {/* Configuration status */}
        {!isConfigured && (
          <p className="text-xs text-muted-foreground">
            Not configured. Set up zones in the Home app.
          </p>
        )}

        {/* Program mode indicator */}
        {programMode === 1 && !inUse && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Calendar className="h-3 w-3" />
            <span>Schedule active - waiting for next run</span>
          </div>
        )}
      </div>
    </WidgetCard>
  );
});
