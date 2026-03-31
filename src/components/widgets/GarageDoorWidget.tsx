import React, { memo } from 'react';
import { Warehouse, ChevronUp, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic } from './types';

const POSITION_STATES = ['Closing', 'Opening', 'Stopped'];

export const GarageDoorWidget: React.FC<WidgetProps> = memo(({
  accessory,
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
  const currentPositionChar = getCharacteristic(accessory, 'current_position');
  const targetPositionChar = getCharacteristic(accessory, 'target_position');
  const positionStateChar = getCharacteristic(accessory, 'position_state');

  const currentPosition = currentPositionChar?.value ?? 0;
  const targetPosition = targetPositionChar ? getEffectiveValue(accessory.id, 'target_position', targetPositionChar.value) : currentPosition;
  const positionState = positionStateChar?.value ?? 2;

  const isMoving = positionState !== 2;
  const isOpen = currentPosition > 0;
  const isFullyOpen = currentPosition >= 100;
  const isFullyClosed = currentPosition <= 0;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-1">
          <span>{isFullyOpen ? 'Open' : isFullyClosed ? 'Closed' : `${currentPosition}% open`}</span>
          {isMoving && (
            <>
              <span className="mx-0.5">·</span>
              <span className="text-primary animate-pulse">{POSITION_STATES[positionState]}</span>
            </>
          )}
        </span>
      }
      icon={<Warehouse className="h-4 w-4" />}
      isOn={isOpen}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="garage_door"
      iconStyle={iconStyle}
      
      
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
          {/* Visual garage door indicator */}
          <div className="relative h-24 bg-muted rounded-lg overflow-hidden border-4 border-muted-foreground/20">
            {/* Door panels */}
            <div className="absolute inset-x-2 top-2 bottom-2 flex flex-col gap-1">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className={`flex-1 rounded-sm transition-all duration-500 ${
                    (100 - currentPosition) > (i * 25) ? 'bg-muted-foreground/30' : 'bg-transparent'
                  }`}
                />
              ))}
            </div>
            {/* Status overlay */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-lg font-bold bg-background/80 px-2 py-1 rounded">
                {isFullyOpen ? 'OPEN' : isFullyClosed ? 'CLOSED' : `${currentPosition}%`}
              </span>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-2">
            <Button
              variant={isFullyClosed ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => onSlider(accessory.id, 'target_position', 0)}
              disabled={!accessory.isReachable || isFullyClosed}
            >
              <ChevronDown className="h-4 w-4 mr-1" />
              Close
            </Button>
            <Button
              variant={isFullyOpen ? 'default' : 'outline'}
              size="sm"
              className="flex-1"
              onClick={() => onSlider(accessory.id, 'target_position', 100)}
              disabled={!accessory.isReachable || isFullyOpen}
            >
              <ChevronUp className="h-4 w-4 mr-1" />
              Open
            </Button>
          </div>
        </div>
      )}
    </WidgetCard>
  );
});
