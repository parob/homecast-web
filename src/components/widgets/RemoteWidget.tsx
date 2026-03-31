import React, { memo } from 'react';
import { SlidersVertical, Battery, BatteryLow, BatteryWarning } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

export const RemoteWidget: React.FC<WidgetProps> = memo(({
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
  // Count the number of stateless_programmable_switch services
  const switchServices = accessory.services?.filter(
    s => s.serviceType === 'stateless_programmable_switch' ||
         s.serviceType === '00000089-0000-1000-8000-0026BB765291'
  ) || [];
  const buttonCount = switchServices.length;

  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = typeof batteryLevelChar?.value === 'number' ? batteryLevelChar.value : null;
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' || lowBatteryChar?.value === 1;
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;

  // Get battery icon
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  // Check if this looks like a dimmer switch (4 buttons)
  const isDimmerSwitch = buttonCount === 4;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2">
          <span className="text-muted-foreground">
            {isDimmerSwitch ? 'Dimmer' : `${buttonCount} buttons`}
          </span>
          {hasBattery && (
            <span className={`flex items-center gap-0.5 ${isLowBattery ? 'text-amber-500' : 'text-muted-foreground'}`}>
              <BatteryIcon className="h-3 w-3" />
              {batteryLevel !== null && <span>{Math.round(batteryLevel)}%</span>}
            </span>
          )}
        </span>
      }
      icon={<SlidersVertical className="h-4 w-4" />}
      serviceType="stateless_programmable_switch"
      iconStyle={iconStyle}
      isOn={accessory.isReachable}
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
