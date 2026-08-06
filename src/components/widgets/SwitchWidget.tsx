import React, { memo } from 'react';
import { Power } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { getIconColor } from './iconColors';
import { ColoredSwitch, VerticalToggle } from './shared';
import { WidgetProps, getCharacteristic } from './types';

export const SwitchWidget: React.FC<WidgetProps> = memo(({
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
  const powerChar = getCharacteristic(accessory, 'on') || getCharacteristic(accessory, 'power_state');

  const powerValue = powerChar ? getEffectiveValue(accessory.id, powerChar.type, powerChar.value) : false;
  const isOn = powerValue === true || powerValue === 1;

  // The rocker replaces the header switch in the expanded panel — two
  // controls for one thing reads as a bug.
  const showHero = !!expanded && !compact && !!powerChar;
  const accentClass = getIconColor('switch')?.accent ?? 'bg-primary';

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={isOn ? 'On' : 'Off'}
      icon={<Power className="h-4 w-4" />}
      isOn={isOn}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
      heroShape="block"
      hero={showHero ? (
        <VerticalToggle
          checked={isOn}
          onChange={() => onToggle(accessory.id, powerChar!.type, isOn)}
          disabled={!accessory.isReachable}
          icon={Power}
          activeClassName={iconStyle === 'colourful' ? accentClass : 'bg-primary'}
        />
      ) : undefined}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="switch"
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
        powerChar && !showHero && (
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
