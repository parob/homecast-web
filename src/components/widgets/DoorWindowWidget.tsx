import React, { memo } from 'react';
import { DoorOpen, DoorClosed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { SliderControl } from './shared';
import { WidgetProps, getCharacteristic } from './types';

interface DoorWindowWidgetProps extends WidgetProps {
  deviceType: 'door' | 'window';
}

const POSITION_STATES = ['Closing', 'Opening', 'Stopped'];

export const DoorWindowWidget: React.FC<DoorWindowWidgetProps> = memo(({
  accessory,
  onSlider,
  getEffectiveValue,
  deviceType,
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
  const currentPositionChar = getCharacteristic(accessory, 'current_position');
  const targetPositionChar = getCharacteristic(accessory, 'target_position');
  const positionStateChar = getCharacteristic(accessory, 'position_state');

  const currentPosition = currentPositionChar?.value ?? 0;
  const targetPosition = targetPositionChar ? getEffectiveValue(accessory.id, 'target_position', targetPositionChar.value) : currentPosition;
  const positionState = positionStateChar?.value ?? 2;

  const isMoving = positionState !== 2;
  const isOpen = currentPosition > 0;
  const isFullyOpen = currentPosition >= 100;

  const Icon = isOpen ? DoorOpen : DoorClosed;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-1">
          <span>{isFullyOpen ? 'Open' : currentPosition === 0 ? 'Closed' : `${currentPosition}% open`}</span>
          {isMoving && (
            <>
              <span className="mx-0.5">·</span>
              <span className="text-primary">{POSITION_STATES[positionState]}</span>
            </>
          )}
        </span>
      }
      icon={<Icon className="h-4 w-4" />}
      serviceType={deviceType}
      iconStyle={iconStyle}
      isOn={isOpen}
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
    >
      {targetPositionChar?.isWritable && (
        <div className="space-y-4">
          <SliderControl
            label="Position"
            value={targetPosition}
            min={targetPositionChar.characteristic?.minValue ?? 0}
            max={targetPositionChar.characteristic?.maxValue ?? 100}
            step={targetPositionChar.characteristic?.stepValue ?? 5}
            unit="%"
            onCommit={(v) => onSlider(accessory.id, 'target_position', v)}
          />

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onSlider(accessory.id, 'target_position', 0)}
              disabled={!accessory.isReachable}
            >
              <DoorClosed className="h-3 w-3 mr-1" />
              Close
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => onSlider(accessory.id, 'target_position', 100)}
              disabled={!accessory.isReachable}
            >
              <DoorOpen className="h-3 w-3 mr-1" />
              Open
            </Button>
          </div>
        </div>
      )}
    </WidgetCard>
  );
});
