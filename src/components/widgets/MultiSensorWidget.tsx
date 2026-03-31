import React, { memo } from 'react';
import {
  Activity,
  Thermometer,
  Sun,
  Battery,
  BatteryLow,
  BatteryWarning,
  Footprints,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

export const MultiSensorWidget: React.FC<WidgetProps> = memo(({
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
  // Determine first sensor type for icon color
  const hasMotionSensor = hasServiceType(accessory, 'motion_sensor');
  const hasOccupancySensor = hasServiceType(accessory, 'occupancy_sensor');
  const hasTempSensor = hasServiceType(accessory, 'temperature_sensor');
  const firstSensorType = hasMotionSensor ? 'motion_sensor' : hasOccupancySensor ? 'occupancy_sensor' : hasTempSensor ? 'temperature_sensor' : 'motion_sensor';

  // Get all sensor readings
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const occupancyChar = getCharacteristic(accessory, 'occupancy_detected');
  const tempChar = getCharacteristic(accessory, 'current_temperature');
  const lightChar = getCharacteristic(accessory, 'current_ambient_light_level');
  // Also check for the UUID version of light level
  const lightCharAlt = getCharacteristic(accessory, '0000006B-0000-1000-8000-0026BB765291');
  const humidityChar = getCharacteristic(accessory, 'relative_humidity');
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');

  // Determine primary state
  const motionDetected = motionChar?.value === true || motionChar?.value === 'true';
  const occupancyDetected = occupancyChar?.value === true || occupancyChar?.value === 'true';
  const isActive = motionDetected || occupancyDetected;

  // Battery info
  const batteryLevel = typeof batteryLevelChar?.value === 'number' ? batteryLevelChar.value : null;
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' || lowBatteryChar?.value === 1;

  // Temperature
  const temp = tempChar?.value;
  const tempValue = typeof temp === 'number' ? temp : (typeof temp === 'string' ? parseFloat(temp) : null);

  // Light level (check both standard and UUID characteristic)
  const lightValue = lightChar?.value ?? lightCharAlt?.value;
  const lightLevel = typeof lightValue === 'number' ? lightValue : (typeof lightValue === 'string' ? parseFloat(lightValue) : null);

  // Humidity
  const humidity = humidityChar?.value;
  const humidityValue = typeof humidity === 'number' ? humidity : (typeof humidity === 'string' ? parseFloat(humidity) : null);

  // Determine which sensors are present
  const hasMotion = hasServiceType(accessory, 'motion_sensor') || motionChar !== null;
  const hasOccupancy = hasServiceType(accessory, 'occupancy_sensor') || occupancyChar !== null;
  const hasTemp = hasServiceType(accessory, 'temperature_sensor') || tempChar !== null;
  const hasLight = hasServiceType(accessory, 'light_sensor') || lightChar !== null || lightCharAlt !== null;
  const hasHumidity = hasServiceType(accessory, 'humidity_sensor') || humidityChar !== null;
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;

  // Build subtitle with primary reading
  const subtitleParts: string[] = [];
  if (hasMotion || hasOccupancy) {
    subtitleParts.push(isActive ? 'Motion detected' : 'No motion');
  }
  if (hasTemp && tempValue !== null && !isNaN(tempValue)) {
    subtitleParts.push(`${tempValue.toFixed(1)}°C`);
  }

  // Choose primary icon
  const PrimaryIcon = hasMotion || hasOccupancy ? (isActive ? Footprints : Activity) : Thermometer;

  // Get battery icon
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={subtitleParts.join(' · ')}
      icon={<PrimaryIcon className="h-4 w-4" />}
      serviceType={firstSensorType}
      iconStyle={iconStyle}
      isOn={isActive}
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
    >
      <div className="space-y-3">
        {/* Sensor readings grid */}
        <div className="grid grid-cols-2 gap-2">
          {/* Motion/Occupancy */}
          {(hasMotion || hasOccupancy) && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
              {isActive ? (
                <Footprints className="h-4 w-4 text-amber-500" />
              ) : (
                <Activity className="h-4 w-4 text-muted-foreground" />
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground">Motion</p>
                <p className={`text-xs font-medium ${isActive ? 'text-amber-500' : ''}`}>
                  {isActive ? 'Detected' : 'Clear'}
                </p>
              </div>
            </div>
          )}

          {/* Temperature */}
          {hasTemp && tempValue !== null && !isNaN(tempValue) && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
              <Thermometer className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground">Temperature</p>
                <p className="text-xs font-medium">{tempValue.toFixed(1)}°C</p>
              </div>
            </div>
          )}

          {/* Light level */}
          {hasLight && lightLevel !== null && !isNaN(lightLevel) && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
              <Sun className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground">Light</p>
                <p className="text-xs font-medium">{Math.round(lightLevel)} lux</p>
              </div>
            </div>
          )}

          {/* Humidity */}
          {hasHumidity && humidityValue !== null && !isNaN(humidityValue) && (
            <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-2.5 py-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="text-[10px] text-muted-foreground">Humidity</p>
                <p className="text-xs font-medium">{Math.round(humidityValue)}%</p>
              </div>
            </div>
          )}
        </div>

        {/* Battery indicator */}
        {hasBattery && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <BatteryIcon className={`h-3.5 w-3.5 ${isLowBattery ? 'text-amber-500' : ''}`} />
                <span>Battery</span>
              </div>
              {batteryLevel !== null ? (
                <span className={`text-xs font-medium ${isLowBattery ? 'text-amber-500' : ''}`}>
                  {Math.round(batteryLevel)}%
                </span>
              ) : (
                <Badge
                  variant={isLowBattery ? 'destructive' : 'secondary'}
                  className="text-[10px] px-1.5 py-0"
                >
                  {isLowBattery ? 'Low' : 'OK'}
                </Badge>
              )}
            </div>
            {batteryLevel !== null && (
              <Progress
                value={batteryLevel}
                className={`h-1.5 ${isLowBattery || batteryLevel < 20 ? '[&>div]:bg-amber-500' : ''}`}
              />
            )}
          </div>
        )}
      </div>
    </WidgetCard>
  );
});
