import React, { memo } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldOff, Home, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { UNSELECTED_CHIP } from './VirtualAccessoryWidget';
import { WidgetProps, getCharacteristic } from './types';
import { getIconColor } from './iconColors';
import { SECURITY_STATE_NAMES, normalizeSecurityState } from './shared/securityState';

// Names and the value normalisation are shared with the Actions catalog; only
// the icon and colour for each state are this widget's business.
const SECURITY_STATE_STYLES = [
  { icon: Home, color: 'bg-blue-500' },
  { icon: ShieldCheck, color: 'bg-green-500' },
  { icon: Moon, color: 'bg-purple-500' },
  { icon: ShieldOff, color: 'bg-muted' },
  { icon: ShieldAlert, color: 'bg-destructive' },
];

const SECURITY_STATES = SECURITY_STATE_NAMES.map((name, i) => ({ name, ...SECURITY_STATE_STYLES[i] }));

export const SecuritySystemWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onSlider,
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
  const currentStateChar = getCharacteristic(accessory, 'security_system_current_state');
  const targetStateChar = getCharacteristic(accessory, 'security_system_target_state');

  const targetState = targetStateChar
    ? normalizeSecurityState(getEffectiveValue(accessory.id, 'security_system_target_state', targetStateChar.value))
    : 3;
  const rawCurrentState = currentStateChar?.value;
  const currentState = rawCurrentState != null ? normalizeSecurityState(rawCurrentState) : targetState;

  const stateInfo = SECURITY_STATES[currentState] || SECURITY_STATES[3];
  const StateIcon = stateInfo.icon;
  const isArmed = currentState < 3;
  const isTriggered = currentState === 4;

  // Get widget colors for theming
  const widgetColors = getIconColor('security_system');
  const { isDarkBackground } = useBackgroundContext();

  // Get button classes based on iconStyle and state
  const getButtonClasses = (isActive: boolean) => {
    // Unselected modes take a translucent dark fill rather than a pale tint:
    // WidgetWrapper forces every span to white while the system is disarmed,
    // which put white text on pale pink. This flips with the background, so it
    // stays readable either way. The selected mode is solid and ringed — pale
    // versus slightly-less-pale did not read as a choice.
    const unselected = `${UNSELECTED_CHIP(!isArmed && isDarkBackground)} border-transparent font-normal`;
    if (iconStyle === 'colourful') {
      return isActive
        ? `${widgetColors.accent} text-white border-transparent font-semibold ring-2 ring-inset ring-white/45`
        : unselected;
    }
    return isActive
      ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent font-semibold ring-2 ring-inset ring-white/45'
      : unselected;
  };

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={isTriggered ? 'Alarm Triggered!' : isArmed ? stateInfo.name : 'Disarmed'}
      icon={<Shield className={`h-4 w-4 ${isTriggered ? 'text-destructive animate-pulse' : ''}`} />}
      isOn={isArmed}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      expanded={expanded}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType="security_system"
      iconStyle={iconStyle}
      className={isTriggered ? 'border-destructive bg-destructive/10' : ''}
      
      
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
      {targetStateChar?.isWritable && (
        <div className="space-y-3">
          {/* State buttons */}
          <div className={`grid grid-cols-2 ${expanded ? 'gap-[10px]' : 'gap-2'}`}>
            {SECURITY_STATES.slice(0, 4).map((state, index) => {
              const Icon = state.icon;
              const isActive = targetState === index;
              return (
                <Button
                  key={state.name}
                  variant="outline"
                  size="sm"
                  // The state it is already in is not a thing to press. Kept at
                  // full colour while disabled — this row's selected button is
                  // how the mode is shown, and the usual fade would erase it.
                  className={`flex-1 h-auto ${expanded ? 'py-[14px] rounded-xl' : 'py-3'} ${getButtonClasses(isActive)} ${isActive ? 'disabled:opacity-100 cursor-default' : ''}`}
                  onClick={() => onSlider(accessory.id, 'security_system_target_state', index)}
                  disabled={!accessory.isReachable || isActive}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Icon className={expanded ? 'h-[20px] w-[20px]' : 'h-4 w-4'} />
                    <span className={expanded ? 'text-[14px]' : 'text-xs'}>{state.name}</span>
                  </div>
                </Button>
              );
            })}
          </div>

          {/* Triggered warning */}
          {isTriggered && (
            <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/20 text-destructive text-sm">
              <ShieldAlert className="h-4 w-4 animate-pulse" />
              <span className="font-medium">Security alarm triggered!</span>
            </div>
          )}
        </div>
      )}
    </WidgetCard>
  );
});
