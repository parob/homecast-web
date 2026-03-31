import React, { memo } from 'react';
import { Droplets, Timer } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

const VALVE_TYPES = ['Generic', 'Irrigation', 'Shower Head', 'Water Faucet'];

export const ValveWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
  onSlider,
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
  const valveTypeChar = getCharacteristic(accessory, 'valve_type');
  const durationChar = getCharacteristic(accessory, 'set_duration');
  const remainingChar = getCharacteristic(accessory, 'remaining_duration');

  const isActive = activeChar ? getEffectiveValue(accessory.id, 'active', activeChar.value) === true : false;
  const inUse = inUseChar?.value === true || inUseChar?.value === 1;
  const valveType = valveTypeChar?.value ?? 0;
  const duration = durationChar ? getEffectiveValue(accessory.id, 'set_duration', durationChar.value) : null;
  const remaining = remainingChar?.value;

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
        <span className="flex items-center gap-2">
          <Badge variant={inUse ? 'default' : 'secondary'}>
            {VALVE_TYPES[valveType] || 'Valve'}
          </Badge>
          {inUse && remaining && (
            <span className="text-xs text-muted-foreground flex items-center gap-1">
              <Timer className="h-3 w-3" />
              {formatDuration(remaining)}
            </span>
          )}
        </span>
      }
      icon={<Droplets className={`h-4 w-4 ${inUse ? 'text-blue-500' : ''}`} />}
      serviceType="valve"
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
      {durationChar?.isWritable && (
        <div className="space-y-2">
          <SliderControl
            label="Duration"
            value={duration ?? 300}
            min={durationChar.characteristic?.minValue ?? 60}
            max={durationChar.characteristic?.maxValue ?? 3600}
            step={durationChar.characteristic?.stepValue ?? 60}
            formatValue={formatDuration}
            onCommit={(v) => onSlider(accessory.id, 'set_duration', v)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatDuration(durationChar.characteristic?.minValue ?? 60)}</span>
            <span>{formatDuration(durationChar.characteristic?.maxValue ?? 3600)}</span>
          </div>
        </div>
      )}
    </WidgetCard>
  );
});
