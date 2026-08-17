import React, { memo } from 'react';
import { Fan, RotateCcw, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch, VerticalSlider } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const FanWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
  onSlider,
  getEffectiveValue,
  compact,
  expanded,
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
  const powerChar = getCharacteristic(accessory, 'on') || getCharacteristic(accessory, 'power_state') || getCharacteristic(accessory, 'active');
  const speedChar = getCharacteristic(accessory, 'rotation_speed');
  const directionChar = getCharacteristic(accessory, 'rotation_direction');

  const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : false;
  const isOn = powerValue === true || powerValue === 1;
  const speed = speedChar ? getEffectiveValue(accessory.id, 'rotation_speed', speedChar.value) : null;
  const direction = directionChar ? getEffectiveValue(accessory.id, 'rotation_direction', directionChar.value) : 0;

  const hasControls = speedChar?.isWritable;

  const showHero = expanded && !compact && !!speedChar?.isWritable && isOn;

  return (
    <WidgetCard
      hero={showHero ? (
        <VerticalSlider
          value={speed ?? 0}
          min={speedChar.characteristic?.minValue ?? 0}
          max={speedChar.characteristic?.maxValue ?? 100}
          step={speedChar.characteristic?.stepValue ?? 10}
          onCommit={(v) => onSlider(accessory.id, 'rotation_speed', v)}
          disabled={!accessory.isReachable}
          icon={Fan}
          label="Fan Speed"
          fillClassName="bg-sky-400/80"
          trackClassName="bg-black/10"
          className="h-full text-slate-900"
        />
      ) : undefined}
      title={accessory.name}
      subtitle={isOn ? (speed !== null ? `${Math.round(speed)}% speed` : 'On') : 'Off'}
      icon={<Fan className={`h-4 w-4 ${isOn ? 'animate-spin' : ''}`} style={{ animationDuration: speed ? `${2000 / (speed / 50)}ms` : '2s' }} />}
      isOn={isOn}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}

      serviceType="fan"
      iconStyle={iconStyle}
      childrenVisible={isOn && hasControls && accessory.isReachable}
      
      
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
        powerChar && (
          <ColoredSwitch
            checked={isOn}
            onCheckedChange={() => onToggle(accessory.id, powerChar.type, isOn)}
            disabled={!accessory.isReachable}
          />
        )
      }
    >
      {hasControls && (
        <div className={compact ? "space-y-1.5" : "space-y-4"}>
          {/* The hero bar already is the speed control. */}
          {!showHero && (
            <SliderControl
              label="Fan Speed"
              value={speed ?? 0}
              min={speedChar.characteristic?.minValue ?? 0}
              max={speedChar.characteristic?.maxValue ?? 100}
              step={speedChar.characteristic?.stepValue ?? 10}
              unit="%"
              onCommit={(v) => onSlider(accessory.id, 'rotation_speed', v)}
              compact={compact}
            />
          )}

          {!compact && directionChar?.isWritable && (
            <div className="flex gap-2">
              <Button
                variant={direction === 0 ? 'default' : 'outline'}
                size={expanded ? 'lg' : 'sm'}
                className="flex-1"
                onClick={() => onSlider(accessory.id, 'rotation_direction', 0)}
                disabled={!accessory.isReachable}
              >
                <RotateCw className={expanded ? 'h-4 w-4 mr-1.5' : 'h-3 w-3 mr-1'} />
                Forward
              </Button>
              <Button
                variant={direction === 1 ? 'default' : 'outline'}
                size={expanded ? 'lg' : 'sm'}
                className="flex-1"
                onClick={() => onSlider(accessory.id, 'rotation_direction', 1)}
                disabled={!accessory.isReachable}
              >
                <RotateCcw className={expanded ? 'h-4 w-4 mr-1.5' : 'h-3 w-3 mr-1'} />
                Reverse
              </Button>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
});
