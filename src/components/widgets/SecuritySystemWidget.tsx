import React, { memo } from 'react';
import { Shield, ShieldAlert, ShieldCheck, ShieldOff, Home, Moon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { WidgetCard } from './WidgetCard';
import { WidgetProps, getCharacteristic } from './types';
import { getIconColor } from './iconColors';

const SECURITY_STATES = [
  { name: 'Stay Arm', icon: Home, color: 'bg-blue-500' },
  { name: 'Away Arm', icon: ShieldCheck, color: 'bg-green-500' },
  { name: 'Night Arm', icon: Moon, color: 'bg-purple-500' },
  { name: 'Disarmed', icon: ShieldOff, color: 'bg-muted' },
  { name: 'Triggered', icon: ShieldAlert, color: 'bg-destructive' },
];

// Normalize security state from various formats to HomeKit numeric values
// HomeKit: 0=Stay Arm, 1=Away Arm, 2=Night Arm, 3=Disarmed, 4=Triggered
// Some devices return boolean-like values (true/false or "true"/"false") where true=Armed
function normalizeSecurityState(value: unknown): number {
  if (typeof value === 'number') {
    return value >= 0 && value <= 4 ? value : 3;
  }
  // Boolean true = Armed (Away Arm), false = Disarmed
  if (value === true || value === 'true' || value === 1 || value === '1') return 1; // Away Arm
  if (value === false || value === 'false' || value === 0 || value === '0') return 3; // Disarmed
  return 3; // Default to Disarmed
}

export const SecuritySystemWidget: React.FC<WidgetProps> = memo(({
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

  // Get button classes based on iconStyle and state
  const getButtonClasses = (isActive: boolean) => {
    if (iconStyle === 'colourful') {
      return isActive
        ? `${widgetColors.accent} text-white border-transparent`
        : `${widgetColors.accentMuted} ${widgetColors.accentMutedHover} border-transparent`;
    }
    // Standard and basic modes use primary color
    return isActive
      ? 'bg-primary hover:bg-primary/90 text-primary-foreground border-transparent'
      : 'bg-primary/20 hover:bg-primary/30 border-transparent';
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
          <div className="grid grid-cols-2 gap-2">
            {SECURITY_STATES.slice(0, 4).map((state, index) => {
              const Icon = state.icon;
              const isActive = targetState === index;
              return (
                <Button
                  key={state.name}
                  variant="outline"
                  size="sm"
                  className={`flex-1 h-auto py-3 ${getButtonClasses(isActive)}`}
                  onClick={() => onSlider(accessory.id, 'security_system_target_state', index)}
                  disabled={!accessory.isReachable}
                >
                  <div className="flex flex-col items-center gap-1">
                    <Icon className="h-4 w-4" />
                    <span className="text-xs">{state.name}</span>
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
