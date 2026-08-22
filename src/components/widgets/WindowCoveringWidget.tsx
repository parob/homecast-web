import React, { memo, useState, useRef, useCallback, useEffect } from 'react';
import { Blinds, ChevronUp, ChevronDown, Square, BatteryLow, BatteryMedium, BatteryFull } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { VerticalSlider } from './shared';
import {
  coveringMotion,
  coveringStatusText,
  coveringStopWrite,
  coveringToggleLabel,
  coveringToggleTarget,
  fromOpenness,
  hasDeviceStarted,
  isCommandAbandoned,
  samePosition,
  usesStandardPositionLogic,
} from './shared/coveringStatus';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';
import { getIconColor } from './iconColors';


// Convert position values to numbers, handling edge cases like boolean false or string "false"
const toPositionNumber = (value: any): number => {
  if (value === null || value === undefined || value === false || value === 'false') return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

/**
 * A position we asked for, and what has come back about it since.
 *
 * `from` is where the blind was when we asked, which is the only way to tell a
 * device that has begun moving from one that has merely been written to.
 * `reflected` is whether the optimistic write has appeared in the accessory we
 * render from — until it has, the target says nothing about our command.
 */
interface Command {
  target: number;
  from: number;
  reflected: boolean;
}

/** How long to wait for our own optimistic write to appear before giving up on it. */
const UNREFLECTED_TIMEOUT_MS = 2000;

/** How long a covering may plausibly still be travelling towards what we asked for. */
const IN_FLIGHT_TIMEOUT_MS = 90000;

// Full-width interactive curtain visualization component
const CurtainVisualFull: React.FC<{
  currentPosition: number;
  targetPosition: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  accentColor?: string;
  trackColor?: string;
}> = ({ currentPosition, targetPosition, onChange, disabled, accentColor, trackColor }) => {
  const [dragging, setDragging] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const displayPosition = dragging !== null ? dragging : targetPosition;

  const handleInteraction = useCallback((clientY: number) => {
    if (!containerRef.current || disabled) return;
    const rect = containerRef.current.getBoundingClientRect();
    // Invert: top = 100% open, bottom = 0% closed
    const percentage = Math.max(0, Math.min(100, ((rect.bottom - clientY) / rect.height) * 100));
    const rounded = Math.round(percentage / 5) * 5; // Snap to 5%
    setDragging(rounded);
  }, [disabled]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (disabled) return;
    e.preventDefault();
    handleInteraction(e.clientY);

    const handleMouseMove = (e: MouseEvent) => handleInteraction(e.clientY);
    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      setDragging(prev => {
        if (prev !== null) onChange(prev);
        return null;
      });
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [disabled, handleInteraction, onChange]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (disabled) return;
    const startY = e.touches[0].clientY;
    const startX = e.touches[0].clientX;

    const handleTouchEnd = (e: TouchEvent) => {
      document.removeEventListener('touchend', handleTouchEnd);
      const touch = e.changedTouches[0];
      const deltaX = Math.abs(touch.clientX - startX);
      const deltaY = Math.abs(touch.clientY - startY);
      // Only set position if it was a tap (minimal movement), not a scroll
      if (deltaX < 10 && deltaY < 10) {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const pct = Math.max(0, Math.min(100, ((rect.bottom - touch.clientY) / rect.height) * 100));
        const rounded = Math.round(pct / 5) * 5;
        onChange(rounded);
      }
    };

    document.addEventListener('touchend', handleTouchEnd);
  }, [disabled, onChange]);

  // Curtain closed percentage (inverse of position - 0% open = 100% curtain showing)
  const curtainHeight = 100 - displayPosition;
  // Where the blind actually is, as against where it has been told to go. This
  // panel has always drawn the target — which is why it responded instantly and
  // the hero bar did not — but drawing only the target means a command that
  // never arrives looks identical to one that did. The hairline is the missing
  // half, and the same one the hero bar grew.
  const actualHeight = 100 - currentPosition;
  const showTravel = Math.abs(actualHeight - curtainHeight) > 1;

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full rounded-lg overflow-hidden ${disabled ? 'cursor-not-allowed' : '!cursor-pointer'}`}
      style={{ backgroundColor: trackColor || 'hsl(var(--muted))' }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
    >
      {/* Curtain/blind - drops from top */}
      <div
        className="absolute top-0 left-0 right-0 transition-all duration-300"
        style={{
          height: `${curtainHeight}%`,
          background: accentColor || 'hsl(var(--primary))',
          minHeight: '6px',
        }}
      />

      {/* Where the blind actually is, while it is still on its way there. */}
      {showTravel && (
        <div
          className="absolute inset-x-0 h-px bg-foreground/40 transition-all duration-300"
          style={{ top: `${actualHeight}%` }}
        />
      )}

      {/* Position indicator */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <span className="text-lg font-bold text-foreground/80 drop-shadow-sm">
          {displayPosition === 100 ? 'Open' :
           displayPosition === 0 ? 'Closed' :
           displayPosition >= 50 ? `${Math.round(displayPosition)}% Open` :
           `${Math.round(100 - displayPosition)}% Closed`}
        </span>
      </div>
    </div>
  );
};

export const WindowCoveringWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onSlider,
  onSetValue,
  getEffectiveValue,
  compact,
  expanded,
  onExpandToggle,
  onDebug,

  iconStyle,
  disabled,

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
  // View-only mode: disabled prop indicates view-only (show cursor-not-allowed)
  // Reachability: device offline (show regular disabled state)
  const isViewOnly = disabled && accessory.isReachable;
  const noResponse = !accessory.isReachable;
  const currentPositionChar = getCharacteristic(accessory, 'current_position');
  const targetPositionChar = getCharacteristic(accessory, 'target_position');
  const positionStateChar = getCharacteristic(accessory, 'position_state');

  // Battery info
  const batteryLevelChar = getCharacteristic(accessory, 'battery_level');
  const lowBatteryChar = getCharacteristic(accessory, 'status_low_battery');
  const batteryLevel = batteryLevelChar?.value !== null && batteryLevelChar?.value !== undefined
    ? Number(batteryLevelChar.value) : null;
  const isLowBattery = lowBatteryChar?.value === true || lowBatteryChar?.value === 'true' ||
                       lowBatteryChar?.value === 1 || lowBatteryChar?.value === '1';
  const hasBattery = hasServiceType(accessory, 'battery') || batteryLevelChar !== null || lowBatteryChar !== null;

  // HomeKit window coverings can report position in two ways:
  // Standard: 0 = closed, 100 = open (openness %)
  // Inverted: 0 = open, 100 = closed (coverage %)
  // Most roller blinds/shades use the inverted logic (position = how far down the blind is)
  // Only specific manufacturers use standard logic
  const manufacturerChar = getCharacteristic(accessory, 'manufacturer');
  const modelChar = getCharacteristic(accessory, 'model');
  const manufacturer = String(manufacturerChar?.value || '').toLowerCase();
  const model = String(modelChar?.value || '').toLowerCase();

  const usesStandardLogic = usesStandardPositionLogic(manufacturer, model);

  const rawCurrentPosition = toPositionNumber(currentPositionChar?.value);
  const rawTargetPosition = toPositionNumber(
    targetPositionChar ? getEffectiveValue(accessory.id, 'target_position', targetPositionChar.value) : rawCurrentPosition
  );

  // Most blinds report coverage % (0=open, 100=closed), convert to openness % for display
  // Only skip inversion for manufacturers known to use standard logic
  const currentPosition = usesStandardLogic ? rawCurrentPosition : (100 - rawCurrentPosition);
  const targetPosition = usesStandardLogic ? rawTargetPosition : (100 - rawTargetPosition);
  // 0 = Decreasing, 1 = Increasing, 2 = Stopped. Absent has to mean stopped:
  // parsing a missing characteristic gave 0, which reads as Decreasing, so a
  // blind that simply doesn't publish position_state claimed to be closing for
  // ever.
  const positionState = positionStateChar ? toPositionNumber(positionStateChar.value) : 2;

  const { isMoving, isOpening } = coveringMotion(
    currentPosition,
    targetPosition,
    positionStateChar ? positionState : null,
    usesStandardLogic,
  );

  // The device's own account of moving, kept apart from coveringMotion's — that
  // one deliberately counts an un-started command as motion so the tile can
  // respond at once, which is exactly the thing we need to be able to see past
  // here.
  const deviceMoving = positionStateChar ? positionState !== 2 : false;

  const holdPositionChar = getCharacteristic(accessory, 'hold_position');
  const canHoldPosition = holdPositionChar?.isWritable === true;

  // ── What we asked for, and whether it is happening ──────────────────────
  //
  // The write path is optimistic: target_position lands in the cache before the
  // relay is even called, and is put back if the call fails. That gives the bar
  // its instant response, and takes away any way of telling three very
  // different situations apart — asked and travelling, asked and ignored, and
  // asked and refused all leave the same target sitting in the cache.
  //
  // So remember the command: what we asked for, and where the blind was when we
  // asked. Everything the widget says about latency is derived from those two
  // numbers against what has arrived since.
  const [command, setCommand] = useState<Command | null>(null);
  const [failed, setFailed] = useState(false);

  /** Openness we just wrote — call alongside every target write. */
  const recordCommand = useCallback((targetOpenness: number) => {
    setFailed(false);
    setCommand({ target: targetOpenness, from: currentPosition, reflected: false });
  }, [currentPosition]);

  useEffect(() => {
    if (!command) return;

    // Arrived. The blind is where it was asked to be; nothing left to watch.
    if (samePosition(currentPosition, command.target)) {
      setCommand(null);
      return;
    }

    // Wait for the optimistic write to show up in the accessory before reading
    // anything into the target. It normally lands in the same render — the
    // cache is written before the relay is even called — but "the target is not
    // what I asked for" is indistinguishable from "the target has not caught up
    // yet", and one of those is a false alarm on every single press. Confirming
    // first costs nothing and removes the whole class.
    if (!command.reflected) {
      if (samePosition(targetPosition, command.target)) {
        setCommand(c => (c === command ? { ...c, reflected: true } : c));
        return;
      }
      // Never reflected at all: this surface's write did not reach the cache we
      // are reading. Nothing to watch, and nothing worth reporting either.
      const timer = setTimeout(() => setCommand(null), UNREFLECTED_TIMEOUT_MS);
      return () => clearTimeout(timer);
    }

    // The target was ours and is not any more. Either the write was rejected
    // and reverted by writeCharacteristic, or something else took the blind
    // over; both mean the bar is about to slide somewhere the user did not put
    // it, and it should say so rather than just doing it.
    if (isCommandAbandoned(command.target, targetPosition)) {
      setCommand(null);
      setFailed(true);
      return;
    }

    // Accepted, under way, not there yet. A blind can genuinely take a minute,
    // but past that the command is not in flight any more, it is lost — and a
    // bar that pulses for ever is worse than one that gives up.
    // Cleanup below is the guard the timer needs: it cannot outlive the command
    // that armed it, because any change to one re-runs this effect.
    const timer = setTimeout(() => setCommand(null), IN_FLIGHT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [command, currentPosition, targetPosition]);

  // Clear the failure flash once it has been seen.
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setFailed(false), 600);
    return () => clearTimeout(timer);
  }, [failed]);

  // Out of the door, but the motor has not turned. This is the state the widget
  // had no way to show: "Opening" the instant you press is a useful lie, but it
  // made a blind that never got the message look exactly like one that did.
  const awaitingStart = command !== null
    && !hasDeviceStarted(command.from, currentPosition, deviceMoving);
  const isOpen = currentPosition > 0;
  const hasControls = targetPositionChar?.isWritable;
  // Show expanded controls when not compact and has controls and reachable
  // Still show in view-only mode (but with cursor-not-allowed)
  const showExpanded = !compact && hasControls && accessory.isReachable;
  const showHero = expanded && showExpanded;

  // Get colors based on icon style
  const widgetColors = getIconColor('window_covering');
  const getAccentColor = () => {
    if (iconStyle === 'standard') return 'hsl(var(--primary))';
    return '#8b5cf6'; // violet-500 for colourful mode
  };
  const getTrackColor = () => {
    if (iconStyle === 'standard') return 'hsl(var(--primary) / 0.2)';
    if (iconStyle === 'colourful') return '#ddd6fe'; // violet-200
    return 'hsl(var(--muted))';
  };

  // Button styling based on theme for full view (state-based coloring)
  const getButtonClasses = (isSelected: boolean) => {
    if (iconStyle === 'colourful' && widgetColors) {
      return isSelected
        ? `${widgetColors.accent} text-white border-transparent`
        : `${widgetColors.accentMuted} ${widgetColors.accentMutedHover} border-transparent`;
    }
    // Standard and basic modes use primary color
    return isSelected
      ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
      : 'bg-primary/20 hover:bg-primary/30 border-transparent';
  };

  // Compact button: Close is colored (matching theme), Open is grey.
  // Keyed on where it is heading, not where it is — see coveringToggleLabel.
  const compactToggleLabel = coveringToggleLabel(currentPosition, targetPosition, isMoving);
  const compactToggleTarget = coveringToggleTarget(currentPosition, targetPosition, isMoving);
  const isCompactCloseButton = compactToggleLabel === 'Close';
  const compactButtonClasses = isCompactCloseButton
    ? (iconStyle === 'colourful' && widgetColors ? `${widgetColors.accent} hover:${widgetColors.accent}/90 text-white` : '')
    : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-foreground';

  const statusText = coveringStatusText(isMoving, isOpening, currentPosition, !awaitingStart);

  /**
   * Ask for a position, in openness terms, and remember that we asked.
   *
   * Every control here went through its own `isInvertedBlinds ? 100 - v : v`,
   * which is the kind of expression that is right in five places and inverted
   * in the sixth — and an inverted one drives the blind the wrong way. One door
   * out, and the command bookkeeping cannot be forgotten at a call site because
   * it is on the other side of it.
   */
  const writeTarget = useCallback((openness: number) => {
    if (isViewOnly) return;
    recordCommand(openness);
    onSlider(accessory.id, 'target_position', fromOpenness(openness, usesStandardLogic));
  }, [accessory.id, isViewOnly, onSlider, recordCommand, usesStandardLogic]);

  // hold_position is HomeKit's own answer and plenty of bridges never expose it;
  // it is also write-only, so it needs onSetValue rather than the numeric
  // slider path. Both have to be there to use it — see coveringStopWrite for
  // the fallback, which every covering understands.
  const canStopViaHold = canHoldPosition && !!onSetValue;

  /**
   * Stop where it stands.
   *
   * Mid-travel used to leave one move available — command a different position
   * and wait out the rest of the journey — which is the opposite of what a
   * blind halfway down a window is for. Clears the command rather than
   * recording one: stopping is not a place to arrive at, and watching for
   * arrival at a position the blind is already leaving would flag a phantom
   * failure the moment it coasted past.
   */
  const stopCovering = useCallback(() => {
    if (isViewOnly) return;
    setCommand(null);
    setFailed(false);
    const write = coveringStopWrite(rawCurrentPosition, canStopViaHold);
    if (write.characteristicType === 'hold_position') {
      onSetValue?.(accessory.id, write.characteristicType, write.value);
    } else {
      onSlider(accessory.id, write.characteristicType, write.value as number);
    }
  }, [accessory.id, canStopViaHold, isViewOnly, onSetValue, onSlider, rawCurrentPosition]);

  // How much of the window the blind covers — what you actually see of it.
  //
  // Two of them, and the bar draws both. Drawing only the target made pressing
  // Open snap the whole bar open before the blind had moved an inch; drawing
  // only the current position — the fix for that — meant releasing a drag threw
  // the bar back to a stale reading and crawled it up again, which is worse,
  // because it happens on every single interaction rather than only the
  // dishonest ones. The value is the target, so the bar answers the finger
  // immediately and never slides backwards; the current position rides along as
  // a ghost, so the part that is merely asked for is drawn as asked-for.
  const targetCoverage = 100 - targetPosition;
  const currentCoverage = 100 - currentPosition;

  // Nothing left to ask for. Keyed on the target, not the current position, so
  // Open also goes quiet while the blind is already on its way open — pressing
  // it again would re-send a request that is already in flight.
  const atFullyOpen = targetPosition >= 100;
  const atFullyClosed = targetPosition <= 0;

  const subtitle = (
    <span className="flex items-center gap-2">
      <span className={isMoving ? 'text-primary' : 'text-muted-foreground'}>
        {statusText}
      </span>
      {hasBattery && (
        <span className={`flex items-center gap-0.5 ${isLowBattery ? 'text-red-500' : 'text-muted-foreground'}`}>
          {(() => {
            const BatteryIcon = isLowBattery || (batteryLevel !== null && batteryLevel < 20)
              ? BatteryLow
              : batteryLevel !== null && batteryLevel < 50
                ? BatteryMedium
                : BatteryFull;
            return <BatteryIcon className="h-3 w-3" />;
          })()}
          {batteryLevel !== null && <span className="text-xs">{Math.round(batteryLevel)}%</span>}
        </span>
      )}
    </span>
  );

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={subtitle}
      icon={<Blinds className="h-4 w-4" />}
      isOn={isOpen}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
      heroShape="block"
      // Open and Close are the only secondary controls, so standing the bar
      // beside them left one short row at the top and a panel-height of nothing
      // under it. Stacked, the bar is centred with the two buttons full width
      // beneath — the same shape the thermostat takes.
      heroStack
      hero={showHero ? (
        // The fill is openness, filling upward. Mimicking the blind descending
        // read better in theory and worse in practice: a fully closed blind
        // showed a completely full bar labelled "0% Open", so the picture and
        // the number contradicted each other. Full bar now means wide open.
        //
        // Wider than the beside-the-controls version was: centred in the panel
        // a 132px bar reads as stranded, and this is the control you drag.
        <div className={`h-[240px] w-full max-w-[200px] ${failed ? 'animate-nudge' : ''}`}>
          <VerticalSlider
            // The bar IS the blind: colour is the material, hanging from the top
            // and growing downward as it closes. So it works in coverage, not
            // openness — `invert` anchors the fill to the top and, with it,
            // makes dragging down raise the value. Coverage rising as you drag
            // down is the same gesture as before: pull down to close.
            value={targetCoverage}
            ghostValue={currentCoverage}
            pending={awaitingStart}
            // One write per drag. A blind takes seconds to travel, so the
            // stream of intermediate targets a live commit sends is a stream of
            // re-targetings it can never keep up with — and on a slow link they
            // arrive after the finger has gone, leaving it chasing positions
            // the user passed through on the way to the one they wanted.
            commitMode="release"
            invert
            min={0}
            max={100}
            step={5}
            onCommit={(v) => writeTarget(100 - v)}
            disabled={isViewOnly || noResponse}
            icon={Blinds}
            // A percentage of openness printed on a bar that draws coverage
            // contradicts itself at the ends — "0% Open" across a fully violet
            // bar was why this used to fill upward. At the end stops the readout
            // is the word, which the picture agrees with; in between the number
            // is unambiguous on its own, and the subtitle carries the state.
            formatValue={(v) => {
              const open = Math.round(100 - v);
              return open >= 100 ? 'Open' : open <= 0 ? 'Closed' : `${open}%`;
            }}
            fillClassName="bg-violet-400/80"
            trackClassName="bg-black/10"
            className="h-full text-slate-900"
          />
        </div>
      ) : undefined}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}

      serviceType="window_covering"
      iconStyle={iconStyle}
      childrenVisible={showExpanded}
      
      
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
        hasControls && (!showExpanded) ? (
          <Button
            variant="default"
            size="sm"
            className={`h-7 px-3 text-xs font-medium transition-transform active:scale-95 ${compactButtonClasses} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
            onClick={(e) => {
              e.stopPropagation();
              writeTarget(compactToggleTarget);
            }}
            disabled={noResponse}
          >
            {compactToggleLabel}
          </Button>
        ) : undefined
      }
    >
      {showHero && (
        // The bar handles fine positioning; these are the two places you
        // actually want most of the time — until it is moving, at which point
        // the only thing you want that the bar cannot already do is halt it.
        <div className="flex gap-2">
          {isMoving ? (
            <Button
              variant="outline"
              className={`h-11 flex-1 ${getButtonClasses(false)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
              disabled={noResponse}
              onClick={(e) => {
                e.stopPropagation();
                stopCovering();
              }}
            >
              <Square className="mr-1 h-3.5 w-3.5 fill-current" />
              Stop
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                className={`h-11 flex-1 ${getButtonClasses(atFullyOpen)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
                disabled={noResponse || atFullyOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  writeTarget(100);
                }}
              >
                <ChevronUp className="mr-1 h-4 w-4" />
                Open
              </Button>
              <Button
                variant="outline"
                className={`h-11 flex-1 ${getButtonClasses(atFullyClosed)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
                disabled={noResponse || atFullyClosed}
                onClick={(e) => {
                  e.stopPropagation();
                  writeTarget(0);
                }}
              >
                <ChevronDown className="mr-1 h-4 w-4" />
                Close
              </Button>
            </>
          )}
        </div>
      )}
      {showExpanded && !showHero && (
        <div className={`flex gap-2 -mt-1 ${failed ? 'animate-nudge' : ''}`}>
          <div className={`flex-1 ${expanded ? 'h-32' : 'h-24'}`}>
            <CurtainVisualFull
              currentPosition={currentPosition}
              targetPosition={targetPosition}
              onChange={writeTarget}
              disabled={isViewOnly || noResponse}
              accentColor={getAccentColor()}
              trackColor={getTrackColor()}
            />
          </div>
          {/* Open/Close, or the one control worth having mid-travel. */}
          <div className="flex flex-col gap-1">
            {isMoving ? (
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation();
                  stopCovering();
                }}
                disabled={noResponse}
                aria-label="Stop"
                className={`${expanded ? 'h-11 w-11' : 'h-8 w-8'} p-0 rounded-md ${getButtonClasses(false)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
              >
                <Square className={`fill-current ${expanded ? 'h-4 w-4' : 'h-3 w-3'}`} />
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    writeTarget(100);
                  }}
                  disabled={noResponse || atFullyOpen}
                  aria-label="Open"
                  className={`${expanded ? 'h-11 w-11' : 'h-8 w-8'} p-0 rounded-md ${getButtonClasses(atFullyOpen)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
                >
                  <ChevronUp className={expanded ? 'h-5 w-5' : 'h-4 w-4'} />
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    writeTarget(0);
                  }}
                  disabled={noResponse || atFullyClosed}
                  aria-label="Close"
                  className={`${expanded ? 'h-11 w-11' : 'h-8 w-8'} p-0 rounded-md ${getButtonClasses(atFullyClosed)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
                >
                  <ChevronDown className={expanded ? 'h-5 w-5' : 'h-4 w-4'} />
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    </WidgetCard>
  );
});
