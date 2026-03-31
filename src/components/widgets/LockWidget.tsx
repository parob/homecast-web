import React, { memo, useState, useEffect, useRef } from 'react';
import { Lock, AlertTriangle, Battery, BatteryLow, BatteryMedium, BatteryFull } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';

// Normalize lock state from various formats to HomeKit numeric values
// HomeKit: 0=Unlocked, 1=Locked, 2=Jammed, 3=Unknown
// Some devices return boolean-like values (true/false or "true"/"false") where true=Locked
function normalizeLockState(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value === true || value === 'true' || value === 1 || value === '1') return 1; // Locked
  if (value === false || value === 'false' || value === 0 || value === '0') return 0; // Unlocked
  return 3; // Unknown
}

export const LockWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
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
  const currentStateChar = getCharacteristic(accessory, 'lock_current_state');
  const targetStateChar = getCharacteristic(accessory, 'lock_target_state');

  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = batteryLevelChar?.value !== null && batteryLevelChar?.value !== undefined
    ? Number(batteryLevelChar.value) : null;
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' ||
                       lowBatteryChar?.value === 1 || lowBatteryChar?.value === '1';
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;

  const rawCurrentState = currentStateChar?.value ?? 3;
  const currentState = normalizeLockState(rawCurrentState);

  const isLocked = currentState === 1;
  const isJammed = currentState === 2;
  const hasControls = targetStateChar?.isWritable;

  // Track pending state - when user clicks but lock hasn't updated yet
  const [isPending, setIsPending] = useState(false);
  const lastStateRef = useRef(currentState);

  // Clear pending when lock state actually changes
  useEffect(() => {
    if (currentState !== lastStateRef.current) {
      setIsPending(false);
      lastStateRef.current = currentState;
    }
  }, [currentState]);

  // Also clear pending after a timeout (fallback - locks can be slow)
  useEffect(() => {
    if (isPending) {
      const timeout = setTimeout(() => setIsPending(false), 15000);
      return () => clearTimeout(timeout);
    }
  }, [isPending]);

  const handleToggle = () => {
    setIsPending(true);
    onToggle(accessory.id, 'lock_target_state', isLocked);
  };

  // Subtitle shows status
  const subtitle = (
    <span className="flex items-center gap-2 text-muted-foreground">
      {isJammed ? (
        <span className="flex items-center gap-1 text-amber-500">
          <AlertTriangle className="h-3 w-3" />
          Jammed
        </span>
      ) : (
        <span>{isPending ? (isLocked ? 'Unlocking...' : 'Locking...') : (isLocked ? 'Locked' : 'Unlocked')}</span>
      )}
    </span>
  );

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={subtitle}
      icon={<Lock className="h-4 w-4" />}
      isOn={isLocked}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="lock"
      iconStyle={iconStyle}
      
      
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
        hasControls && (
          <div className="flex items-center gap-2">
            {hasBattery && !compact && (
              <div className="flex items-center gap-1.5">
                {(() => {
                  const isLow = isLowBattery || (batteryLevel !== null && batteryLevel < 20);
                  const isMedium = !isLow && batteryLevel !== null && batteryLevel < 50;
                  const colorClass = isLow ? 'text-red-500' : isMedium ? 'text-amber-500' : 'text-emerald-500';
                  const Icon = isLow ? BatteryLow : isMedium ? BatteryMedium : BatteryFull;
                  return (
                    <>
                      <Icon className={`h-4 w-4 ${colorClass}`} />
                      <span className={`text-xs font-medium ${colorClass}`}>
                        {batteryLevel !== null ? `${Math.round(batteryLevel)}%` : (isLowBattery ? 'Low' : '')}
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            <ColoredSwitch
              checked={isLocked}
              onCheckedChange={handleToggle}
              disabled={!accessory.isReachable}
            />
          </div>
        )
      }
    />
  );
});
