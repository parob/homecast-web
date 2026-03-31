import React, { memo } from 'react';
import { Lightbulb, Sun, Palette } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const LightbulbWidget: React.FC<WidgetProps> = memo(({
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
  const powerChar = getCharacteristic(accessory, 'on') || getCharacteristic(accessory, 'power_state');
  const brightnessChar = getCharacteristic(accessory, 'brightness');
  const colorTempChar = getCharacteristic(accessory, 'color_temperature');
  const hueChar = getCharacteristic(accessory, 'hue');
  const saturationChar = getCharacteristic(accessory, 'saturation');

  const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : false;
  const isOn = powerValue === true || powerValue === 1;

  const brightness = brightnessChar ? getEffectiveValue(accessory.id, brightnessChar.type, brightnessChar.value) : null;
  const colorTemp = colorTempChar ? getEffectiveValue(accessory.id, colorTempChar.type, colorTempChar.value) : null;
  const hue = hueChar ? getEffectiveValue(accessory.id, hueChar.type, hueChar.value) : null;

  const subtitle = isOn && brightness !== null ? `${Math.round(brightness)}% brightness` : null;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={subtitle}
      icon={<Lightbulb className="h-4 w-4" />}
      isOn={isOn}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="lightbulb"
      iconStyle={iconStyle}
      childrenVisible={isOn && !!brightnessChar && accessory.isReachable}
      
      
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
      {brightnessChar && (
        <div className={compact ? "space-y-1.5" : "space-y-4"}>
          <SliderControl
            label="Brightness"
            icon={Sun}
            value={brightness ?? 0}
            min={brightnessChar.characteristic?.minValue ?? 0}
            max={brightnessChar.characteristic?.maxValue ?? 100}
            step={brightnessChar.characteristic?.stepValue ?? 1}
            unit="%"
            onCommit={(v) => onSlider(accessory.id, 'brightness', v)}
            disabled={!accessory.isReachable || !brightnessChar?.isWritable}
            compact={compact}
            trackBgClass="bg-muted/25"
          />

          {!compact && colorTempChar?.isWritable && (
            <div className="space-y-2">
              <SliderControl
                label="Color Temp"
                icon={Palette}
                value={colorTemp ?? (colorTempChar.characteristic?.minValue ?? 140)}
                min={colorTempChar.characteristic?.minValue ?? 140}
                max={colorTempChar.characteristic?.maxValue ?? 500}
                step={colorTempChar.characteristic?.stepValue ?? 10}
                unit="K"
                onCommit={(v) => onSlider(accessory.id, 'color_temperature', v)}
                trackBgClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-orange-200/60 to-sky-200/60" : "bg-muted/25"}
                trackColorClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-orange-400 to-sky-400" : undefined}
                fixedGradient={iconStyle === 'colourful'}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Warm</span>
                <span>Cool</span>
              </div>
            </div>
          )}

          {!compact && hue !== null && (
            <div className="flex items-center gap-2">
              <div
                className="h-6 w-6 rounded-full border border-border"
                style={{ backgroundColor: `hsl(${hue}, ${saturationChar ? getEffectiveValue(accessory.id, 'saturation', saturationChar.value) : 100}%, 50%)` }}
              />
              <span className="text-xs text-muted-foreground">Color active</span>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
});
