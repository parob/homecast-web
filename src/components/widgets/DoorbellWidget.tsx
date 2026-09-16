import React, { memo } from 'react';
import { Bell, Video, Battery, BatteryLow, BatteryWarning } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';
import { CameraCloseButton, CameraSnapshotHero } from './CameraWidget';
import { useHomeCamerasEnabled } from '@/hooks/useHomeCamerasEnabled';
import { useCameraTileExpansion } from '@/hooks/useCameraTileExpansion';
import { CameraTileFrame } from './CameraTileFrame';
import { CameraTilePreview } from './CameraTilePreview';
import { isCommunity } from '@/lib/config';

export const DoorbellWidget: React.FC<WidgetProps> = memo(({
  accessory,
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
  const hasCamera = accessory.camera?.snapshot === true || accessory.camera?.stream === true;
  const camerasEnabled = useHomeCamerasEnabled(accessory.homeId);
  const cameraAvailable = !isCommunity && camerasEnabled && hasCamera;
  const showHero = !compact && cameraAvailable;
  const preview = useCameraTileExpansion({ previewAvailable: showHero, compact, expanded, onExpandToggle });
  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = typeof batteryLevelChar?.value === 'number' ? batteryLevelChar.value :
                       (batteryLevelChar?.value ? Number(batteryLevelChar.value) : null);
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' || lowBatteryChar?.value === 1;
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;

  // Motion sensor (many doorbells have built-in motion)
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const hasMotion = motionChar?.value === true || motionChar?.value === 'true';

  // Get battery icon
  const BatteryIcon = isLowBattery ? BatteryLow : (batteryLevel !== null && batteryLevel < 30 ? BatteryWarning : Battery);

  return (
    <CameraTileFrame preview={preview}>
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className={`flex items-center gap-x-2 gap-y-0.5 ${cameraAvailable && !preview.expanded ? 'min-w-0 overflow-hidden' : 'flex-wrap'}`}>
          <span className={`text-muted-foreground ${cameraAvailable && !preview.expanded ? 'min-w-0 truncate' : ''}`}>{hasCamera ? 'Doorbell camera' : 'Doorbell'}</span>
          {hasBattery && (
            <span className={`flex shrink-0 items-center gap-0.5 ${isLowBattery ? 'text-amber-500' : 'text-muted-foreground'}`}>
              <BatteryIcon className="h-3 w-3" />
              {batteryLevel !== null && <span>{Math.round(batteryLevel)}%</span>}
            </span>
          )}
        </span>
      }
      icon={hasCamera ? <Video className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      serviceType="doorbell"
      iconStyle={iconStyle}
      isOn={hasMotion}
      isReachable={accessory.isReachable}
      accessory={accessory}
      collapsedPreview={cameraAvailable ? <CameraTilePreview accessory={accessory} paused={preview.expanded || editMode || !!editModeType || isHidden || isHiddenUi} /> : undefined}
      compact={compact}
      expanded={preview.expanded}
      headerAction={showHero && preview.expanded ? <CameraCloseButton /> : undefined}
      heroShape="block"
      heroStack
      hero={showHero ? <CameraSnapshotHero accessory={accessory} expanded={preview.expanded} /> : undefined}
      onExpandToggle={preview.onExpandToggle}
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
    />
    </CameraTileFrame>
  );
});
