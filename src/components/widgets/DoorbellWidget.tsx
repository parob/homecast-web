import React, { memo } from 'react';
import { Bell, Battery, BatteryLow, BatteryWarning } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

export const DoorbellWidget: React.FC<WidgetProps> = memo(({
  accessory,
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
  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = typeof batteryLevelChar?.value === 'number' ? batteryLevelChar.value :
                       (batteryLevelChar?.value ? Number(batteryLevelChar.value) : null);
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' || lowBatteryChar?.value === 1;
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;

  // Motion sensor (many doorbells have built-in motion)
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const hasMotion = motionChar?.value === true || motionChar?.value === 'true';

  // Get battery icon
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">Doorbell</span>
          {hasBattery && (
            <span className={`flex items-center gap-0.5 ${isLowBattery ? 'text-amber-500' : 'text-muted-foreground'}`}>
              <BatteryIcon className="h-3 w-3" />
              {batteryLevel !== null && <span>{Math.round(batteryLevel)}%</span>}
            </span>
          )}
        </span>
      }
      icon={<Bell className="h-4 w-4" />}
      serviceType="doorbell"
      iconStyle={iconStyle}
      isOn={hasMotion}
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
    />
  );
});
