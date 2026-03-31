import React, { memo } from 'react';
import { Video } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const CameraWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
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
  // HomeKit Camera Active (preferred) or fallback to generic active
  // 00000225 = HomeKit Camera Active characteristic
  const homekitCameraActiveChar = getCharacteristic(accessory, 'homekit_camera_active')
    || getCharacteristic(accessory, '00000225-0000-1000-8000-0026BB765291');
  const activeChar = homekitCameraActiveChar || getCharacteristic(accessory, 'active');
  const charType = homekitCameraActiveChar ? (homekitCameraActiveChar.type || 'homekit_camera_active') : 'active';
  const rawActive = activeChar ? getEffectiveValue(accessory.id, charType, activeChar.value) : activeChar?.value;
  const isActive = rawActive === true || rawActive === 'true' || rawActive === 1 || rawActive === '1';

  // Motion sensor
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const motionDetected = motionChar?.value === true || motionChar?.value === 'true';

  const hasControls = activeChar?.isWritable;

  // Simple status text
  const getStatusText = () => {
    if (motionDetected) return 'Motion detected';
    if (isActive) return 'Streaming';
    return 'Off';
  };

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={getStatusText()}
      icon={<Video className="h-4 w-4" />}
      serviceType="camera"
      iconStyle={iconStyle}
      isOn={isActive || motionDetected}
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
      headerAction={
        hasControls ? (
          <ColoredSwitch
            checked={isActive}
            onCheckedChange={() => onToggle(accessory.id, 'active', !isActive)}
            disabled={!accessory.isReachable}
          />
        ) : undefined
      }
    />
  );
});
