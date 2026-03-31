import React, { memo } from 'react';
import { DoorOpen, DoorClosed, Battery, BatteryLow, BatteryWarning } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

export const ContactSensorWidget: React.FC<WidgetProps> = memo(({
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
  // Contact state
  const contactChar = getCharacteristic(accessory, 'contact_state');
  // contact_state: 0/false = contact detected (closed), 1/true = contact not detected (open)
  const contactValue = contactChar?.value;
  const isOpen = contactValue === 1 || contactValue === '1' || contactValue === true || contactValue === 'true';

  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = typeof batteryLevelChar?.value === 'number' ? batteryLevelChar.value :
                       (batteryLevelChar?.value ? Number(batteryLevelChar.value) : null);
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' ||
                       lowBatteryChar?.value === 1 || lowBatteryChar?.value === '1';
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  const Icon = isOpen ? DoorOpen : DoorClosed;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2">
          {isOpen ? (
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              Open
            </Badge>
          ) : (
            <span className="text-muted-foreground">Closed</span>
          )}
          {hasBattery && (
            <span className={`flex items-center gap-0.5 ${isLowBattery ? 'text-amber-500' : 'text-muted-foreground'}`}>
              <BatteryIcon className="h-3 w-3" />
              {batteryLevel !== null && !isNaN(batteryLevel) && <span>{Math.round(batteryLevel)}%</span>}
            </span>
          )}
        </span>
      }
      icon={<Icon className="h-4 w-4" />}
      serviceType="contact_sensor"
      iconStyle={iconStyle}
      isOn={isOpen}
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
