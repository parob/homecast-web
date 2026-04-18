import React, { memo, useState, useRef, useEffect } from 'react';
import { Thermometer, Flame, Snowflake, Power, Fan, AirVent, CheckCircle2, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { WidgetCard, useWidgetColors } from './WidgetCard';
import { SliderControl, ColoredSwitch } from './shared';
import { WidgetProps, getCharacteristic, hasServiceType, ServiceType } from './types';
import { getIconColor } from './iconColors';
import CircularSlider from 'react-circular-slider-svg';

// Mode buttons component - always shows text labels, with smaller font when narrow
const ModeButtons: React.FC<{
  buttons: Array<{ key: string; icon: React.ComponentType<{ className?: string }>; label: string; isSelected: boolean; onClick: () => void }>;
  getButtonClasses: (isSelected: boolean) => string;
  disabled?: boolean;
  viewOnly?: boolean;
}> = ({ buttons, getButtonClasses, disabled, viewOnly }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [useSmallFont, setUseSmallFont] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkWidth = () => {
      const containerWidth = container.offsetWidth;
      if (containerWidth < 50) return;

      const gap = 4;
      const totalGaps = (buttons.length - 1) * gap;
      const buttonWidth = (containerWidth - totalGaps) / buttons.length;
      // Use smaller font when buttons are narrow (less than 45px each)
      setUseSmallFont(buttonWidth < 45);
    };

    const timeout = setTimeout(checkWidth, 50);
    const observer = new ResizeObserver(checkWidth);
    observer.observe(container);
    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, [buttons.length]);

  return (
    <div ref={containerRef} className="flex gap-1 flex-nowrap overflow-hidden">
      {buttons.map((btn) => (
        <Button
          key={btn.key}
          variant="outline"
          size="sm"
          onClick={() => { if (!viewOnly) btn.onClick(); }}
          className={`flex-1 rounded-md min-w-0 ${useSmallFont ? 'text-[10px] h-6 px-0.5' : 'text-xs h-7 px-1'} ${getButtonClasses(btn.isSelected)} ${viewOnly ? 'cursor-not-allowed' : ''}`}
          disabled={disabled}
        >
          <span className="truncate">{btn.label}</span>
        </Button>
      ))}
    </div>
  );
};

// Circular temperature dial component - full height overlay version
const TemperatureDial: React.FC<{
  value: number;
  currentTemp?: number | null;
  min: number;
  max: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  status?: string | null;
  strokeColor: string;
  trackColor?: string;
}> = ({ value, currentTemp, min, max, onChange, disabled, status, strokeColor, trackColor }) => {
  const [dragging, setDragging] = useState<number | null>(null);
  const displayValue = dragging !== null ? dragging : value;

  return (
    <div className="absolute -right-[7px] top-1/2 -translate-y-[calc(40%+8px)] flex flex-col items-center justify-center z-20">
      <div
        className="relative [&_svg]:cursor-pointer [&_svg_path]:cursor-pointer"
        style={{ width: 150, height: 150 }}
      >
        <CircularSlider
          size={150}
          trackWidth={14}
          handleSize={0}
          minValue={min}
          maxValue={max}
          startAngle={50}
          endAngle={310}
          angleType={{ direction: 'cw', axis: '-y' }}
          handle1={{
            value: displayValue,
            onChange: (v) => {
              const rounded = Math.round(v * 2) / 2;
              setDragging(rounded);
            },
          }}
          onControlFinished={() => {
            if (dragging !== null) {
              onChange(dragging);
              setDragging(null);
            }
          }}
          arcColor={strokeColor}
          arcBackgroundColor={trackColor || "hsl(var(--muted))"}
          disabled={disabled}
        />
        {/* Center temperature display - current and target */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none" style={{ cursor: 'default' }}>
          {currentTemp !== null && currentTemp !== undefined && (
            <>
              <span className="text-sm font-bold text-muted-foreground">{Number(currentTemp).toFixed(1)}°</span>
              <ChevronDown className="h-3 w-3 text-muted-foreground -my-0.5" />
            </>
          )}
          <span className="text-xl font-bold">{displayValue.toFixed(1)}°</span>
          {status && (
            <span className="text-[9px] font-medium text-muted-foreground mt-0.5">{status}</span>
          )}
        </div>
      </div>
    </div>
  );
};
// Thermostat modes (heating_cooling_target)
const THERMOSTAT_MODES = ['Off', 'Heat', 'Cool', 'Auto'];
const THERMOSTAT_ICONS = [Power, Flame, Snowflake, Thermometer];

// Heater/Cooler modes (target_heater_cooler_state) - different order!
// Full list: 0=Auto, 1=Heat, 2=Cool
const HEATER_COOLER_MODES = ['Auto', 'Heat', 'Cool'];
const HEATER_COOLER_ICONS = [AirVent, Flame, Snowflake];

// Get available heater/cooler modes based on device capabilities
// validValues from HomeKit tells us exactly which modes are supported (0=Auto, 1=Heat, 2=Cool)
const getAvailableHCModes = (
  hasHeating: boolean,
  hasCooling: boolean,
  validValues?: number[]
): { index: number; name: string; icon: typeof AirVent }[] => {
  const modes: { index: number; name: string; icon: typeof AirVent }[] = [];

  // If we have validValues from HomeKit, use them exclusively
  if (validValues && validValues.length > 0) {
    if (validValues.includes(0)) {
      modes.push({ index: 0, name: 'Auto', icon: AirVent });
    }
    if (validValues.includes(1)) {
      modes.push({ index: 1, name: 'Heat', icon: Flame });
    }
    if (validValues.includes(2)) {
      modes.push({ index: 2, name: 'Cool', icon: Snowflake });
    }
    return modes;
  }

  // Fallback: infer from capabilities
  // If device has BOTH heating and cooling capabilities, it likely supports Auto mode
  if (hasHeating && hasCooling) {
    modes.push({ index: 0, name: 'Auto', icon: AirVent });
  }

  if (hasHeating) {
    modes.push({ index: 1, name: 'Heat', icon: Flame });
  }

  if (hasCooling) {
    modes.push({ index: 2, name: 'Cool', icon: Snowflake });
  }

  return modes;
};

// Heater/Cooler current state values
const HEATER_COOLER_STATES = ['Inactive', 'Idle', 'Heating', 'Cooling'];

export const ThermostatWidget: React.FC<WidgetProps> = memo(({
  accessory,
  onToggle,
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
  const noResponse = !accessory.isReachable;
  // Determine if this is a heater_cooler or thermostat
  const isHeaterCooler = hasServiceType(accessory, 'heater_cooler');

  // Common characteristics
  const activeChar = getCharacteristic(accessory, 'active');
  const currentTempChar = getCharacteristic(accessory, 'current_temperature');
  const humidityChar = getCharacteristic(accessory, 'relative_humidity');
  const fanSpeedChar = getCharacteristic(accessory, 'rotation_speed');

  // Thermostat-specific
  const targetTempChar = getCharacteristic(accessory, 'target_temperature');
  const currentModeChar = getCharacteristic(accessory, 'heating_cooling_current');
  const targetModeChar = getCharacteristic(accessory, 'heating_cooling_target');

  // Heater/Cooler-specific (check both readable name and UUID)
  const heatingThresholdChar = getCharacteristic(accessory, 'heating_threshold');
  const coolingThresholdChar = getCharacteristic(accessory, 'cooling_threshold');
  const targetHCStateChar = getCharacteristic(accessory, 'target_heater_cooler_state') ||
                            getCharacteristic(accessory, '000000B2-0000-1000-8000-0026BB765291');
  const currentHCStateChar = getCharacteristic(accessory, 'current_heater_cooler_state') ||
                             getCharacteristic(accessory, '000000B1-0000-1000-8000-0026BB765291');

  // Active state
  const activeValue = activeChar ? getEffectiveValue(accessory.id, 'active', activeChar.value) : null;
  const isActive = activeValue === true || activeValue === 1 || activeValue === 'true' || activeValue === '1' || activeChar === null;

  // Current temperature
  const currentTemp = currentTempChar?.value;
  const humidity = humidityChar?.value;

  // Fan speed
  const fanSpeed = fanSpeedChar ? getEffectiveValue(accessory.id, 'rotation_speed', fanSpeedChar.value) : null;

  // Determine device capabilities from validValues on target_heater_cooler_state
  // HomeKit target_heater_cooler_state: 0=Auto, 1=Heat, 2=Cool
  // validValues tells us which modes are supported (e.g., [1] = heat-only, [2] = cool-only, [0,1,2] = all)
  const targetHCValidValues = targetHCStateChar?.characteristic?.validValues;

  // Check if characteristic exists AND has a non-null value (fallback detection)
  const heatingHasValue = heatingThresholdChar?.value !== null && heatingThresholdChar?.value !== undefined;
  const coolingHasValue = coolingThresholdChar?.value !== null && coolingThresholdChar?.value !== undefined;

  // Determine capabilities:
  // 1. If validValues is available, use it (most reliable - straight from HomeKit)
  // 2. If characteristic has an actual value, device has that capability
  // 3. If no clear indicator, fall back to writable status
  let hasHeatingCapability: boolean;
  let hasCoolingCapability: boolean;

  if (targetHCValidValues && targetHCValidValues.length > 0) {
    // Use validValues from HomeKit - most reliable source
    hasHeatingCapability = targetHCValidValues.includes(1);
    hasCoolingCapability = targetHCValidValues.includes(2);
  } else if (heatingHasValue || coolingHasValue) {
    // At least one threshold has a value - use values to determine capabilities
    hasHeatingCapability = heatingHasValue;
    hasCoolingCapability = coolingHasValue;
  } else {
    // No clear indicator - fall back to writable status
    hasHeatingCapability = heatingThresholdChar?.isWritable ?? false;
    hasCoolingCapability = coolingThresholdChar?.isWritable ?? false;
  }

  // Get available modes for heater_cooler devices
  const availableHCModes = isHeaterCooler ? getAvailableHCModes(hasHeatingCapability, hasCoolingCapability, targetHCValidValues) : [];

  // Mode handling - different for heater_cooler vs thermostat
  let currentMode = 0;
  let targetMode = 0;
  let modeNames: string[];
  let modeIcons: typeof THERMOSTAT_ICONS;

  if (isHeaterCooler) {
    // Heater/Cooler mode: 0=Auto, 1=Heat, 2=Cool
    modeNames = HEATER_COOLER_MODES;
    modeIcons = HEATER_COOLER_ICONS;

    // Helper to parse mode value - some devices return boolean instead of 0/1/2
    // Also clamps to available modes based on device capabilities
    const parseHCMode = (value: any): number => {
      let mode = 0;
      if (typeof value === 'number' && value >= 0 && value <= 2) {
        mode = value;
      } else {
        const parsed = parseInt(String(value));
        if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
          mode = parsed;
        } else if (value === true || value === 'true' || value === 1 || value === '1') {
          // Boolean values - determine mode based on device category or defaults
          const category = (accessory.category || '').toLowerCase();
          if (category.includes('heater') || category.includes('heat')) {
            mode = 1; // Heat mode for heater devices
          } else if (heatingThresholdChar?.value !== null && currentTempChar?.value !== null &&
                     Number(currentTempChar.value) < Number(heatingThresholdChar.value)) {
            mode = 1; // Heat mode - below target
          }
        }
      }

      // Clamp mode to available capabilities
      // If device reports Cool (2) but can't cool, treat as Heat (1) or Auto (0)
      if (mode === 2 && !hasCoolingCapability) {
        mode = hasHeatingCapability ? 1 : 0;
      }
      // If device reports Heat (1) but can't heat, treat as Cool (2) or Auto (0)
      if (mode === 1 && !hasHeatingCapability) {
        mode = hasCoolingCapability ? 2 : 0;
      }
      // If device reports Auto (0) but only has one capability, use that
      if (mode === 0 && !(hasHeatingCapability && hasCoolingCapability)) {
        if (hasHeatingCapability) mode = 1;
        else if (hasCoolingCapability) mode = 2;
      }

      return mode;
    };

    const currentHCState = currentHCStateChar?.value;
    currentMode = parseHCMode(currentHCState);
    const targetHCState = targetHCStateChar
      ? getEffectiveValue(accessory.id, targetHCStateChar.type, targetHCStateChar.value)
      : 0;
    targetMode = parseHCMode(targetHCState);
  } else {
    // Thermostat mode: 0=Off, 1=Heat, 2=Cool, 3=Auto
    modeNames = THERMOSTAT_MODES;
    modeIcons = THERMOSTAT_ICONS;
    currentMode = currentModeChar?.value ?? (isActive ? 1 : 0);
    targetMode = targetModeChar
      ? getEffectiveValue(accessory.id, 'heating_cooling_target', targetModeChar.value)
      : currentMode;
  }

  // Determine target temperature based on mode
  let targetTemp: number | null = null;
  let targetTempType: string = 'target_temperature';

  if (isHeaterCooler) {
    // For heater_cooler:
    // - Heat mode (1): use heating_threshold
    // - Cool mode (2): use cooling_threshold
    // - Auto mode (0): use cooling_threshold as primary (or heating if cooling not available)
    if (targetMode === 1 && heatingThresholdChar) {
      targetTemp = getEffectiveValue(accessory.id, 'heating_threshold', heatingThresholdChar.value);
      targetTempType = 'heating_threshold';
    } else if ((targetMode === 2 || targetMode === 0) && coolingThresholdChar) {
      targetTemp = getEffectiveValue(accessory.id, 'cooling_threshold', coolingThresholdChar.value);
      targetTempType = 'cooling_threshold';
    } else if (heatingThresholdChar) {
      targetTemp = getEffectiveValue(accessory.id, 'heating_threshold', heatingThresholdChar.value);
      targetTempType = 'heating_threshold';
    }
  } else {
    // For thermostat: use target_temperature, or fall back to heating_threshold
    if (targetTempChar) {
      targetTemp = getEffectiveValue(accessory.id, 'target_temperature', targetTempChar.value);
      targetTempType = 'target_temperature';
    } else if (heatingThresholdChar) {
      targetTemp = getEffectiveValue(accessory.id, 'heating_threshold', heatingThresholdChar.value);
      targetTempType = 'heating_threshold';
    }
  }

  // Get mode icon and name
  const ModeIcon = modeIcons[targetMode] || (isHeaterCooler ? AirVent : Thermometer);
  const modeName = modeNames[targetMode] || (isActive ? 'Active' : 'Off');

  // Get current state description for heater_cooler
  const getCurrentStateDesc = () => {
    if (!isHeaterCooler) return null;
    // If device is not active, don't show state
    if (!isActive) return null;

    // Get device's reported state
    const reportedState = currentHCStateChar
      ? (typeof currentHCStateChar.value === 'number' ? currentHCStateChar.value : parseInt(String(currentHCStateChar.value)) || 0)
      : 1; // Default to Idle if no state char

    // 0=Inactive, 1=Idle, 2=Heating, 3=Cooling
    // Only show Heating/Cooling if it matches the target mode to avoid confusion
    // Target mode: 1=Heat, 2=Cool
    if (reportedState === 2 && targetMode !== 1) return 'Idle'; // Device says Heating but not in Heat mode
    if (reportedState === 3 && targetMode !== 2) return 'Idle'; // Device says Cooling but not in Cool mode
    if (reportedState === 0 && isActive) return 'Idle'; // Device says Inactive but it's on

    return HEATER_COOLER_STATES[reportedState] || null;
  };
  const currentStateDesc = getCurrentStateDesc();

  // Determine if we have controls to show
  // For heater_cooler, show mode controls if writable AND there's at least one mode (Off button provides the other option)
  const hasModeControls = isHeaterCooler
    ? (targetHCStateChar?.isWritable && availableHCModes.length >= 1)
    : (targetModeChar?.isWritable);
  const hasTempControls = isHeaterCooler
    ? (heatingThresholdChar?.isWritable || coolingThresholdChar?.isWritable)
    : (targetTempChar?.isWritable || heatingThresholdChar?.isWritable);
  const hasFanControls = fanSpeedChar?.isWritable;
  const hasControls = hasModeControls || hasTempControls || hasFanControls;

  // Calculate button count for layout purposes (Off + available modes)
  const modeButtonCount = isHeaterCooler ? (1 + availableHCModes.length) : modeNames.length;

  // Handle mode change for heater_cooler
  const handleModeChange = (newMode: number) => {
    if (isHeaterCooler && targetHCStateChar) {
      onSlider(accessory.id, targetHCStateChar.type, newMode);
    } else if (targetModeChar) {
      onSlider(accessory.id, 'heating_cooling_target', newMode);
    }
  };

  // Determine temperature status relative to target
  const tempDiff = currentTemp !== null && currentTemp !== undefined && targetTemp !== null
    ? Number(currentTemp) - Number(targetTemp)
    : null;
  const isAtTarget = tempDiff !== null && Math.abs(tempDiff) <= 0.5 && isActive;

  // Check if we've exceeded target in the desired direction
  const isAboveTarget = tempDiff !== null && tempDiff > 0.5 && isActive;
  const isBelowTarget = tempDiff !== null && tempDiff < -0.5 && isActive;

  // Determine the effective mode (what the device is trying to do)
  const effectiveMode = isHeaterCooler
    ? (targetMode === 1 ? 'heat' : targetMode === 2 ? 'cool' : 'auto')
    : (targetMode === 1 ? 'heat' : targetMode === 2 ? 'cool' : targetMode === 3 ? 'auto' : 'off');

  // "Satisfied" means we've reached or exceeded target in the right direction
  const isSatisfied = isActive && (
    isAtTarget ||
    (effectiveMode === 'heat' && isAboveTarget) ||  // Heating and it's warmer than target
    (effectiveMode === 'cool' && isBelowTarget)     // Cooling and it's cooler than target
  );

  // Get status label
  const getTargetStatus = () => {
    if (!isActive || tempDiff === null) return null;
    if (isAtTarget) return 'At Target';
    if (effectiveMode === 'heat' && isAboveTarget) return 'Above Target';
    if (effectiveMode === 'cool' && isBelowTarget) return 'Below Target';
    return null;
  };
  const targetStatus = getTargetStatus();

  // Determine dynamic service type based on device type and mode for icon coloring
  // Thermostats stay orange consistently (even when off)
  // Heater_cooler: color based on capabilities and state
  // - Heat-only: always orange
  // - Cool-only: always blue
  // - Both capabilities: green when off/idle/auto, orange when heating, blue when cooling
  const getActiveServiceType = (): ServiceType | null => {
    // Regular thermostats - always orange (even when off, for slight orange tint)
    if (!isHeaterCooler) {
      return 'thermostat';
    }

    // Single-capability devices always use their characteristic color
    if (hasHeatingCapability && !hasCoolingCapability) {
      return 'thermostat'; // Heat-only → always orange
    }
    if (hasCoolingCapability && !hasHeatingCapability) {
      return 'heater_cooler'; // Cool-only → always blue
    }

    // Device has BOTH capabilities - color depends on target mode (user selection)
    // Green when OFF
    if (!isActive) {
      return 'climate_balanced';
    }

    // Device is ON - use target mode to determine color (more responsive to user selection)
    // Target mode: 0=Auto, 1=Heat, 2=Cool
    if (targetMode === 1) return 'thermostat'; // Target Heat → orange
    if (targetMode === 2) return 'heater_cooler'; // Target Cool → blue

    // Auto mode (0) → green
    return 'climate_balanced';
  };

  const activeServiceType = getActiveServiceType();

  // Dynamic icon based on state and capabilities
  const getDynamicIcon = () => {
    if (isHeaterCooler) {
      // For heater_cooler, show icon based on current state
      const currentState = currentHCStateChar?.value;
      if (currentState === 2 || currentState === '2') return Flame; // Actively heating
      if (currentState === 3 || currentState === '3') return Snowflake; // Actively cooling

      // When off or idle - use capability-based icon
      if (hasHeatingCapability && !hasCoolingCapability) return Flame; // Heat-only device
      if (hasCoolingCapability && !hasHeatingCapability) return Snowflake; // Cool-only device
      return AirVent; // Has both capabilities - generic AC icon
    }

    // For thermostat, use mode icon
    return ModeIcon;
  };

  const DynamicIcon = getDynamicIcon();

  // Build subtitle showing current temperature (always visible, even when off)
  const getSubtitle = () => {
    if (currentTemp === null || currentTemp === undefined) return undefined;
    const tempStr = `${Number(currentTemp).toFixed(1)}°`;
    if (humidity !== null && humidity !== undefined) {
      return `${tempStr} · ${Math.round(Number(humidity))}%`;
    }
    return tempStr;
  };

  return (
    <WidgetCard
      title={accessory.name}
      subtitle={getSubtitle()}
      icon={<DynamicIcon className="h-4 w-4" />}
      multiLineTitle
      isOn={isActive}
      isReachable={accessory.isReachable}
      accessory={accessory}
      compact={compact}
      onExpandToggle={onExpandToggle}
      onDebug={onDebug}
      
      serviceType={activeServiceType}
      iconStyle={iconStyle}
      childrenVisible={isActive && hasControls && accessory.isReachable}
      
      
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
        // For heater_cooler when off: show compact mode buttons (Auto/Heat/Cool) in header
        isHeaterCooler && hasModeControls && !isActive && accessory.isReachable ? (
          <div className="flex items-center gap-2">
            {/* Show current temp in compact mode even when off */}
            {compact && currentTemp !== null && currentTemp !== undefined && (
              <span className="text-xs text-muted-foreground">{Number(currentTemp).toFixed(0)}°</span>
            )}
            <div className="flex gap-1">
              {availableHCModes.map((mode) => {
                const modeBgClass =
                  mode.name === 'Heat'
                    ? 'bg-red-100 hover:bg-red-200 text-red-600 dark:bg-red-950/50 dark:hover:bg-red-900/60 dark:text-red-300'
                    : mode.name === 'Cool'
                    ? 'bg-sky-100 hover:bg-sky-200 text-sky-600 dark:bg-sky-950/50 dark:hover:bg-sky-900/60 dark:text-sky-300'
                    : 'bg-muted hover:bg-muted/80';
                return (
                  <button
                    key={mode.name}
                    onClick={() => {
                      if (isViewOnly) return;
                      onToggle(accessory.id, 'active', false);
                      handleModeChange(mode.index);
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${modeBgClass} ${isViewOnly ? 'cursor-not-allowed' : ''}`}
                    title={mode.name}
                  >
                    <mode.icon className="h-3.5 w-3.5" />
                  </button>
                );
              })}
            </div>
          </div>
        ) : activeChar?.isWritable && (!isActive || noResponse) ? (
          // Show switch for non-heater_cooler devices or when not responding
          <div className="flex items-center gap-2">
            {/* Show current temp in compact mode even when off */}
            {compact && currentTemp !== null && currentTemp !== undefined && (
              <span className="text-xs text-muted-foreground">{Number(currentTemp).toFixed(0)}°</span>
            )}
            <ColoredSwitch
              checked={isActive}
              onCheckedChange={() => {
                if (isViewOnly) return;
                onToggle(accessory.id, 'active', isActive);
                // When turning ON a heater_cooler, also set a default mode if available
                if (!isActive && isHeaterCooler && availableHCModes.length > 0 && targetHCStateChar) {
                  // Set to first available mode (typically Heat or Cool)
                  onSlider(accessory.id, targetHCStateChar.type, availableHCModes[0].index);
                }
              }}
              disabled={noResponse}
              className={isViewOnly ? 'cursor-not-allowed' : ''}
            />
          </div>
        ) : compact && currentTemp !== null && currentTemp !== undefined ? (
          // Compact mode: show current → target temps (when active or no switch)
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-muted-foreground">{Number(currentTemp).toFixed(0)}°</span>
            {isActive && targetTemp !== null && (
              <>
                <span className="text-muted-foreground">→</span>
                <span className={`font-medium ${
                  effectiveMode === 'heat' ? 'text-orange-500' :
                  effectiveMode === 'cool' ? 'text-sky-500' :
                  'text-foreground'
                }`}>{Number(targetTemp).toFixed(0)}°</span>
              </>
            )}
          </div>
        ) : undefined
      }
      className={!compact && !editMode && hasTempControls && accessory.isReachable && isActive ? "relative overflow-visible pr-[135px]" : ""}
      overlayContent={
        !compact && !editMode && hasTempControls && accessory.isReachable && isActive ? (() => {
          const tempChar = targetTempType === 'heating_threshold' ? heatingThresholdChar
            : targetTempType === 'cooling_threshold' ? coolingThresholdChar
            : targetTempChar;
          const minTemp = tempChar?.characteristic?.minValue ?? 10;
          const maxTemp = tempChar?.characteristic?.maxValue ?? 35;
          const currentTarget = Number(targetTemp) || 22;
          // Stroke color based on icon style and service type
          const getStrokeColor = () => {
            if (iconStyle === 'standard') return 'hsl(var(--primary))';
            // Colourful mode uses service-type-specific colors
            if (activeServiceType === 'heater_cooler') return '#0ea5e9'; // sky-500
            if (activeServiceType === 'climate_balanced') return '#10b981'; // emerald-500
            return '#f97316'; // orange-500
          };
          // Track background color based on icon style
          const getTrackColor = () => {
            if (iconStyle === 'standard') return 'hsl(var(--primary) / 0.2)';
            if (iconStyle === 'colourful') {
              if (activeServiceType === 'heater_cooler') return '#bae6fd'; // sky-200
              if (activeServiceType === 'climate_balanced') return '#a7f3d0'; // emerald-200
              return '#fed7aa'; // orange-200
            }
            return 'hsl(var(--muted))';
          };
          const strokeColor = getStrokeColor();
          const trackColor = getTrackColor();

          return (
            <TemperatureDial
              value={currentTarget}
              currentTemp={currentTemp !== null && currentTemp !== undefined ? Number(currentTemp) : null}
              min={minTemp}
              max={maxTemp}
              onChange={(v) => { if (!isViewOnly) onSlider(accessory.id, targetTempType, v); }}
              disabled={isViewOnly || noResponse}
              status={currentStateDesc}
              strokeColor={strokeColor}
              trackColor={trackColor}
            />
          );
        })() : undefined
      }
    >
      {hasControls && (
        <div className={compact ? "space-y-2" : ""}>
          {/* Full height layout with dial on right */}
          {!compact && !editMode && hasTempControls && accessory.isReachable && isActive ? (
            <div className="flex flex-col">
              {/* Left side: mode buttons, current temp, and fan controls */}
              <div className="flex-1 flex flex-col justify-between">
                {/* Mode selection buttons (including Off) */}
                {(() => {
                  // Build all mode buttons including Off
                  const allButtons: Array<{ key: string; icon: typeof Power; label: string; isSelected: boolean; onClick: () => void }> = [];

                  if (isHeaterCooler) {
                    // Off button - always show when device is on
                    allButtons.push({
                      key: 'off',
                      icon: Power,
                      label: 'Off',
                      isSelected: false, // Never selected when device is on
                      onClick: () => onToggle(accessory.id, 'active', isActive),
                    });
                    // Mode buttons - always show available modes
                    availableHCModes.forEach((mode) => {
                      allButtons.push({
                        key: mode.name,
                        icon: mode.icon,
                        label: mode.name,
                        isSelected: targetMode === mode.index, // Highlighted when this mode is active
                        onClick: () => handleModeChange(mode.index),
                      });
                    });
                  } else {
                    // Thermostat - Off is index 0
                    modeNames.forEach((mode, index) => {
                      allButtons.push({
                        key: mode,
                        icon: modeIcons[index],
                        label: mode,
                        isSelected: targetMode === index,
                        onClick: () => handleModeChange(index),
                      });
                    });
                  }

                  // Get themed button classes based on icon style - all buttons use widget color
                  const widgetColors = activeServiceType ? getIconColor(activeServiceType) : null;
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

                  return (
                    <ModeButtons
                      buttons={allButtons}
                      getButtonClasses={getButtonClasses}
                      disabled={noResponse}
                      viewOnly={isViewOnly}
                    />
                  );
                })()}

                {/* Fan speed slider */}
                {hasFanControls && (
                  <SliderControl
                    label="Fan"
                    value={Number(fanSpeed) || 50}
                    min={fanSpeedChar?.characteristic?.minValue ?? 0}
                    max={fanSpeedChar?.characteristic?.maxValue ?? 100}
                    step={fanSpeedChar?.characteristic?.stepValue ?? 10}
                    formatValue={(v) => `${Math.round(v)}%`}
                    onCommit={(v) => { if (!isViewOnly) onSlider(accessory.id, 'rotation_speed', v); }}
                    disabled={isViewOnly || noResponse}
                    icon={Fan}
                    compact
                  />
                )}
              </div>
            </div>
          ) : (
            <>
              {/* Fallback: Mode buttons only (when no temp control or compact) */}
              {!compact && (() => {
                // Build all mode buttons including Off
                const allButtons: Array<{ key: string; icon: typeof Power; label: string; isSelected: boolean; onClick: () => void }> = [];

                if (isHeaterCooler) {
                  // Off button
                  allButtons.push({
                    key: 'off',
                    icon: Power,
                    label: 'Off',
                    isSelected: !isActive,
                    onClick: () => onToggle(accessory.id, 'active', isActive),
                  });
                  // Mode buttons
                  availableHCModes.forEach((mode) => {
                    allButtons.push({
                      key: mode.name,
                      icon: mode.icon,
                      label: mode.name,
                      isSelected: isActive && targetMode === mode.index,
                      onClick: () => {
                        if (!isActive) {
                          onToggle(accessory.id, 'active', false);
                        }
                        handleModeChange(mode.index);
                      },
                    });
                  });
                } else {
                  modeNames.forEach((mode, index) => {
                    allButtons.push({
                      key: mode,
                      icon: modeIcons[index],
                      label: mode,
                      isSelected: targetMode === index,
                      onClick: () => handleModeChange(index),
                    });
                  });
                }

                // Get themed button classes based on icon style - all buttons use widget color
                const widgetColors = activeServiceType ? getIconColor(activeServiceType) : null;
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

                return (
                  <ModeButtons
                    buttons={allButtons}
                    getButtonClasses={getButtonClasses}
                    disabled={noResponse}
                    viewOnly={isViewOnly}
                  />
                );
              })()}

              {/* Compact mode: slider fallback */}
              {compact && hasTempControls && (() => {
                const tempChar = targetTempType === 'heating_threshold' ? heatingThresholdChar
                  : targetTempType === 'cooling_threshold' ? coolingThresholdChar
                  : targetTempChar;
                return (
                  <SliderControl
                    label={
                      (isHeaterCooler && targetMode === 0) ? 'Target'
                        : targetTempType === 'heating_threshold' ? 'Heat to'
                        : targetTempType === 'cooling_threshold' ? 'Cool to'
                        : 'Target'
                    }
                    value={Number(targetTemp) || 22}
                    min={tempChar?.characteristic?.minValue ?? 10}
                    max={tempChar?.characteristic?.maxValue ?? 35}
                    step={tempChar?.characteristic?.stepValue ?? 0.5}
                    formatValue={(v) => `${v.toFixed(1)}°C`}
                    onCommit={(v) => { if (!isViewOnly) onSlider(accessory.id, targetTempType, v); }}
                    disabled={isViewOnly || noResponse}
                    iconLeft={Snowflake}
                    iconRight={Flame}
                    compact={compact}
                  />
                );
              })()}
            </>
          )}
        </div>
      )}
    </WidgetCard>
  );
});
