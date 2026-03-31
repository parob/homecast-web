import React, { memo } from 'react';
import { Wind, Gauge, Filter } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

const TARGET_STATES = ['Manual', 'Auto'];
const AIR_QUALITY = ['Unknown', 'Excellent', 'Good', 'Fair', 'Inferior', 'Poor'];

export const AirPurifierWidget: React.FC<WidgetProps> = memo(({
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
  const targetStateChar = getCharacteristic(accessory, 'target_air_purifier_state');
  const speedChar = getCharacteristic(accessory, 'rotation_speed');
  const airQualityChar = getCharacteristic(accessory, 'air_quality');
  const filterLifeChar = getCharacteristic(accessory, 'filter_life_level');
  const filterChangeChar = getCharacteristic(accessory, 'filter_change_indication');

  const isActive = activeChar ? getEffectiveValue(accessory.id, 'active', activeChar.value) === true : false;
  const targetState = targetStateChar ? getEffectiveValue(accessory.id, 'target_air_purifier_state', targetStateChar.value) : 0;
  const speed = speedChar ? getEffectiveValue(accessory.id, 'rotation_speed', speedChar.value) : null;
  const airQuality = airQualityChar?.value ?? 0;
  const filterLife = filterLifeChar?.value;
  const needsFilterChange = filterChangeChar?.value === 1;

  const airQualityName = AIR_QUALITY[airQuality] || 'Unknown';
  const airQualityColor = airQuality <= 2 ? 'text-green-500' : airQuality <= 3 ? 'text-yellow-500' : 'text-red-500';
  const hasControls = targetStateChar?.isWritable || speedChar?.isWritable;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2">
          {isActive && (
            <Badge variant={targetState === 1 ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
              {TARGET_STATES[targetState]}
            </Badge>
          )}
          {airQuality > 0 && (
            <span className={`text-xs font-medium ${airQualityColor}`}>
              {airQualityName}
            </span>
          )}
          {filterLife !== null && filterLife !== undefined && (
            <span className={`text-xs flex items-center gap-1 ${needsFilterChange ? 'text-amber-500' : 'text-muted-foreground'}`}>
              <Filter className="h-3 w-3" />
              {Math.round(filterLife)}%
            </span>
          )}
        </span>
      }
      icon={<Wind className={`h-4 w-4 ${isActive ? 'animate-pulse' : ''}`} />}
      serviceType="air_purifier"
      iconStyle={iconStyle}
      isOn={isActive}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      childrenVisible={isActive && hasControls && accessory.isReachable}
      
      
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
      {hasControls && (
        <div className="space-y-4">
          {targetStateChar?.isWritable && (
            <div className="flex gap-2">
              {TARGET_STATES.map((mode, index) => (
                <button
                  key={mode}
                  onClick={() => onSlider(accessory.id, 'target_air_purifier_state', index)}
                  className={`flex-1 py-2 px-3 rounded-lg text-xs font-medium transition-all ${
                    targetState === index
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                  disabled={!accessory.isReachable}
                >
                  {mode}
                </button>
              ))}
            </div>
          )}

          {speedChar?.isWritable && targetState === 0 && (
            <SliderControl
              label="Fan Speed"
              icon={Gauge}
              value={speed ?? 0}
              min={speedChar.characteristic?.minValue ?? 0}
              max={speedChar.characteristic?.maxValue ?? 100}
              step={speedChar.characteristic?.stepValue ?? 10}
              unit="%"
              onCommit={(v) => onSlider(accessory.id, 'rotation_speed', v)}
            />
          )}
        </div>
      )}
    </WidgetCard>
  );
});
