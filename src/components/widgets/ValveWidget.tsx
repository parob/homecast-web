import React, { memo } from 'react';
import { Droplets } from 'lucide-react';
import { WidgetCard } from './WidgetCard';
import { SliderControl, ColoredSwitch, CircleControl } from './shared';
import { WidgetProps, getCharacteristic } from './types';

const VALVE_TYPES = ['Generic', 'Irrigation', 'Shower Head', 'Water Faucet'];

export const ValveWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
  expanded,
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
  const activeChar = getCharacteristic(accessory, 'active');
  const inUseChar = getCharacteristic(accessory, 'in_use');
  const valveTypeChar = getCharacteristic(accessory, 'valve_type');
  const durationChar = getCharacteristic(accessory, 'set_duration');
  const remainingChar = getCharacteristic(accessory, 'remaining_duration');

  const isActive = activeChar ? getEffectiveValue(accessory.id, 'active', activeChar.value) === true : false;
  const inUse = inUseChar?.value === true || inUseChar?.value === 1;
  const valveType = valveTypeChar?.value ?? 0;
  const duration = durationChar ? getEffectiveValue(accessory.id, 'set_duration', durationChar.value) : null;
  const remaining = remainingChar?.value;

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  };

  const typeLabel = VALVE_TYPES[valveType] || 'Valve';

  const showHero = !!expanded && !compact && !!activeChar?.isWritable;

  return (
    <WidgetCard
      heroShape="block"
      expanded={expanded}
      hero={showHero ? (
        <CircleControl
          icon={Droplets}
          isActive={isActive}
          label={isActive ? 'Running' : 'Off'}
          onPress={() => onToggle(accessory.id, 'active', isActive)}
          disabled={!accessory.isReachable}
          activeClassName="bg-sky-500 text-white"
        />
      ) : undefined}
      title={accessory.name}
      // Plain text, like every other tile. A filled badge made this the one
      // widget wearing a chip under its name, and what the chip said was the
      // valve type — which on a valve actually called "Irrigation" was the
      // name again. State first, as everywhere else; the type only earns a
      // place when it tells you something the name hasn't already.
      subtitle={[
        inUse ? 'Running' : 'Off',
        // "Garden Irrigation" is shown as "Irrigation" once the card strips the
        // room, so match the tail rather than the whole name — otherwise the
        // subtitle repeats the title back at you.
        accessory.name.trim().toLowerCase().endsWith(typeLabel.toLowerCase()) ? null : typeLabel,
        inUse && remaining ? formatDuration(remaining) : null,
      ].filter(Boolean).join(' · ')}
      icon={<Droplets className={`h-4 w-4 ${inUse ? 'text-blue-500' : ''}`} />}
      serviceType="valve"
      iconStyle={iconStyle}
      isOn={inUse}
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
      headerAction={!showHero &&
        activeChar?.isWritable && (
          <ColoredSwitch
            checked={isActive}
            onCheckedChange={() => onToggle(accessory.id, 'active', isActive)}
            disabled={!accessory.isReachable}
          />
        )
      }
    >
      {durationChar?.isWritable && (
        <div className="space-y-2">
          <SliderControl
            label="Duration"
            value={duration ?? 300}
            min={durationChar.characteristic?.minValue ?? 60}
            max={durationChar.characteristic?.maxValue ?? 3600}
            step={durationChar.characteristic?.stepValue ?? 60}
            formatValue={formatDuration}
            onCommit={(v) => onSlider(accessory.id, 'set_duration', v)}
          />
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{formatDuration(durationChar.characteristic?.minValue ?? 60)}</span>
            <span>{formatDuration(durationChar.characteristic?.maxValue ?? 3600)}</span>
          </div>
        </div>
      )}
    </WidgetCard>
  );
});
