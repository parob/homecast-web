import React, { memo, useState, useRef, useCallback } from 'react';
import { Blinds, ChevronUp, ChevronDown, BatteryLow, BatteryMedium, BatteryFull } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic, hasServiceType } from './types';
import { getIconColor } from './iconColors';

const POSITION_STATES = ['Closing', 'Opening', 'Stopped'];

// Convert position values to numbers, handling edge cases like boolean false or string "false"
const toPositionNumber = (value: any): number => {
  if (value === null || value === undefined || value === false || value === 'false') return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

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
  getEffectiveValue,
  compact,
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
  const isUnreachable = !accessory.isReachable;
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

  // These manufacturers use standard HomeKit logic (0=closed, 100=open)
  const usesStandardLogic = manufacturer.includes('lutron') || manufacturer.includes('hunter douglas') ||
                            manufacturer.includes('eve') || model.includes('motionblinds');
  const isInvertedBlinds = !usesStandardLogic;

  const rawCurrentPosition = toPositionNumber(currentPositionChar?.value);
  const rawTargetPosition = toPositionNumber(
    targetPositionChar ? getEffectiveValue(accessory.id, 'target_position', targetPositionChar.value) : rawCurrentPosition
  );

  // Most blinds report coverage % (0=open, 100=closed), convert to openness % for display
  // Only skip inversion for manufacturers known to use standard logic
  const currentPosition = usesStandardLogic ? rawCurrentPosition : (100 - rawCurrentPosition);
  const targetPosition = usesStandardLogic ? rawTargetPosition : (100 - rawTargetPosition);
  const positionState = toPositionNumber(positionStateChar?.value);

  const isMoving = positionState !== 2;
  const isOpen = currentPosition > 0;
  const hasControls = targetPositionChar?.isWritable;
  // Show expanded controls when not compact and has controls and reachable
  // Still show in view-only mode (but with cursor-not-allowed)
  const showExpanded = !compact && hasControls && accessory.isReachable;

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

  // Compact button: Close is colored (matching theme), Open is grey
  const isCompactCloseButton = currentPosition !== 0; // Shows "Close" when not fully closed
  const compactButtonClasses = isCompactCloseButton
    ? (iconStyle === 'colourful' && widgetColors ? `${widgetColors.accent} hover:${widgetColors.accent}/90 text-white` : '')
    : 'bg-zinc-200 hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600 text-foreground';

  // Build subtitle with status and battery
  const getStatusText = () => {
    if (isMoving) return POSITION_STATES[positionState];
    if (currentPosition === 0) return 'Closed';
    if (currentPosition === 100) return 'Open';
    return `${currentPosition}% Open`;
  };

  const subtitle = (
    <span className="flex items-center gap-2">
      <span className={isMoving ? 'text-primary' : 'text-muted-foreground'}>
        {getStatusText()}
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
              if (!isViewOnly) {
                // For inverted blinds: convert from openness % back to coverage %
                const targetValue = currentPosition === 0 ? 100 : 0;
                onSlider(accessory.id, 'target_position', isInvertedBlinds ? (100 - targetValue) : targetValue);
              }
            }}
            disabled={isUnreachable}
          >
            {currentPosition === 0 ? 'Open' : 'Close'}
          </Button>
        ) : undefined
      }
    >
      {showExpanded && (
        <div className="flex gap-2 -mt-1">
          <div className="flex-1 h-24">
            <CurtainVisualFull
              currentPosition={currentPosition}
              targetPosition={targetPosition}
              onChange={(v) => {
                if (!isViewOnly) {
                  // For inverted blinds: convert from openness % back to coverage %
                  onSlider(accessory.id, 'target_position', isInvertedBlinds ? (100 - v) : v);
                }
              }}
              disabled={isViewOnly || isUnreachable}
              accentColor={getAccentColor()}
              trackColor={getTrackColor()}
            />
          </div>
          {/* Up/Down buttons */}
          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                // Open fully (100% open = 0% coverage for inverted blinds)
                if (!isViewOnly) onSlider(accessory.id, 'target_position', isInvertedBlinds ? 0 : 100);
              }}
              disabled={isUnreachable}
              className={`h-8 w-8 p-0 rounded-md ${getButtonClasses(targetPosition === 0)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
            >
              <ChevronUp className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                // Close fully (0% open = 100% coverage for inverted blinds)
                if (!isViewOnly) onSlider(accessory.id, 'target_position', isInvertedBlinds ? 100 : 0);
              }}
              disabled={isUnreachable}
              className={`h-8 w-8 p-0 rounded-md ${getButtonClasses(targetPosition === 100)} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
            >
              <ChevronDown className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </WidgetCard>
  );
});
