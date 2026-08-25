import React, { memo } from 'react';
import { intensityFrom } from '@/lib/widget-tint';
import { Droplets, CloudRain, Sun, Gauge } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch, VerticalSlider } from './shared';
import { WidgetProps, getCharacteristic } from './types';

const TARGET_STATES = ['Humidifier & Dehumidifier', 'Humidifier', 'Dehumidifier'];
const CURRENT_STATES = ['Inactive', 'Idle', 'Humidifying', 'Dehumidifying'];

export const HumidifierWidget: React.FC<WidgetProps> = memo(({
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
  const activeChar = getCharacteristic(accessory, 'active');
  const currentStateChar = getCharacteristic(accessory, 'current_humidifier_dehumidifier_state');
  const targetStateChar = getCharacteristic(accessory, 'target_humidifier_dehumidifier_state');
  const currentHumidityChar = getCharacteristic(accessory, 'relative_humidity');
  const targetHumidityChar = getCharacteristic(accessory, 'target_humidity');
  const speedChar = getCharacteristic(accessory, 'rotation_speed');
  const waterLevelChar = getCharacteristic(accessory, 'water_level');

  const isActive = activeChar ? getEffectiveValue(accessory.id, 'active', activeChar.value) === true : false;
  const currentState = currentStateChar?.value ?? 0;
  const targetState = targetStateChar ? getEffectiveValue(accessory.id, 'target_humidifier_dehumidifier_state', targetStateChar.value) : 0;
  const currentHumidity = currentHumidityChar?.value;
  const targetHumidity = targetHumidityChar ? getEffectiveValue(accessory.id, 'target_humidity', targetHumidityChar.value) : null;
  const speed = speedChar ? getEffectiveValue(accessory.id, 'rotation_speed', speedChar.value) : null;
  const intensity = intensityFrom(
    speed,
    speedChar?.characteristic?.minValue,
    speedChar?.characteristic?.maxValue,
  );
  const waterLevel = waterLevelChar?.value;

  const isHumidifying = currentState === 2;
  const isDehumidifying = currentState === 3;

  const StateIcon = isHumidifying ? CloudRain : isDehumidifying ? Sun : Droplets;
  const hasControls = targetStateChar?.isWritable || targetHumidityChar?.isWritable || speedChar?.isWritable;

  const showHero = !!expanded && !compact && !!targetHumidityChar?.isWritable && isActive;

  return (
    <WidgetCard
      heroShape="block"
      hero={showHero ? (
        <div className="h-[240px] w-[132px]">
          <VerticalSlider
            value={targetHumidity ?? 50}
            min={targetHumidityChar.characteristic?.minValue ?? 0}
            max={targetHumidityChar.characteristic?.maxValue ?? 100}
            step={targetHumidityChar.characteristic?.stepValue ?? 5}
            onCommit={(v) => onSlider(accessory.id, 'target_humidity', v)}
            disabled={!accessory.isReachable}
            icon={Droplets}
            label="Target Humidity"
            fillClassName="bg-sky-400/80"
            trackClassName="bg-black/10"
            className="h-full text-slate-900"
          />
        </div>
      ) : undefined}
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-2">
          {currentHumidity !== null && currentHumidity !== undefined && (
            <span className="text-lg font-semibold text-foreground">{Math.round(currentHumidity)}%</span>
          )}
          {isActive && currentState > 0 && (
            <Badge variant={isHumidifying ? 'default' : isDehumidifying ? 'secondary' : 'outline'} className="text-[10px] px-1.5 py-0">
              {CURRENT_STATES[currentState]}
            </Badge>
          )}
          {waterLevel !== null && waterLevel !== undefined && (
            <span className={`text-xs ${waterLevel < 20 ? 'text-amber-500' : 'text-muted-foreground'}`}>
              Water: {Math.round(waterLevel)}%
            </span>
          )}
        </span>
      }
      icon={<StateIcon className={`h-4 w-4 ${isActive && currentState > 1 ? 'animate-pulse' : ''}`} />}
      serviceType="humidifier_dehumidifier"
      iconStyle={iconStyle}
      isOn={isActive && currentState > 1}
      intensity={intensity}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
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
            <div className="flex gap-1">
              {[1, 2].map((index) => (
                <button
                  key={TARGET_STATES[index]}
                  onClick={() => onSlider(accessory.id, 'target_humidifier_dehumidifier_state', index)}
                  className={`flex-1 ${expanded ? 'py-3 text-sm' : 'py-2 text-xs'} px-2 rounded-lg font-medium transition-all flex items-center justify-center gap-1 ${
                    targetState === index
                      ? 'bg-primary text-primary-foreground cursor-default'
                      : 'bg-muted hover:bg-muted/80'
                  }`}
                  // Already in this mode: shown, not offered.
                  disabled={!accessory.isReachable || targetState === index}
                >
                  {index === 1 ? <CloudRain className={expanded ? 'h-4 w-4' : 'h-3 w-3'} /> : <Sun className={expanded ? 'h-4 w-4' : 'h-3 w-3'} />}
                  {index === 1 ? 'Humidify' : 'Dehumidify'}
                </button>
              ))}
            </div>
          )}

          {targetHumidityChar?.isWritable && !showHero && (
            <SliderControl
              label="Target Humidity"
              value={targetHumidity ?? 50}
              min={targetHumidityChar.characteristic?.minValue ?? 0}
              max={targetHumidityChar.characteristic?.maxValue ?? 100}
              step={targetHumidityChar.characteristic?.stepValue ?? 5}
              unit="%"
              onCommit={(v) => onSlider(accessory.id, 'target_humidity', v)}
            />
          )}

          {speedChar?.isWritable && (
            <SliderControl
              label="Speed"
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
