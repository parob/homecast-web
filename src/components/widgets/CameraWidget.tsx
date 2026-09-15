import React, { memo } from 'react';
import { Video, RefreshCw, Loader2 } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';
import { useCameraSnapshot } from '@/hooks/useCameraSnapshot';
import { useHomeCamerasEnabled } from '@/hooks/useHomeCamerasEnabled';
import { describeCameraFailure, describeCaptureAge } from '@/lib/camera-snapshot';
import { isCommunity } from '@/lib/config';
import type { HomeKitAccessory } from '@/lib/graphql/types';

/**
 * The expanded tile's still image, refreshed on a cadence.
 *
 * Cloud relay only: stills are captured by the relay Mac's engine window,
 * which Community mode and iOS do not have. A camera that arrives without the
 * `camera` capability (an older relay) simply has no hero.
 */
const CameraSnapshotHero: React.FC<{ accessory: HomeKitAccessory; expanded: boolean }> = ({ accessory, expanded }) => {
  const { status, refresh } = useCameraSnapshot(accessory, expanded);
  const image = status.kind === 'ready' || status.kind === 'error' ? status.dataUrl : undefined;
  const capturedAt = status.kind === 'ready' || status.kind === 'error' ? status.capturedAt : undefined;

  return (
    <div className="relative w-full max-w-[560px] overflow-hidden rounded-xl bg-black/80 aspect-video">
      {image ? (
        <img src={image} alt={`${accessory.name} snapshot`} className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-white/60">
          {status.kind === 'loading' || status.kind === 'idle' ? (
            <Loader2 className="h-6 w-6 animate-spin" />
          ) : (
            <Video className="h-8 w-8" />
          )}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/70 to-transparent px-3 py-2 text-xs text-white/90">
        <span className="truncate">
          {status.kind === 'error'
            ? describeCameraFailure(status.failure)
            : capturedAt
              ? `Captured ${describeCaptureAge(capturedAt)}`
              : 'Taking snapshot…'}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); refresh(); }}
          className="shrink-0 rounded-full bg-white/15 p-1.5 hover:bg-white/25"
          aria-label="Refresh snapshot"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

export const CameraWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
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

  // Stills come from the cloud relay's engine window; nothing else can
  // capture them. Three gates: cloud mode, the relay reports the capability
  // (absent on relays that predate it), and the owner switched cameras on.
  const camerasEnabled = useHomeCamerasEnabled(accessory.homeId);
  const showHero = !compact && !isCommunity && camerasEnabled && accessory.camera?.snapshot === true;

  // Simple status text
  const getStatusText = () => {
    if (motionDetected) return 'Motion detected';
    if (isActive) return 'On';
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
      expanded={expanded}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      heroShape="block"
      heroStack
      hero={showHero ? <CameraSnapshotHero accessory={accessory} expanded={expanded === true} /> : undefined}



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
