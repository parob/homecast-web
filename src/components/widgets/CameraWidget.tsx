import React, { memo, useEffect, useState } from 'react';
import { Video, RefreshCw, Loader2, X } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';
import { useCameraSnapshot } from '@/hooks/useCameraSnapshot';
import { useHomeCamerasEnabled } from '@/hooks/useHomeCamerasEnabled';
import { useCameraTileExpansion } from '@/hooks/useCameraTileExpansion';
import { useExpandedOverlayClose, useExpandedOverlayWidth } from '@/components/shared/ExpandedOverlay';
import { CameraTileFrame } from './CameraTileFrame';
import { CameraTilePreview } from './CameraTilePreview';
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
export const CameraSnapshotHero: React.FC<{ accessory: HomeKitAccessory; expanded: boolean }> = ({ accessory, expanded }) => {
  const { status, refresh, refreshing } = useCameraSnapshot(accessory, expanded);
  const close = useExpandedOverlayClose();
  const image = status.kind === 'ready' || status.kind === 'error' ? status.dataUrl : undefined;
  const capturedAt = status.kind === 'ready' || status.kind === 'error' ? status.capturedAt : undefined;
  const source = status.kind === 'ready' || status.kind === 'error' ? status.source : undefined;
  const width = status.kind === 'ready' || status.kind === 'error' ? status.width : undefined;
  const height = status.kind === 'ready' || status.kind === 'error' ? status.height : undefined;
  const portrait = !!width && !!height && height > width;
  const aspect = width && height && width > 0 && height > 0 ? width / height : 16 / 9;
  useExpandedOverlayWidth(expanded ? (portrait ? 560 : 960) : undefined);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expanded) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expanded]);
  const imageAge = capturedAt
    ? `${source === 'stream' ? 'Captured' : 'Requested'} ${describeCaptureAge(capturedAt, now)}`
    : undefined;

  return (
    <div className="flex w-full flex-col items-center gap-2" data-camera-preview>
      <div className="relative flex max-w-full flex-col overflow-hidden rounded-xl bg-black/80"
        style={{ width: `min(100%, calc((100dvh - 220px) * ${aspect}))` }}>
        {image ? (
          <img src={image} alt={`${accessory.name} snapshot`} width={width} height={height}
            className="block h-auto w-full max-w-full object-contain" draggable={false} />
        ) : (
          <div className="flex h-56 w-[min(80vw,880px)] max-w-full items-center justify-center text-white/60">
            {status.kind === 'loading' || status.kind === 'idle' ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Video className="h-8 w-8" />
            )}
          </div>
        )}
      </div>
        <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-black/80 px-3 py-1 text-xs text-white/90">
          <span className="min-w-0">
            {status.kind === 'error' ? <>
              {describeCameraFailure(status.failure)}
              {imageAge && <span className="mt-1 block text-white/65">Last image: {imageAge.toLowerCase()}</span>}
            </> : imageAge || 'Taking snapshot…'}
          </span>
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              disabled={refreshing}
              onClick={(e) => { e.stopPropagation(); refresh(); }}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-60"
              aria-label="Refresh snapshot"
              aria-busy={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
            {close && <button type="button" aria-label="Close camera"
              onClick={(e) => { e.stopPropagation(); close(); }}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15">
              <X className="h-4 w-4" />
            </button>}
          </div>
        </div>
      {image && source !== 'stream' && <p className="text-center text-xs text-muted-foreground">
        HomeKit may return an older image. This time is when it was requested.
      </p>}
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
  // Only HomeKit Camera Active controls camera availability. Generic `active`
  // belongs to recording management, and 0x225 controls periodic snapshots.
  // Neither is a camera power switch. HomeKit may omit the active value too:
  // unknown must never be presented as Off or used to offer a blind toggle.
  const activeChar = getCharacteristic(accessory, 'homekit_camera_active')
    || getCharacteristic(accessory, '0000021D-0000-1000-8000-0026BB765291');
  const charType = activeChar?.type || 'homekit_camera_active';
  const rawActive = activeChar ? getEffectiveValue(accessory.id, charType, activeChar.value) : undefined;
  const isActive = rawActive === true || rawActive === 'true' || rawActive === 1 || rawActive === '1';
  const isInactive = rawActive === false || rawActive === 'false' || rawActive === 0 || rawActive === '0';

  // Motion sensor
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const motionDetected = motionChar?.value === true || motionChar?.value === 'true';

  const hasControls = activeChar?.isWritable && (isActive || isInactive);

  // Stills come from the cloud relay's engine window; nothing else can
  // capture them. Three gates: cloud mode, the relay reports the capability
  // (absent on relays that predate it), and the owner switched cameras on.
  const camerasEnabled = useHomeCamerasEnabled(accessory.homeId);
  const cameraAvailable = !isCommunity && camerasEnabled && accessory.camera?.snapshot === true;
  const showHero = !compact && cameraAvailable;
  const preview = useCameraTileExpansion({ previewAvailable: showHero, compact, expanded, onExpandToggle });

  // Simple status text
  const getStatusText = () => {
    if (motionDetected) return 'Motion detected';
    if (isActive) return 'On';
    return isInactive ? 'Off' : 'Camera';
  };

  return (
    <CameraTileFrame preview={preview}>
    <WidgetCard
      title={accessory.name}
      subtitle={getStatusText()}
      icon={<Video className="h-4 w-4" />}
      serviceType="camera"
      iconStyle={iconStyle}
      isOn={isActive || motionDetected}
      isReachable={accessory.isReachable}
      accessory={accessory}
      collapsedPreview={cameraAvailable ? <CameraTilePreview accessory={accessory} paused={preview.expanded || editMode || isHidden} /> : undefined}
      compact={compact}
      expanded={preview.expanded}
      onExpandToggle={preview.onExpandToggle}
      onDebug={onDebug}
      heroShape="block"
      heroStack
      hero={showHero ? <CameraSnapshotHero accessory={accessory} expanded={preview.expanded} /> : undefined}



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
            onCheckedChange={() => onToggle(accessory.id, charType, isActive)}
            disabled={!accessory.isReachable}
          />
        ) : undefined
      }
    />
    </CameraTileFrame>
  );
});
