import React, { memo, useEffect, useState } from 'react';
import { Video, RefreshCw, Loader2, Play, X, Clock3 } from 'lucide-react';
import { WidgetCard, useWidgetColors } from './WidgetCard';
import { WidgetProps, getCharacteristic } from './types';
import { useCameraSnapshot } from '@/hooks/useCameraSnapshot';
import { useCameraLive } from '@/hooks/useCameraLive';
import { useCameraFrameHeight } from '@/hooks/useCameraFrameHeight';
import { describeLiveView } from '@/lib/camera-live';
import { useHomeCamerasEnabled } from '@/hooks/useHomeCamerasEnabled';
import { useCameraTileExpansion } from '@/hooks/useCameraTileExpansion';
import { useExpandedOverlayClose, useExpandedOverlayWidth } from '@/components/shared/ExpandedOverlay';
import { useOverlayViewport } from '@/hooks/useOverlayViewport';
import { prefersImmersiveCamera } from '@/lib/camera-viewer';
import { CameraTileFrame } from './CameraTileFrame';
import { CameraTilePreview } from './CameraTilePreview';
import { describeCameraFailure, describeCaptureAge } from '@/lib/camera-snapshot';
import { isCommunity } from '@/lib/config';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import './camera-feed.css';

// The expanded card's own horizontal padding (px-5, both sides), which the
// image does not get to use.
const CAMERA_PANEL_PADDING_REM = 2.5;
// Narrower than this and the header wraps, pushing the close control away from
// the corner it is looked for in. Measured, not guessed: the name and subtitle
// stop wrapping at 300px with 16px text and at 380px with 20px, so the floor is
// rem and a reader with text turned up gets the wider card they need.
const CAMERA_PANEL_MIN_REM = 19;

/**
 * Header-only dismissal; camera controls stay with the preview below.
 *
 * `onImage` is the immersive layout, where the control sits on the live view
 * rather than on the card: the tile's own palette answers for a card and would
 * hand this a near-black glyph over a night-time doorway.
 */
export function CameraCloseButton({ onImage }: { onImage?: boolean } = {}) {
  const close = useExpandedOverlayClose();
  const { onDark } = useWidgetColors();
  if (!close) return null;
  const light = onImage || onDark;

  return <button type="button" aria-label="Close camera" title="Close" data-camera-close
    onClick={(e) => { e.stopPropagation(); close(); }}
    className={`flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${light ? 'text-white/90 hover:bg-white/10 focus-visible:outline-white' : 'text-slate-900/80 hover:bg-black/5 focus-visible:outline-current'}`}>
    <X className="h-5 w-5" aria-hidden="true" />
  </button>;
}

/**
 * The expanded camera: cached image first, shared live view when supported,
 * otherwise refreshed stills. Neither mode exposes device settings.
 *
 * Cloud relay only: stills are captured by the relay Mac's engine window,
 * which Community mode and iOS do not have. A camera that arrives without the
 * `camera` capability (an older relay) simply has no hero.
 */
export const CameraSnapshotHero: React.FC<{ accessory: HomeKitAccessory; expanded: boolean; immersive?: boolean }> = ({ accessory, expanded, immersive }) => {
  const live = useCameraLive(accessory, expanded);
  const { status, refresh, refreshing } = useCameraSnapshot(accessory, expanded && !live.usesLive);
  const { frameRef, maxHeight, rem } = useCameraFrameHeight(expanded);
  const snapshot = status.kind === 'ready' || status.kind === 'error' ? status : undefined;
  const latest = live.image && (!snapshot?.capturedAt || Date.parse(live.image.capturedAt) >= Date.parse(snapshot.capturedAt)) ? live.image : snapshot;
  const { dataUrl: image, capturedAt, source, width, height } = latest ?? {};
  const liveLabel = describeLiveView(live.phase, live.queuePosition, live.reason);
  const canResume = accessory.camera?.stream && ['error', 'stopped'].includes(live.phase);
  const canRefresh = !live.usesLive && !canResume;
  const portrait = !!width && !!height && height > width;
  const aspect = width && height && width > 0 && height > 0 ? width / height : 16 / 9;
  // The frame is only ever as wide as the height budget allows (see the style
  // below), so asking the panel for more than that strands the image in an
  // empty band — a 212px video centred in a 944px card on a phone held
  // sideways. Ask for what the image can actually fill, floored so the header
  // and the action row still have somewhere to live.
  const frameWidth = maxHeight === undefined ? undefined : maxHeight * aspect;
  const preferredWidth = portrait ? 560 : 960;
  // Immersive: the card IS the image, so it asks for exactly the image's width
  // — no padding to add, and no floor, because there is no header sitting in
  // the flow to be squeezed. The chrome floats on top and rides whatever width
  // the image takes.
  const requestedWidth = immersive
    ? Math.min(preferredWidth, frameWidth ?? preferredWidth)
    : Math.min(preferredWidth, Math.max(CAMERA_PANEL_MIN_REM * rem, (frameWidth ?? preferredWidth) + CAMERA_PANEL_PADDING_REM * rem));
  useExpandedOverlayWidth(expanded ? Math.round(requestedWidth) : undefined);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!expanded) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expanded]);
  const imageAge = capturedAt ? describeCaptureAge(capturedAt, now) : undefined;
  const imageAgeLabel = imageAge ? `${source === 'stream' ? 'Captured' : 'Requested'} ${imageAge}` : undefined;
  const imageAgeTitle = source === 'stream' ? `${imageAgeLabel} · ${capturedAt}`
    : `${imageAgeLabel} · ${capturedAt} — Request time; HomeKit may supply an older image.`;
  const statusLabel = liveLabel ?? (status.kind === 'error' ? describeCameraFailure(status.failure) : image ? 'Snapshot' : 'Loading…');
  const statusDot = live.phase === 'live' ? 'bg-red-400'
    : ['queued', 'connecting', 'error'].includes(live.phase) || status.kind === 'error' ? 'bg-amber-400' : 'bg-white/70';

  return (
    <div className="flex w-full flex-col items-center" data-camera-preview>
      <div ref={frameRef} data-camera-frame className="camera-feed relative max-w-full shrink-0 overflow-hidden rounded-xl bg-black/80"
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
        <div data-camera-toolbar data-camera-feed-overlay
          className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-2 pb-1 pt-8 text-xs leading-4 text-white">
          <div data-camera-status-row className="flex h-11 min-w-0 items-center gap-2 whitespace-nowrap">
            <div className="flex h-11 min-w-0 flex-1 items-center gap-1.5" role="status">
              {canResume || canRefresh ? <button type="button"
                aria-label={canResume ? 'Resume live view' : 'Refresh snapshot'}
                title={canResume ? 'Resume live view' : 'Refresh snapshot'}
                disabled={!canResume && refreshing} aria-busy={!canResume && refreshing}
                onClick={(e) => { e.stopPropagation(); if (canResume) live.resume(); else refresh(); }}
                className="flex h-11 min-w-0 flex-1 items-center gap-1.5 rounded-lg text-left hover:bg-white/10 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white">
                {canResume ? <Play className="h-4 w-4 shrink-0" aria-hidden="true" />
                  : <RefreshCw className={`h-4 w-4 shrink-0 ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true" />}
                <span data-camera-status-label className="min-w-0 truncate" title={statusLabel}>{statusLabel}</span>
              </button> : <>
                <span className={`camera-feed-dot h-1.5 w-1.5 shrink-0 rounded-full ${statusDot}`} aria-hidden="true" />
                <span data-camera-status-label className="min-w-0 truncate" title={statusLabel}>{statusLabel}</span>
              </>}
            </div>
            {live.phase !== 'live' && imageAge && <time dateTime={capturedAt}
              className="camera-feed-age shrink-0 items-center gap-1.5 whitespace-nowrap text-white/80"
              aria-label={imageAgeLabel} title={imageAgeTitle}>
              <Clock3 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{imageAge}
            </time>}
          </div>
        </div>
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
  // Subscribed only while the viewer is open, and it follows the visible
  // viewport rather than `innerHeight`, so rotating the phone — or the URL bar
  // sliding away — re-decides this rather than leaving a stacked card on a
  // screen that no longer has room for one.
  const viewport = useOverlayViewport(preview.expanded);
  const immersive = preview.expanded && prefersImmersiveCamera(viewport);

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
      headerAction={showHero && preview.expanded ? <CameraCloseButton onImage={immersive} /> : undefined}
      onExpandToggle={preview.onExpandToggle}
      onDebug={onDebug}
      heroShape="block"
      heroStack
      heroImmersive={immersive}
      hero={showHero ? <CameraSnapshotHero accessory={accessory} expanded={preview.expanded} immersive={immersive} /> : undefined}



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
