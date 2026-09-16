import React, { memo, useEffect, useState } from 'react';
import { Video, RefreshCw, Loader2, Play, X } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic } from './types';
import { useCameraSnapshot } from '@/hooks/useCameraSnapshot';
import { useCameraLive } from '@/hooks/useCameraLive';
import { useCameraFrameHeight } from '@/hooks/useCameraFrameHeight';
import { describeLiveView } from '@/lib/camera-live';
import { useHomeCamerasEnabled } from '@/hooks/useHomeCamerasEnabled';
import { useCameraTileExpansion } from '@/hooks/useCameraTileExpansion';
import { useExpandedOverlayClose, useExpandedOverlayWidth } from '@/components/shared/ExpandedOverlay';
import { CameraTileFrame } from './CameraTileFrame';
import { CameraTilePreview } from './CameraTilePreview';
import { describeCameraFailure, describeCaptureAge } from '@/lib/camera-snapshot';
import { isCommunity } from '@/lib/config';
import type { HomeKitAccessory } from '@/lib/graphql/types';

/**
 * The expanded camera: cached image first, shared live view when supported,
 * otherwise refreshed stills. Neither mode exposes device settings.
 *
 * Cloud relay only: stills are captured by the relay Mac's engine window,
 * which Community mode and iOS do not have. A camera that arrives without the
 * `camera` capability (an older relay) simply has no hero.
 */
export const CameraSnapshotHero: React.FC<{ accessory: HomeKitAccessory; expanded: boolean }> = ({ accessory, expanded }) => {
  const live = useCameraLive(accessory, expanded);
  const { status, refresh, refreshing } = useCameraSnapshot(accessory, expanded && !live.usesLive);
  const close = useExpandedOverlayClose();
  const { frameRef, maxHeight } = useCameraFrameHeight(expanded);
  const snapshot = status.kind === 'ready' || status.kind === 'error' ? status : undefined;
  const latest = live.image && (!snapshot?.capturedAt || Date.parse(live.image.capturedAt) >= Date.parse(snapshot.capturedAt)) ? live.image : snapshot;
  const { dataUrl: image, capturedAt, source, width, height } = latest ?? {};
  const liveLabel = describeLiveView(live.phase, live.queuePosition, live.reason);
  const canResume = accessory.camera?.stream && ['error', 'stopped'].includes(live.phase);
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
        <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-black/80 p-2 text-xs text-white/90" data-camera-toolbar>
          <span className="min-w-0">
            {liveLabel ? <span>
              {live.phase === 'live' && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-400" aria-hidden="true" />}
              {liveLabel}
            </span> : status.kind === 'error' ? describeCameraFailure(status.failure) : !imageAge && 'Loading…'}
            {live.phase !== 'live' && imageAge && <time dateTime={capturedAt}
              className={liveLabel || status.kind === 'error' ? 'mt-0.5 block text-white/65' : ''}
              title={source === 'stream' ? capturedAt : 'Request time — HomeKit may supply an older image.'}>
              {imageAge}
            </time>}
          </span>
          <div className="flex shrink-0 gap-1">
            {canResume && <button type="button" aria-label="Resume live view"
              onClick={(e) => { e.stopPropagation(); live.resume(); }}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
              <Play className="h-4 w-4" aria-hidden="true" />Resume
            </button>}
            {!live.usesLive && !canResume && <button
              type="button"
              disabled={refreshing}
              onClick={(e) => { e.stopPropagation(); refresh(); }}
              className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/15 disabled:opacity-60"
              aria-label="Refresh snapshot"
              aria-busy={refreshing}
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
            </button>}
            {close && <button type="button" aria-label="Close camera"
              onClick={(e) => { e.stopPropagation(); close(); }}
              className="flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-white px-3 font-medium text-slate-950 shadow-sm hover:bg-white/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
              <X className="h-5 w-5" aria-hidden="true" />Close
            </button>}
          </div>
        </div>
      <div ref={frameRef} data-camera-frame className="relative max-w-full shrink-0 overflow-hidden rounded-xl bg-black/80"
        style={{ width: `min(100%, calc(${maxHeight === undefined ? 'max(0px, 100dvh - 180px)' : `${maxHeight}px`} * ${aspect}))`, aspectRatio: aspect }}>
        {image ? (
          <img src={image} alt={`${accessory.name} ${live.phase === 'live' ? 'live view' : 'snapshot'}`} width={width} height={height}
            className="absolute inset-0 h-full w-full max-w-full object-contain" draggable={false} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-white/60">
            {status.kind === 'loading' || status.kind === 'idle' ? (
              <Loader2 className="h-6 w-6 animate-spin" />
            ) : (
              <Video className="h-8 w-8" />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export const CameraWidget: React.FC<WidgetProps> = memo(({
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
  // Motion sensor
  const motionChar = getCharacteristic(accessory, 'motion_detected');
  const motionDetected = motionChar?.value === true || motionChar?.value === 'true';

  // Stills come from the cloud relay's engine window; nothing else can
  // capture them. Three gates: cloud mode, the relay reports the capability
  // (absent on relays that predate it), and the owner switched cameras on.
  const camerasEnabled = useHomeCamerasEnabled(accessory.homeId);
  const cameraAvailable = !isCommunity && camerasEnabled && (accessory.camera?.snapshot === true || accessory.camera?.stream === true);
  const showHero = !compact && cameraAvailable;
  const preview = useCameraTileExpansion({ previewAvailable: showHero, compact, expanded, onExpandToggle });

  return (
    <CameraTileFrame preview={preview}>
    <WidgetCard
      title={accessory.name}
      subtitle={motionDetected ? 'Motion detected' : 'Camera'}
      icon={<Video className="h-4 w-4" />}
      serviceType="camera"
      iconStyle={iconStyle}
      isOn={motionDetected}
      isReachable={accessory.isReachable}
      accessory={accessory}
      collapsedPreview={cameraAvailable ? <CameraTilePreview accessory={accessory} paused={preview.expanded || editMode || !!editModeType || isHidden || isHiddenUi} /> : undefined}
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
    />
    </CameraTileFrame>
  );
});
