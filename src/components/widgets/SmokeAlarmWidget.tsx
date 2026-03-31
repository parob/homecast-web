import React, { memo } from 'react';
import {
  Siren,
  AlertTriangle,
  Wind,
  Battery,
  BatteryLow,
  BatteryWarning,
  CheckCircle2,
  Footprints,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

// Compact status display for right side
const StatusDisplay: React.FC<{
  smokeDetected: boolean;
  coDetected: boolean;
  hasSmoke: boolean;
  hasCO: boolean;
  iconStyle?: string;
}> = ({ smokeDetected, coDetected, hasSmoke, hasCO, iconStyle }) => {
  const isAlarming = smokeDetected || coDetected;

  if (isAlarming) {
    return (
      <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20">
        <Badge variant="destructive" className="animate-pulse text-xs px-2 py-1">
          <AlertTriangle className="h-3 w-3 mr-1" />
          {smokeDetected && coDetected ? 'ALARM!' : smokeDetected ? 'SMOKE!' : 'CO!'}
        </Badge>
      </div>
    );
  }

  return (
    <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1 items-end">
      {hasSmoke && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Smoke</span>
          <CheckCircle2 className={`h-4 w-4 ${iconStyle === 'colourful' ? 'text-emerald-500' : 'text-green-500'}`} />
        </div>
      )}
      {hasCO && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">CO</span>
          <CheckCircle2 className={`h-4 w-4 ${iconStyle === 'colourful' ? 'text-emerald-500' : 'text-green-500'}`} />
        </div>
      )}
    </div>
  );
};

export const SmokeAlarmWidget: React.FC<WidgetProps> = memo(({
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
  // Get smoke and CO readings
  const smokeChar = getCharacteristic(accessory, 'smoke_detected');
  const coChar = getCharacteristic(accessory, 'carbon_monoxide_detected');

  // Occupancy (Nest Protect has this)
  const occupancyChar = getCharacteristic(accessory, 'occupancy_detected');
  const occupancyDetected = occupancyChar?.value === true || occupancyChar?.value === 'true' ||
                            occupancyChar?.value === 1 || occupancyChar?.value === '1';
  const hasOccupancy = occupancyChar !== null;

  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = typeof batteryLevelChar?.value === 'number'
    ? batteryLevelChar.value
    : (batteryLevelChar?.value ? Number(batteryLevelChar.value) : null);
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' ||
                       lowBatteryChar?.value === 1 || lowBatteryChar?.value === '1';
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  // Determine sensor states
  const hasSmokeSensor = hasServiceType(accessory, 'smoke_sensor') || smokeChar !== null;
  const hasCOSensor = hasServiceType(accessory, 'carbon_monoxide_sensor') || coChar !== null;

  const smokeDetected = smokeChar?.value === true || smokeChar?.value === 'true' ||
                        smokeChar?.value === 1 || smokeChar?.value === '1';
  const coDetected = coChar?.value === true || coChar?.value === 'true' ||
                     coChar?.value === 1 || coChar?.value === '1';

  const isAlarming = smokeDetected || coDetected;
  const showVisual = !compact && !editMode && accessory.isReachable;

  // Compact mode status badge
  const compactStatus = compact ? (
    <span data-status-badge className={`text-xs font-medium px-2 py-0.5 rounded-full ${
      isAlarming
        ? 'bg-red-500 text-white animate-pulse'
        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'
    }`}>
      {isAlarming
        ? (smokeDetected && coDetected ? 'ALARM!' : smokeDetected ? 'SMOKE!' : 'CO!')
        : 'All OK'}
    </span>
  ) : undefined;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2 text-muted-foreground">
          {hasOccupancy && (
            <span className={`flex items-center gap-1 ${occupancyDetected ? (iconStyle === 'colourful' ? 'text-emerald-500' : 'text-primary') : ''}`}>
              <Footprints className="h-3 w-3" />
              {occupancyDetected ? 'Occupied' : 'Empty'}
            </span>
          )}
          {hasBattery && (
            <span className={`flex items-center gap-0.5 ${isLowBattery ? 'text-amber-500' : ''}`}>
              <BatteryIcon className="h-3 w-3" />
              {batteryLevel !== null && !isNaN(batteryLevel)
                ? `${Math.round(batteryLevel)}%`
                : (isLowBattery ? 'Low' : 'OK')}
            </span>
          )}
        </span>
      }
      icon={<Siren className={`h-4 w-4 ${isAlarming ? 'animate-pulse' : ''}`} />}
      serviceType="smoke_sensor"
      iconStyle={iconStyle}
      isOn={isAlarming}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      className={`${isAlarming ? 'border-destructive bg-destructive/10' : ''} ${showVisual ? 'relative overflow-visible pr-24' : ''}`}
      
      
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
      overlayContent={
        showVisual ? (
          <StatusDisplay
            smokeDetected={smokeDetected}
            coDetected={coDetected}
            hasSmoke={hasSmokeSensor}
            hasCO={hasCOSensor}
            iconStyle={iconStyle}
          />
        ) : undefined
      }
    />
  );
});
