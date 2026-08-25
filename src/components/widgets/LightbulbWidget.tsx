import React, { memo, useState } from 'react';
import { intensityFrom } from '@/lib/widget-tint';
import { Lightbulb, Sun, Palette } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch, ColorControl, VerticalSlider, ColorSwatchRow, mirrorMired, formatMirroredAsKelvin } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const LightbulbWidget: React.FC<WidgetProps> = memo(({
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const powerChar = getCharacteristic(accessory, 'on') || getCharacteristic(accessory, 'power_state');
  const brightnessChar = getCharacteristic(accessory, 'brightness');
  const colorTempChar = getCharacteristic(accessory, 'color_temperature');
  const hueChar = getCharacteristic(accessory, 'hue');
  const saturationChar = getCharacteristic(accessory, 'saturation');

  const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : false;
  const isOn = powerValue === true || powerValue === 1;

  const brightness = brightnessChar ? getEffectiveValue(accessory.id, brightnessChar.type, brightnessChar.value) : null;
  // A bulb that cannot dim has no brightness characteristic, so this is null
  // and the tile paints at full strength — exactly as it did before.
  const intensity = intensityFrom(
    brightness,
    brightnessChar?.characteristic?.minValue,
    brightnessChar?.characteristic?.maxValue,
  );
  const colorTemp = colorTempChar ? getEffectiveValue(accessory.id, colorTempChar.type, colorTempChar.value) : null;
  const hue = hueChar ? getEffectiveValue(accessory.id, hueChar.type, hueChar.value) : null;
  const saturation = saturationChar ? getEffectiveValue(accessory.id, saturationChar.type, saturationChar.value) : null;

  // Off is a state, not the absence of one. A blank line under the name left
  // the tile saying nothing at all about the light, and the switch beside it
  // carrying the whole message on its own.
  const subtitle = isOn
    ? (brightness !== null ? `${Math.round(brightness)}% brightness` : 'On')
    : 'Off';

  const canPickColor = expanded && !!hueChar?.isWritable && !!saturationChar?.isWritable;
  const showHero = expanded && !compact && !!brightnessChar?.isWritable;

  // The bar wears the bulb's own colour, so the control reads as the light
  // rather than as a generic slider. Colour-temperature bulbs get a warm-to-cool
  // approximation of their current temperature instead.
  const heroFill = (() => {
    if (hue !== null && (saturation ?? 0) > 0) {
      return `hsl(${hue} ${saturation}% 55%)`;
    }
    if (colorTemp !== null && colorTempChar) {
      const min = colorTempChar.characteristic?.minValue ?? 140;
      const max = colorTempChar.characteristic?.maxValue ?? 500;
      // HomeKit mireds run cool→warm as the number rises.
      const warmth = max > min ? (colorTemp - min) / (max - min) : 0.5;
      return `hsl(${44 - warmth * 6} ${55 + warmth * 40}% ${62 - warmth * 6}%)`;
    }
    return 'hsl(45 95% 58%)';
  })();

  return (
    <WidgetCard
      heroShape="block"
      hero={showHero ? (
        <div className="h-[240px] w-[132px]">
        <VerticalSlider
          value={brightness ?? 0}
          min={brightnessChar.characteristic?.minValue ?? 0}
          max={brightnessChar.characteristic?.maxValue ?? 100}
          step={brightnessChar.characteristic?.stepValue ?? 1}
          onCommit={(v) => onSlider(accessory.id, 'brightness', v)}
          disabled={!accessory.isReachable}
          icon={Lightbulb}
          label="Brightness"
          fillStyle={{ backgroundColor: heroFill }}
          fillClassName=""
          trackClassName="bg-black/10 tile-ink-track"
          className="h-full text-slate-900 tile-ink"
        />
        </div>
      ) : undefined}
      title={accessory.name}
      subtitle={subtitle}
      icon={<Lightbulb className="h-4 w-4" />}
      isOn={isOn}
      intensity={intensity}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
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
        <div className={compact ? "space-y-1.5" : (expanded ? "space-y-4" : "space-y-4")}>
          {/* The hero bar already reports brightness — a second slider saying
              the same thing would just be clutter. */}
          {!showHero && (
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
          )}

          {!compact && colorTempChar?.isWritable && (() => {
            // Mireds run cool→warm as they rise, so the slider travels on the
            // mirrored axis: warm on the left, cool on the right, matching both
            // the captions below it and Apple Home. See shared/colorTemp.
            const ctMin = colorTempChar.characteristic?.minValue ?? 140;
            const ctMax = colorTempChar.characteristic?.maxValue ?? 500;
            const currentMired = colorTemp ?? ctMin;
            return (
              <div className="space-y-2">
                <SliderControl
                  label="Color Temp"
                  icon={Palette}
                  value={mirrorMired(currentMired, ctMin, ctMax)}
                  min={ctMin}
                  max={ctMax}
                  step={colorTempChar.characteristic?.stepValue ?? 10}
                  formatValue={(v) => formatMirroredAsKelvin(v, ctMin, ctMax)}
                  onCommit={(v) => onSlider(accessory.id, 'color_temperature', mirrorMired(v, ctMin, ctMax))}
                  trackBgClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-orange-200/60 to-sky-200/60" : "bg-muted/25"}
                  trackColorClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-orange-400 to-sky-400" : undefined}
                  fixedGradient={iconStyle === 'colourful'}
                />
                <div className="flex justify-between text-[10px] text-muted-foreground">
                  <span>Warm</span>
                  <span>Cool</span>
                </div>
              </div>
            );
          })()}

          {!compact && hue !== null && (
            canPickColor ? (
              <div className="space-y-3">
                <ColorSwatchRow
                  hue={hue ?? 0}
                  saturation={saturation ?? 0}
                  onSelect={(h, s) => {
                    onSlider(accessory.id, 'hue', h);
                    onSlider(accessory.id, 'saturation', s);
                  }}
                  pickerOpen={pickerOpen}
                  onTogglePicker={() => setPickerOpen(o => !o)}
                  disabled={!accessory.isReachable}
                />
                {pickerOpen && (
                  <ColorControl
                    hue={hue ?? 0}
                    saturation={saturation ?? 0}
                    onCommitHue={(v) => {
                      onSlider(accessory.id, 'hue', v);
                      // At zero saturation the bulb is white and the hue would
                      // not show, so picking a colour has to mean it.
                      if ((saturation ?? 0) === 0) onSlider(accessory.id, 'saturation', 100);
                    }}
                    onCommitSaturation={(v) => onSlider(accessory.id, 'saturation', v)}
                    disabled={!accessory.isReachable}
                  />
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div
                  className="h-6 w-6 rounded-full border border-border"
                  style={{ backgroundColor: `hsl(${hue}, ${saturation ?? 100}%, 50%)` }}
                />
                <span className="text-xs text-muted-foreground">Color active</span>
              </div>
            )
          )}
        </div>
      )}
    </WidgetCard>
  );
});
