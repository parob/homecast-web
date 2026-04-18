import React, { useState, useCallback, useContext } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { SliderControl } from '@/components/widgets/shared/SliderControl';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
// Import directly from source files to avoid circular dependency with barrel export
import { AccessoryWidget } from '@/components/widgets/AccessoryWidget';
import { getPrimaryServiceType } from '@/components/widgets/types';
import { getIconColor, type IconStyle, DEFAULT_ICON_COLOR } from '@/components/widgets/iconColors';
import { WidgetColorContext, WidgetInteractionContext } from '@/components/widgets/WidgetCard';
import { WidgetWrapper } from '@/components/widgets/WidgetWrapper';
import { useDragHandle } from '@/components/shared/SortableItem';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
} from '@/components/ui/context-menu';
import type { HomeKitServiceGroup, HomeKitAccessory } from '@/lib/graphql/types';
import { getDisplayName } from '@/lib/graphql/types';
import {
  Lightbulb,
  Blinds,
  Power,
  Plug,
  Wind,
  Lock,
  Thermometer,
  Speaker,
  Eye,
  EyeOff,
  Trash2,
  Share2,
  Bug,
} from 'lucide-react';

export interface ServiceGroupWidgetProps {
  group: HomeKitServiceGroup;
  accessories: HomeKitAccessory[];
  compact?: boolean;
  roomName?: string;
  homeName?: string;
  onToggle: (checked: boolean) => void;
  onSlider: (characteristicType: string, value: number) => void;
  onAccessoryToggle?: (accessoryId: string, characteristicType: string, currentValue: boolean) => void;
  onAccessorySlider?: (accessoryId: string, characteristicType: string, value: number) => void;
  getEffectiveValue?: (accessoryId: string, characteristicType: string, currentValue: unknown) => unknown;
  disableTooltip?: boolean;
  /** Callback to remove service group from collection/group */
  onRemove?: () => void;
  /** Label for remove action */
  removeLabel?: string;
  /** Callback to hide/unhide the service group */
  onHide?: () => void;
  /** Label for hide action */
  hideLabel?: string;
  /** Whether the service group is currently hidden */
  isHidden?: boolean;
  /** Whether hidden items are currently being shown */
  showHiddenItems?: boolean;
  /** Callback to toggle showing hidden items */
  onToggleShowHidden?: () => void;
  /** Icon style for colourful theme */
  iconStyle?: IconStyle;
  /** Callback to share this service group */
  onShare?: () => void;
  /** Callback to debug this service group */
  onDebug?: () => void;
  /** When true, controls are disabled and show as view-only */
  disabled?: boolean;
  /** Location subtitle (e.g., "Room · Home") shown after main subtitle */
  locationSubtitle?: string;
  /** Whether edit mode is active (enables wiggle animation) */
  editMode?: boolean;
}

export const ServiceGroupWidget: React.FC<ServiceGroupWidgetProps> = ({
  group,
  accessories,
  compact = false,
  roomName,
  homeName,
  onToggle,
  onSlider,
  onAccessoryToggle,
  onAccessorySlider,
  getEffectiveValue,
  disableTooltip = false,
  onRemove,
  removeLabel,
  onHide,
  hideLabel,
  isHidden,
  showHiddenItems,
  onToggleShowHidden,
  iconStyle = 'standard',
  onShare,
  onDebug,
  disabled = false,
  locationSubtitle,
  editMode = false,
}) => {
  // accessory.isReachable here is already the derived value (see useHomeKitData).
  const reachableCount = accessories.filter(a => a.isReachable).length;
  const allNoResponse = accessories.length > 0 && reachableCount === 0;
  const someNoResponse = reachableCount > 0 && reachableCount < accessories.length;

  // Read interaction context (provided by shared views for view-only mode)
  const interactionCtx = useContext(WidgetInteractionContext);
  const effectiveDisabled = disabled || interactionCtx.disabled || allNoResponse || false;
  const effectiveOnDisabledClick = interactionCtx.onDisabledClick;

  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedAccessoryId, setExpandedAccessoryId] = useState<string | null>(null);
  const [isWidgetExpanded, setIsWidgetExpanded] = useState(false);

  // Get drag handle from SortableItem context (if inside a sortable)
  const dragHandle = useDragHandle();
  const showCompact = compact;

  // Determine group type
  const isBlindsGroup = accessories.some(acc =>
    acc.services?.some(s => s.serviceType === 'window_covering')
  );
  const isLightsGroup = accessories.some(acc =>
    acc.services?.some(s => s.serviceType === 'lightbulb') &&
    acc.services?.some(s => s.characteristics?.some(c => c.characteristicType === 'brightness'))
  );
  const hasColorTemp = accessories.some(acc =>
    acc.services?.some(s => s.characteristics?.some(c => c.characteristicType === 'color_temperature' && c.isWritable))
  );

  // Calculate if group is on (computed directly, not memoized)
  const isGroupOn = () => {
    return accessories.some(accessory => {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
            const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
            if (value === true || value === 1 || value === '1' || value === 'true') return true;
          }
        }
      }
      return false;
    });
  };

  // Get average brightness
  const getAverageBrightness = useCallback(() => {
    let total = 0;
    let count = 0;
    for (const accessory of accessories) {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'brightness') {
            const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
            const numValue = value !== null && value !== undefined ? Number(value) : null;
            if (numValue !== null && !isNaN(numValue)) {
              total += numValue;
              count++;
            }
          }
        }
      }
    }
    return count > 0 ? Math.round(total / count) : null;
  }, [accessories, getEffectiveValue]);

  // Get average color temperature and range
  const getColorTempInfo = useCallback(() => {
    let total = 0;
    let count = 0;
    let minTemp = 140;
    let maxTemp = 500;
    for (const accessory of accessories) {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'color_temperature' && char.isWritable) {
            const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
            const numValue = value !== null && value !== undefined ? Number(value) : null;
            if (numValue !== null && !isNaN(numValue)) {
              total += numValue;
              count++;
            }
            // Track min/max from characteristic metadata
            if (char.minValue !== undefined) {
              minTemp = Math.max(minTemp, char.minValue);
            }
            if (char.maxValue !== undefined) {
              maxTemp = Math.min(maxTemp, char.maxValue);
            }
          }
        }
      }
    }
    return count > 0 ? { value: Math.round(total / count), min: minTemp, max: maxTemp } : null;
  }, [accessories, getEffectiveValue]);

  // Get average position for blinds
  const getAveragePosition = useCallback(() => {
    let total = 0;
    let count = 0;
    for (const accessory of accessories) {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'current_position') {
            const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
            const numValue = value !== null && value !== undefined ? Number(value) : null;
            if (numValue !== null && !isNaN(numValue)) {
              total += numValue;
              count++;
            }
          }
        }
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  }, [accessories, getEffectiveValue]);

  // Count how many are on
  const getOnCount = useCallback(() => {
    return accessories.filter(accessory => {
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
            const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
            if (value === true || value === 1 || value === '1' || value === 'true') return true;
          }
        }
      }
      return false;
    }).length;
  }, [accessories, getEffectiveValue]);

  const groupOn = allNoResponse ? false : isGroupOn();
  const brightness = isLightsGroup ? getAverageBrightness() : null;
  const colorTempInfo = hasColorTemp ? getColorTempInfo() : null;
  const position = isBlindsGroup ? getAveragePosition() : 0;
  const onCount = getOnCount();
  const isPartiallyOn = !isBlindsGroup && onCount > 0 && onCount < accessories.length;

  // Use white text when group is off and there's a DARK background (not light)
  // Determine the primary service type for the group
  const groupServiceType = isBlindsGroup
    ? 'window_covering'
    : (accessories[0] ? getPrimaryServiceType(accessories[0]) : 'lightbulb') || 'lightbulb';

  // Get colors based on icon style
  const useServiceColors = iconStyle === 'standard' || iconStyle === 'colourful';
  const iconColor = useServiceColors ? getIconColor(groupServiceType) : null;

  // Card and wrapper backgrounds are transparent - handled externally
  const groupCardBgClass = '!bg-transparent';
  const expandedCardBgClass = '!bg-transparent';

  // Create color context value for SliderControl
  const widgetColors = iconColor || DEFAULT_ICON_COLOR;
  const colorContextValue = {
    colors: widgetColors,
    isOn: groupOn,
    iconStyle,
  };

  // Icon background and text colors
  const groupIconBgClass = iconColor
    ? (groupOn ? iconColor.bg : iconColor.bgOff)
    : (groupOn ? 'bg-primary shadow-sm' : 'bg-muted opacity-30');
  const groupIconTextClass = iconColor
    ? (groupOn ? iconColor.text : iconColor.textOff)
    : (groupOn ? 'text-primary-foreground' : '');

  // Get icon for accessory
  const getServiceIcon = (serviceType: string | null) => {
    switch (serviceType) {
      case 'lightbulb': return <Lightbulb className="h-3 w-3" />;
      case 'switch': return <Power className="h-3 w-3" />;
      case 'outlet': return <Plug className="h-3 w-3" />;
      case 'fan': return <Wind className="h-3 w-3" />;
      case 'window_covering': return <Blinds className="h-3 w-3" />;
      case 'lock': return <Lock className="h-3 w-3" />;
      case 'thermostat': return <Thermometer className="h-3 w-3" />;
      case 'speaker': return <Speaker className="h-3 w-3" />;
      default: return <Power className="h-3 w-3" />;
    }
  };

  const isDragging = dragHandle?.isDragging ?? false;
  const hasContextMenu = !disableTooltip && !isDragging;


  // No Response styling (same as WidgetCard)
  const noResponseClass = allNoResponse ? 'opacity-50 grayscale' : '';

  // Hidden styling
  const hiddenClass = isHidden ? 'opacity-40 grayscale' : '';

  // Hidden badge
  const hiddenBadge = isHidden ? (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
      <span className="bg-zinc-500/90 text-white text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
        Hidden
      </span>
    </div>
  ) : null;

  const handleCardClick = useCallback(() => {
    if (isDragging) return;
    if (showCompact) {
      if (!isWidgetExpanded) {
        setIsWidgetExpanded(true);
        setIsExpanded(true);
      } else {
        setIsExpanded(false);
        setIsWidgetExpanded(false);
      }
    } else {
      setIsExpanded(prev => !prev);
    }
  }, [isDragging, showCompact, isWidgetExpanded]);

  // Compact subtitle text
  const compactSubtitle = allNoResponse
    ? 'No Response'
    : isBlindsGroup ? `${position}% open` : `${accessories.length} device${accessories.length !== 1 ? 's' : ''}`;

  const cardContent = (
    <Card className={`relative ${groupCardBgClass} ${noResponseClass} ${hiddenClass} cursor-pointer`} onClick={handleCardClick}>
      <CardHeader className={showCompact ? 'p-3' : `p-4 ${(isBlindsGroup || (isLightsGroup && groupOn && (brightness !== null || colorTempInfo))) ? 'pb-2' : 'pb-4'}`}>
        {showCompact ? (
          // Compact mode - vertical layout matching preview style
          <div
            className={`${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
            {...(dragHandle?.attributes || {})}
            {...(dragHandle?.listeners || {})}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between">
                <div className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-full ${groupIconBgClass} ${groupIconTextClass}`}>
                  {isBlindsGroup
                    ? <Blinds className="h-4 w-4" />
                    : <Lightbulb className="h-4 w-4" />
                  }
                </div>
                {!isBlindsGroup && (
                  <div
                    className={`relative shrink-0 scale-75 origin-top-right ${effectiveDisabled ? 'pointer-events-none' : ''}`}
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                  >
                    <Switch
                      checked={groupOn}
                      onCheckedChange={onToggle}
                      disabled={effectiveDisabled}
                      className="shrink-0"
                      checkedColorClass={iconStyle === 'colourful' && iconColor ? iconColor.switchBg : undefined}
                    />
                    {effectiveDisabled && effectiveOnDisabledClick && (
                      <div
                        className="absolute inset-0 z-50 pointer-events-auto cursor-default"
                        onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
                      />
                    )}
                  </div>
                )}
              </div>
              <div>
                <CardTitle className={`text-xs font-medium truncate `}>
                  {getDisplayName(group.name, roomName)}
                </CardTitle>
                <CardDescription className={`text-[10px] mt-0.5 truncate `}>
                  {locationSubtitle
                    ? <>{compactSubtitle}<span className="opacity-60"> {locationSubtitle}</span></>
                    : compactSubtitle}
                </CardDescription>
              </div>
            </div>
          </div>
        ) : (
          // Non-compact mode - horizontal layout
          <div className="flex items-center justify-between gap-2">
            <div
              className={`flex items-center min-w-0 flex-1 gap-2 ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'}`}
              {...(dragHandle?.attributes || {})}
              {...(dragHandle?.listeners || {})}
            >
              <div className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-full ${groupIconBgClass} ${groupIconTextClass}`}>
                {isBlindsGroup
                  ? <Blinds className="h-4 w-4" />
                  : <Lightbulb className="h-4 w-4" />
                }
              </div>
              <div className="min-w-0">
                <CardTitle className={`truncate font-medium leading-tight text-sm `}>
                  {getDisplayName(group.name, roomName)}
                </CardTitle>
                <CardDescription className={`text-xs mt-0.5 flex items-center gap-1.5 `}>
                  {allNoResponse
                    ? 'No Response'
                    : isBlindsGroup ? `${position}% open` : `${accessories.length} device${accessories.length !== 1 ? 's' : ''}`}
                  {locationSubtitle && <span className="opacity-60">{locationSubtitle}</span>}
                  {!allNoResponse && someNoResponse && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-muted/25">
                      {reachableCount}/{accessories.length} reachable
                    </Badge>
                  )}
                  {!allNoResponse && isPartiallyOn && (
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-muted/25">
                      {onCount}/{accessories.length} on
                    </Badge>
                  )}
                </CardDescription>
              </div>
            </div>
            {!isBlindsGroup && (
              <div
                className={`relative shrink-0 ${effectiveDisabled ? 'pointer-events-none' : ''}`}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <Switch
                  checked={groupOn}
                  onCheckedChange={onToggle}
                  disabled={effectiveDisabled}
                  className="shrink-0"
                  checkedColorClass={iconStyle === 'colourful' && iconColor ? iconColor.switchBg : undefined}
                />
                {effectiveDisabled && effectiveOnDisabledClick && (
                  <div
                    className="absolute inset-0 z-50 pointer-events-auto cursor-default"
                    onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </CardHeader>
      <AnimatedCollapse open={!showCompact && !allNoResponse && (isBlindsGroup || (isLightsGroup && groupOn && (brightness !== null || colorTempInfo !== null)))}>
        <CardContent className={`relative px-4 pb-3 pt-1 space-y-2 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          {isBlindsGroup && (
            <SliderControl
              label="All Blinds"
              value={position}
              step={5}
              unit="%"
              onCommit={(v) => onSlider('target_position', v)}
              disabled={effectiveDisabled}
              trackBgClass="bg-muted/25"
            />
          )}
          {isLightsGroup && groupOn && brightness !== null && (
            <SliderControl
              label="All Lights"
              value={brightness}
              step={1}
              unit="%"
              onCommit={(v) => onSlider('brightness', v)}
              disabled={effectiveDisabled}
              trackBgClass="bg-muted/25"
            />
          )}
          {isLightsGroup && groupOn && colorTempInfo && (
            <SliderControl
              label="Color Temp"
              value={colorTempInfo.value}
              min={colorTempInfo.min}
              max={colorTempInfo.max}
              step={10}
              unit="K"
              onCommit={(v) => onSlider('color_temperature', v)}
              disabled={effectiveDisabled}
              trackBgClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-sky-200/60 to-orange-200/60" : "bg-muted/25"}
              trackColorClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-sky-400 to-orange-400" : undefined}
              fixedGradient={iconStyle === 'colourful'}
            />
          )}
          {effectiveDisabled && effectiveOnDisabledClick && (
            <div
              className="absolute inset-0 z-50 pointer-events-auto cursor-default"
              onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
            />
          )}
        </CardContent>
      </AnimatedCollapse>
      <AnimatedCollapse open={isExpanded && !showCompact}>
        <CardContent className={`relative px-3 pb-3 pt-0 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2 pt-1">
            {accessories.map((accessory) => {
              const isBlind = accessory.services?.some(s => s.serviceType === 'window_covering');
              const serviceType = getPrimaryServiceType(accessory);

              // Get power state
              let powerCharType: string | null = null;
              let accIsOn = false;
              for (const service of accessory.services || []) {
                for (const char of service.characteristics || []) {
                  if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
                    powerCharType = char.characteristicType;
                    const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
                    accIsOn = value === true || value === 1 || value === '1' || value === 'true';
                    break;
                  }
                }
              }

              // Get position for blinds
              let accPosition = 0;
              if (isBlind) {
                for (const service of accessory.services || []) {
                  for (const char of service.characteristics || []) {
                    if (char.characteristicType === 'current_position') {
                      const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
                      accPosition = Number(value) || 0;
                      accIsOn = accPosition > 50;
                      break;
                    }
                  }
                }
              }

              // Get accessory-specific icon color for colourful mode
              const accIconColor = getIconColor(serviceType);

              // Use colorful theme colors for inline accessories
              const accCardBgClass = iconStyle === 'colourful' && accIconColor && accIsOn
                ? accIconColor.cardBg
                : (accIsOn ? 'bg-primary/10 dark:bg-black/40' : 'bg-muted/30 dark:bg-black/40');
              const accIconBgClass = iconStyle === 'colourful' && accIconColor
                ? (accIsOn ? `${accIconColor.bg} ${accIconColor.text}` : `${accIconColor.bgOff} ${accIconColor.textOff}`)
                : (accIsOn ? 'bg-primary/20 text-primary' : 'bg-muted');
              const isAccessoryExpanded = expandedAccessoryId === accessory.id;

              // Blur tint for expanded overlay

              return (
                <div
                  key={accessory.id}
                  className="relative cursor-pointer"
                  onClick={() => setExpandedAccessoryId(isAccessoryExpanded ? null : accessory.id)}
                >
                  <div className={`rounded-md px-2 py-1.5 ${accCardBgClass} ${isBlind ? 'space-y-2' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${accIconBgClass}`}>
                          {getServiceIcon(serviceType)}
                        </div>
                        <span className="truncate text-xs">{getDisplayName(accessory.name, accessory.roomName)}</span>
                        {isBlind && (
                          <span className="text-[10px] text-muted-foreground">{accPosition}%</span>
                        )}
                      </div>
                      {!isBlind && powerCharType && onAccessoryToggle && (
                        <Switch
                          checked={accIsOn}
                          onCheckedChange={() => onAccessoryToggle(accessory.id, powerCharType!, accIsOn)}
                          disabled={effectiveDisabled || !accessory.isReachable}
                          className="scale-75"
                          onClick={(e) => e.stopPropagation()}
                          checkedColorClass={iconStyle === 'colourful' && iconColor ? iconColor.switchBg : undefined}
                        />
                      )}
                    </div>
                    {isBlind && onAccessorySlider && (
                      <div className="pl-8" onClick={(e) => e.stopPropagation()}>
                        <Slider
                          value={[accPosition]}
                          min={0}
                          max={100}
                          step={5}
                          onValueCommit={(v) => onAccessorySlider(accessory.id, 'target_position', v[0])}
                          disabled={effectiveDisabled || !accessory.isReachable}
                          className="w-full"
                          trackColorClass={iconStyle === 'colourful' && iconColor ? iconColor.sliderTrack : undefined}
                          trackBgClass="bg-muted/25"
                        />
                      </div>
                    )}
                  </div>
                  {onAccessoryToggle && onAccessorySlider && getEffectiveValue && (
                    <ExpandedOverlay
                      isExpanded={isAccessoryExpanded}
                      onClose={() => setExpandedAccessoryId(null)}
                     
                    >
                      {/* inOverlay=true makes WidgetCard fully transparent, letting ExpandedOverlay's blur layer show through */}
                      <AccessoryWidget
                        accessory={accessory}
                        onToggle={onAccessoryToggle}
                        onSlider={onAccessorySlider}
                        getEffectiveValue={getEffectiveValue}
                        compact={false}
                        iconStyle={iconStyle}
                        disabled={effectiveDisabled}
                        inOverlay={true}
                      />
                    </ExpandedOverlay>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </AnimatedCollapse>
    </Card>
  );

  const handleExpandedCardClick = useCallback(() => {
    setIsExpanded(false);
    setIsWidgetExpanded(false);
  }, []);

  // Expanded card content for the overlay (non-compact, shares state with parent)
  const expandedCardContent = (
    <Card className={`relative ${expandedCardBgClass} ${noResponseClass} cursor-pointer`} onClick={handleExpandedCardClick}>
      <CardHeader className={`p-4 ${(isBlindsGroup || (isLightsGroup && groupOn && (brightness !== null || colorTempInfo))) ? 'pb-2' : 'pb-4'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center min-w-0 flex-1 gap-2 cursor-pointer">
            <div className={`shrink-0 flex items-center justify-center h-8 w-8 rounded-full ${groupIconBgClass} ${groupIconTextClass}`}>
              {isBlindsGroup
                ? <Blinds className="h-4 w-4" />
                : <Lightbulb className="h-4 w-4" />
              }
            </div>
            <div className="min-w-0">
              <CardTitle className={`truncate font-medium leading-tight text-sm `}>
                {getDisplayName(group.name, roomName)}
              </CardTitle>
              <CardDescription className={`text-xs mt-0.5 flex items-center gap-1.5 `}>
                {allNoResponse
                  ? 'No Response'
                  : isBlindsGroup ? `${position}% open` : `${accessories.length} device${accessories.length !== 1 ? 's' : ''}`}
                {!allNoResponse && someNoResponse && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-muted/25">
                    {reachableCount}/{accessories.length} reachable
                  </Badge>
                )}
                {!allNoResponse && isPartiallyOn && (
                  <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 bg-muted/25">
                    {onCount}/{accessories.length} on
                  </Badge>
                )}
              </CardDescription>
            </div>
          </div>
          {!isBlindsGroup && (
            <div
              className={`relative shrink-0 ${effectiveDisabled ? 'pointer-events-none' : ''}`}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <Switch
                checked={groupOn}
                onCheckedChange={onToggle}
                disabled={effectiveDisabled}
                className="shrink-0"
                checkedColorClass={iconStyle === 'colourful' && iconColor ? iconColor.switchBg : undefined}
              />
              {effectiveDisabled && effectiveOnDisabledClick && (
                <div
                  className="absolute inset-0 z-50 pointer-events-auto cursor-default"
                  onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
                />
              )}
            </div>
          )}
        </div>
      </CardHeader>
      <AnimatedCollapse open={!allNoResponse && (isBlindsGroup || (isLightsGroup && groupOn && brightness !== null))}>
        <CardContent className={`relative px-4 pb-3 pt-1 space-y-2 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          {isBlindsGroup && (
            <SliderControl
              label="All Blinds"
              value={position}
              step={5}
              unit="%"
              onCommit={(v) => onSlider('target_position', v)}
              disabled={effectiveDisabled}
              trackBgClass="bg-muted/25"
            />
          )}
          {isLightsGroup && groupOn && brightness !== null && (
            <SliderControl
              label="All Lights"
              value={brightness}
              step={1}
              unit="%"
              onCommit={(v) => onSlider('brightness', v)}
              disabled={effectiveDisabled}
              trackBgClass="bg-muted/25"
            />
          )}
          {isLightsGroup && groupOn && colorTempInfo && (
            <SliderControl
              label="Color Temp"
              value={colorTempInfo.value}
              min={colorTempInfo.min}
              max={colorTempInfo.max}
              step={10}
              unit="K"
              onCommit={(v) => onSlider('color_temperature', v)}
              disabled={effectiveDisabled}
              trackBgClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-sky-200/60 to-orange-200/60" : "bg-muted/25"}
              trackColorClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-sky-400 to-orange-400" : undefined}
              fixedGradient={iconStyle === 'colourful'}
            />
          )}
          {effectiveDisabled && effectiveOnDisabledClick && (
            <div
              className="absolute inset-0 z-50 pointer-events-auto cursor-default"
              onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
            />
          )}
        </CardContent>
      </AnimatedCollapse>
      <AnimatedCollapse open={isExpanded}>
        <CardContent className={`relative px-3 pb-3 pt-0 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          <div className="space-y-2 pt-1">
            {accessories.map((accessory) => {
              const isBlind = accessory.services?.some(s => s.serviceType === 'window_covering');
              const serviceType = getPrimaryServiceType(accessory);

              // Get power state
              let powerCharType: string | null = null;
              let accIsOn = false;
              for (const service of accessory.services || []) {
                for (const char of service.characteristics || []) {
                  if (char.characteristicType === 'on' || char.characteristicType === 'power_state') {
                    powerCharType = char.characteristicType;
                    const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
                    accIsOn = value === true || value === 1 || value === '1' || value === 'true';
                    break;
                  }
                }
              }

              // Get position for blinds
              let accPosition = 0;
              if (isBlind) {
                for (const service of accessory.services || []) {
                  for (const char of service.characteristics || []) {
                    if (char.characteristicType === 'current_position') {
                      const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
                      accPosition = Number(value) || 0;
                      accIsOn = accPosition > 50;
                      break;
                    }
                  }
                }
              }

              // Get accessory-specific icon color for colourful mode
              const accIconColor = getIconColor(serviceType);

              // Use colorful theme colors for inline accessories
              const accCardBgClass = iconStyle === 'colourful' && accIconColor && accIsOn
                ? accIconColor.cardBg
                : (accIsOn ? 'bg-primary/10 dark:bg-black/40' : 'bg-muted/30 dark:bg-black/40');
              const accIconBgClass = iconStyle === 'colourful' && accIconColor
                ? (accIsOn ? `${accIconColor.bg} ${accIconColor.text}` : `${accIconColor.bgOff} ${accIconColor.textOff}`)
                : (accIsOn ? 'bg-primary/20 text-primary' : 'bg-muted');
              const isAccessoryExpanded = expandedAccessoryId === accessory.id;

              // Blur tint for expanded overlay

              return (
                <div
                  key={accessory.id}
                  className="relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedAccessoryId(isAccessoryExpanded ? null : accessory.id);
                  }}
                >
                  <div className={`rounded-md px-2 py-1.5 ${accCardBgClass} ${isBlind ? 'space-y-2' : ''}`}>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${accIconBgClass}`}>
                          {getServiceIcon(serviceType)}
                        </div>
                        <span className="truncate text-xs">{getDisplayName(accessory.name, accessory.roomName)}</span>
                        {isBlind && (
                          <span className="text-[10px] text-muted-foreground">{accPosition}%</span>
                        )}
                      </div>
                      {!isBlind && powerCharType && onAccessoryToggle && (
                        <Switch
                          checked={accIsOn}
                          onCheckedChange={() => onAccessoryToggle(accessory.id, powerCharType!, accIsOn)}
                          disabled={effectiveDisabled || !accessory.isReachable}
                          className="scale-75"
                          onClick={(e) => e.stopPropagation()}
                          checkedColorClass={iconStyle === 'colourful' && iconColor ? iconColor.switchBg : undefined}
                        />
                      )}
                    </div>
                    {isBlind && onAccessorySlider && (
                      <div className="pl-8" onClick={(e) => e.stopPropagation()}>
                        <Slider
                          value={[accPosition]}
                          min={0}
                          max={100}
                          step={5}
                          onValueCommit={(v) => onAccessorySlider(accessory.id, 'target_position', v[0])}
                          disabled={effectiveDisabled || !accessory.isReachable}
                          className="w-full"
                          trackColorClass={iconStyle === 'colourful' && iconColor ? iconColor.sliderTrack : undefined}
                          trackBgClass="bg-muted/25"
                        />
                      </div>
                    )}
                  </div>
                  {onAccessoryToggle && onAccessorySlider && getEffectiveValue && (
                    <ExpandedOverlay
                      isExpanded={isAccessoryExpanded}
                      onClose={() => setExpandedAccessoryId(null)}
                     
                    >
                      {/* inOverlay=true makes WidgetCard fully transparent, letting ExpandedOverlay's blur layer show through */}
                      <AccessoryWidget
                        accessory={accessory}
                        onToggle={onAccessoryToggle}
                        onSlider={onAccessorySlider}
                        getEffectiveValue={getEffectiveValue}
                        compact={false}
                        iconStyle={iconStyle}
                        disabled={effectiveDisabled}
                        inOverlay={true}
                      />
                    </ExpandedOverlay>
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </AnimatedCollapse>
    </Card>
  );

  // Close overlay when mouse leaves
  const handleOverlayMouseLeave = useCallback(() => {
    setIsWidgetExpanded(false);
    setIsExpanded(false);
    setExpandedAccessoryId(null);
  }, []);

  const wiggleOffset = editMode ? { '--wiggle-offset': `${(group.id.charCodeAt(0) % 5) * 0.05}deg` } as React.CSSProperties : undefined;
  const wiggleClass = editMode ? 'wiggle' : '';

  if (hasContextMenu) {
    return (
      <div className={wiggleClass} style={wiggleOffset}>
      <WidgetColorContext.Provider value={colorContextValue}>
        <WidgetWrapper isOn={groupOn} iconStyle={iconStyle} accentColorClass={iconColor?.blurBg}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              {cardContent}
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              {(homeName || roomName) && (
                <>
                  <ContextMenuLabel className="text-xs text-muted-foreground font-normal">
                    {homeName && roomName
                      ? `${homeName} · ${roomName}`
                      : homeName || roomName}
                  </ContextMenuLabel>
                  <ContextMenuSeparator />
                </>
              )}
              <div className="flex justify-between px-2 py-1.5 text-sm">
                <span className="text-muted-foreground">Devices</span>
                <span>{accessories.length}</span>
              </div>
              {!isBlindsGroup && (
                <div className="flex justify-between px-2 py-1.5 text-sm">
                  <span className="text-muted-foreground">On</span>
                  <span>{onCount} / {accessories.length}</span>
                </div>
              )}
              {isLightsGroup && brightness !== null && (
                <div className="flex justify-between px-2 py-1.5 text-sm">
                  <span className="text-muted-foreground">Brightness (avg)</span>
                  <span>{brightness}%</span>
                </div>
              )}
              {isBlindsGroup && (
                <div className="flex justify-between px-2 py-1.5 text-sm">
                  <span className="text-muted-foreground">Position (avg)</span>
                  <span>{position}%</span>
                </div>
              )}
              <ContextMenuSeparator />
              {onShare && (
                <ContextMenuItem onClick={onShare}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Accessory Group
                </ContextMenuItem>
              )}
              {onDebug && (
                <ContextMenuItem onClick={onDebug}>
                  <Bug className="h-4 w-4 mr-2" />
                  Debug Accessory Group
                </ContextMenuItem>
              )}
              <ContextMenuItem onClick={() => {
                if (showCompact) {
                  // In compact mode, need to open the expanded overlay first
                  if (isExpanded && isWidgetExpanded) {
                    // Devices are showing, close everything
                    setIsExpanded(false);
                    setIsWidgetExpanded(false);
                  } else {
                    // Show devices
                    setIsWidgetExpanded(true);
                    setIsExpanded(true);
                  }
                } else {
                  setIsExpanded(!isExpanded);
                }
              }}>
                <Eye className="h-4 w-4 mr-2" />
                {(showCompact ? (isExpanded && isWidgetExpanded) : isExpanded) ? 'Hide Devices' : 'Show Devices'}
              </ContextMenuItem>
              {onHide && (
                <ContextMenuItem onClick={onHide}>
                  {isHidden ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                  {hideLabel || (isHidden ? 'Unhide Accessory Group' : 'Hide Accessory Group')}
                </ContextMenuItem>
              )}
              {onRemove && (
                <ContextMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  {removeLabel || 'Remove Accessory Group'}
                </ContextMenuItem>
              )}
              {onToggleShowHidden && <ContextMenuSeparator />}
              {onToggleShowHidden && (
                <ContextMenuItem onClick={onToggleShowHidden}>
                  {showHiddenItems ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                  {showHiddenItems ? 'Hide Hidden Items' : 'Show Hidden Items'}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
          {hiddenBadge}
          {/* Expanded overlay for compact mode */}
          <ExpandedOverlay
            isExpanded={isWidgetExpanded}
            onClose={handleOverlayMouseLeave}
            onMouseEnter={() => {}}
            onMouseLeave={handleOverlayMouseLeave}
           
          >
            <WidgetWrapper isOn={groupOn} iconStyle={iconStyle} accentColorClass={iconColor?.blurBg}>
              {expandedCardContent}
            </WidgetWrapper>
          </ExpandedOverlay>
        </WidgetWrapper>
      </WidgetColorContext.Provider>
      </div>
    );
  }

  return (
    <div className={wiggleClass} style={wiggleOffset}>
    <WidgetColorContext.Provider value={colorContextValue}>
      <WidgetWrapper isOn={groupOn} iconStyle={iconStyle} accentColorClass={iconColor?.blurBg}>
        {cardContent}
        {hiddenBadge}
        {/* Expanded overlay for compact mode */}
        <ExpandedOverlay
          isExpanded={isWidgetExpanded}
          onClose={handleOverlayMouseLeave}
          onMouseEnter={() => {}}
          onMouseLeave={handleOverlayMouseLeave}
        >
          <WidgetWrapper isOn={groupOn} iconStyle={iconStyle} accentColorClass={iconColor?.blurBg}>
            {expandedCardContent}
          </WidgetWrapper>
        </ExpandedOverlay>
      </WidgetWrapper>
    </WidgetColorContext.Provider>
    </div>
  );
};
