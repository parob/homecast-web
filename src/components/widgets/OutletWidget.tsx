import React, { memo } from 'react';
import { Plug, Zap } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const OutletWidget: React.FC<WidgetProps> = memo(({
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
  const powerChar = getCharacteristic(accessory, 'on') || getCharacteristic(accessory, 'power_state');
  const inUseChar = getCharacteristic(accessory, 'outlet_in_use');

  const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : false;
  const isOn = powerValue === true || powerValue === 1;
  const inUse = inUseChar?.value === true || inUseChar?.value === 1;

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={
        <span className="flex items-center gap-1">
          {isOn ? 'On' : 'Off'}
          {isOn && inUse && (
            <>
              <span className="mx-0.5">·</span>
              <Zap className="h-3 w-3 text-amber-500" />
              <span className="text-amber-600">In use</span>
            </>
          )}
        </span>
      }
      icon={<Plug className="h-4 w-4" />}
      isOn={isOn}
      accessory={accessory}
      isReachable={accessory.isReachable}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="outlet"
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
      headerAction={
        powerChar && (
          <ColoredSwitch
            checked={isOn}
            onCheckedChange={() => onToggle(accessory.id, powerChar.type, isOn)}
            disabled={!accessory.isReachable}
          />
        )
      }
    />
  );
});
