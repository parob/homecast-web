import React, { memo } from 'react';
import {
  Thermometer, Droplets, Sun, Activity, Footprints,
  DoorOpen, AlertTriangle, Wind, Battery, BatteryLow, BatteryWarning, Droplet
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, ServiceType, hasServiceType } from './types';

interface SensorWidgetProps extends WidgetProps {
  sensorType: ServiceType;
}

export const SensorWidget: React.FC<SensorWidgetProps> = memo(({
  accessory,
  sensorType,
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
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' ||
                       lowBatteryChar?.value === 1 || lowBatteryChar?.value === '1';
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  // Sensor-specific characteristics
  const tempChar = getCharacteristic(accessory, 'current_temperature');
  const humidityChar = getCharacteristic(accessory, 'relative_humidity');
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const occupancyChar = getCharacteristic(accessory, 'occupancy_detected');
  const contactChar = getCharacteristic(accessory, 'contact_state');
  const lightChar = getCharacteristic(accessory, 'current_ambient_light_level');
  const smokeChar = getCharacteristic(accessory, 'smoke_detected');
  const coChar = getCharacteristic(accessory, 'carbon_monoxide_detected');
  const co2Char = getCharacteristic(accessory, 'carbon_dioxide_detected');
  const leakChar = getCharacteristic(accessory, 'leak_detected');

  // Determine icon, label and status based on sensor type
  let icon: React.ReactNode;
  let label: string;
  let statusText: string;
  let isActive = false;
  let isDanger = false;

  switch (sensorType) {
    case 'temperature_sensor':
      icon = <Thermometer className="h-4 w-4" />;
      label = 'Temperature';
      const temp = tempChar?.value;
      statusText = temp !== null && temp !== undefined ? `${Number(temp).toFixed(1)}°C` : 'N/A';
      break;
    case 'humidity_sensor':
      icon = <Droplets className="h-4 w-4" />;
      label = 'Humidity';
      const humidity = humidityChar?.value;
      statusText = humidity !== null && humidity !== undefined ? `${Math.round(Number(humidity))}%` : 'N/A';
      break;
    case 'motion_sensor':
      isActive = motionChar?.value === true || motionChar?.value === 'true';
      icon = isActive ? <Footprints className="h-4 w-4" /> : <Activity className="h-4 w-4" />;
      label = 'Motion';
      statusText = isActive ? 'Detected' : 'Clear';
      break;
    case 'occupancy_sensor':
      isActive = occupancyChar?.value === true || occupancyChar?.value === 'true';
      icon = isActive ? <Footprints className="h-4 w-4" /> : <Activity className="h-4 w-4" />;
      label = 'Occupancy';
      statusText = isActive ? 'Occupied' : 'Empty';
      break;
    case 'contact_sensor':
      icon = <DoorOpen className="h-4 w-4" />;
      label = 'Door';
      // contact_state: 0/false = contact detected (closed), 1/true = contact not detected (open)
      const contactValue = contactChar?.value;
      isActive = contactValue === 1 || contactValue === '1' || contactValue === true || contactValue === 'true';
      statusText = isActive ? 'Open' : 'Closed';
      break;
    case 'light_sensor':
      icon = <Sun className="h-4 w-4" />;
      label = 'Light';
      const light = lightChar?.value;
      statusText = light !== null && light !== undefined ? `${Math.round(Number(light))} lux` : 'N/A';
      break;
    case 'leak_sensor':
      icon = <Droplet className="h-4 w-4" />;
      label = 'Leak';
      isDanger = leakChar?.value === 1 || leakChar?.value === '1' || leakChar?.value === true;
      isActive = isDanger;
      statusText = isDanger ? 'Leak!' : 'Dry';
      break;
    case 'smoke_sensor':
      icon = <AlertTriangle className="h-4 w-4" />;
      label = 'Smoke';
      isDanger = smokeChar?.value === 1 || smokeChar?.value === '1';
      isActive = isDanger;
      statusText = isDanger ? 'Smoke!' : 'Clear';
      break;
    case 'carbon_monoxide_sensor':
      icon = <Wind className="h-4 w-4" />;
      label = 'CO';
      isDanger = coChar?.value === 1 || coChar?.value === '1';
      isActive = isDanger;
      statusText = isDanger ? 'CO!' : 'Normal';
      break;
    case 'carbon_dioxide_sensor':
      icon = <Wind className="h-4 w-4" />;
      label = 'CO₂';
      isDanger = co2Char?.value === 1 || co2Char?.value === '1';
      isActive = isDanger;
      statusText = isDanger ? 'High!' : 'Normal';
      break;
    default:
      icon = <Activity className="h-4 w-4" />;
      label = 'Sensor';
      statusText = 'Active';
  }

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2">
          {isDanger ? (
            <Badge variant="destructive" className="text-[10px] px-1.5 py-0 animate-pulse">
              {statusText}
            </Badge>
          ) : isActive ? (
            <Badge variant="default" className="text-[10px] px-1.5 py-0">
              {statusText}
            </Badge>
          ) : (
            <span className="text-muted-foreground">{label} · {statusText}</span>
          )}
          {hasBattery && (
            <span className={`flex items-center gap-0.5 ${isLowBattery ? 'text-amber-500' : 'text-muted-foreground'}`}>
              <BatteryIcon className="h-3 w-3" />
              {batteryLevel !== null && !isNaN(batteryLevel) && <span>{Math.round(batteryLevel)}%</span>}
            </span>
          )}
        </span>
      }
      icon={icon}
      serviceType={sensorType}
      iconStyle={iconStyle}
      isOn={isActive || isDanger}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      className={isDanger ? 'border-destructive bg-destructive/10' : ''}
      
      
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
