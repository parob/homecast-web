import React, { memo } from 'react';
import { Activity, Footprints, Thermometer, Battery, BatteryLow, BatteryWarning } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

export const MotionSensorWidget: React.FC<WidgetProps> = memo(({
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
  // Motion/Occupancy detection (handles both motion_sensor and occupancy_sensor)
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const occupancyChar = getCharacteristic(accessory, 'occupancy_detected');
  const detectionChar = motionChar || occupancyChar;
  const motionDetected = detectionChar?.value === true || detectionChar?.value === 'true' ||
                         detectionChar?.value === 1 || detectionChar?.value === '1';

  // Temperature (often included in motion sensors like Hue)
  const tempChar = getCharacteristic(accessory, 'current_temperature');
  const temperature = tempChar?.value !== null && tempChar?.value !== undefined
    ? Number(tempChar.value) : null;

  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = batteryLevelChar?.value !== null && batteryLevelChar?.value !== undefined
    ? Number(batteryLevelChar.value) : null;
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' ||
                       lowBatteryChar?.value === 1 || lowBatteryChar?.value === '1';
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null;
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  const hasTemp = temperature !== null;

  // Compact mode status display
  const compactStatus = compact ? (
    <span data-status-badge className={`text-xs font-medium px-2 py-0.5 rounded-full ${
      motionDetected
        ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'
        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
    }`}>
      {motionDetected ? 'Motion' : 'No Motion'}
    </span>
  ) : undefined;

  // Build subtitle with motion status first, then temp/battery
  const subtitle = (
    <span className="flex items-center gap-2">
      <span className={motionDetected
        ? iconStyle === 'colourful' ? 'text-emerald-500' : 'text-primary'
        : 'text-muted-foreground'
      }>
        {motionDetected ? 'Motion detected' : 'No motion'}
      </span>
      {hasTemp && (
        <span className="flex items-center gap-1 text-muted-foreground">
          <Thermometer className={`h-3 w-3 ${iconStyle === 'colourful' ? 'text-rose-500' : ''}`} />
          {temperature!.toFixed(1)}°C
        </span>
      )}
      {hasBattery && batteryLevel !== null && (
        <span className={`flex items-center gap-0.5 text-muted-foreground ${isLowBattery ? 'text-amber-500' : ''}`}>
          <BatteryIcon className="h-3 w-3" />
          {Math.round(batteryLevel)}%
        </span>
      )}
    </span>
  );

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={subtitle}
      icon={
        motionDetected
          ? <Footprints className="h-4 w-4" />
          : <Activity className="h-4 w-4" />
      }
      serviceType="motion_sensor"
      iconStyle={iconStyle}
      isOn={motionDetected}
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
      headerAction={compactStatus}
    />
  );
});
