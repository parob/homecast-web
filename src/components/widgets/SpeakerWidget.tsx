import React, { memo } from 'react';
import { Speaker, Volume2, VolumeX, Volume1 } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const SpeakerWidget: React.FC<WidgetProps> = memo(({
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
  const muteChar = getCharacteristic(accessory, 'mute');
  const volumeChar = getCharacteristic(accessory, 'volume');

  const isMuted = muteChar ? getEffectiveValue(accessory.id, 'mute', muteChar.value) === true : false;
  const volume = volumeChar ? getEffectiveValue(accessory.id, 'volume', volumeChar.value) : 50;

  const VolumeIcon = isMuted ? VolumeX : volume > 50 ? Volume2 : Volume1;
  const hasControls = volumeChar?.isWritable;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={isMuted ? 'Muted' : `${Math.round(volume)}% volume`}
      icon={<Speaker className="h-4 w-4" />}
      isOn={!isMuted && volume > 0}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="speaker"
      iconStyle={iconStyle}
      childrenVisible={!isMuted && hasControls && accessory.isReachable}
      
      
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
        muteChar && (
          <ColoredSwitch
            checked={!isMuted}
            onCheckedChange={() => onToggle(accessory.id, 'mute', !isMuted)}
            disabled={!accessory.isReachable}
          />
        )
      }
    >
      {hasControls && (
        <SliderControl
          label="Volume"
          icon={VolumeIcon}
          value={volume}
          min={volumeChar.characteristic?.minValue ?? 0}
          max={volumeChar.characteristic?.maxValue ?? 100}
          step={volumeChar.characteristic?.stepValue ?? 5}
          unit="%"
          onCommit={(v) => onSlider(accessory.id, 'volume', v)}
          compact={compact}
        />
      )}
    </WidgetCard>
  );
});
