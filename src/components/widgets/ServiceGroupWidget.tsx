import React, { useState, useCallback, useContext, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { SliderControl } from '@/components/widgets/shared/SliderControl';
import { VerticalSlider } from '@/components/widgets/shared/VerticalSlider';
import { ColorSwatchRow } from '@/components/widgets/shared/ColorSwatchRow';
import { ColorControl } from '@/components/widgets/shared/ColorControl';
import { mirrorMired, formatMirroredAsKelvin } from '@/components/widgets/shared/colorTemp';
import { coveringMotion, coveringStatusText, usesStandardPositionLogic, toOpenness, fromOpenness } from '@/components/widgets/shared/coveringStatus';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
// Import directly from source files to avoid circular dependency with barrel export
import { AccessoryWidget } from '@/components/widgets/AccessoryWidget';
import { getPrimaryServiceType } from '@/components/widgets/types';
import { getIconColor, type IconStyle, DEFAULT_ICON_COLOR } from '@/components/widgets/iconColors';
import { WidgetColorContext, WidgetInteractionContext } from '@/components/widgets/WidgetCard';
import { usePinnedTabs } from '@/contexts/PinnedTabsContext';
import { useLayoutEdit } from '@/contexts/LayoutEditContext';
import { TileEditActions, HiddenLabel, type PrimaryEditAction } from '@/components/shared/EditActions';
import type { PinnedTab } from '@/lib/pinned-tabs';
import { WidgetWrapper } from '@/components/widgets/WidgetWrapper';
import { useDragHandle } from '@/components/shared/SortableItem';
import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { useHistory } from '@/contexts/HistoryContext';
import ExpandedActionBar, { type ExpandedAction } from './ExpandedActionBar';
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
  Palette,
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
  LineChart,
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
  const [pickerOpen, setPickerOpen] = useState(false);
  const { isDarkBackground } = useBackgroundContext();

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
  // Colour needs both: hue without saturation cannot express a colour, and a
  // group write has to set the pair or the members land somewhere arbitrary.
  const hasColorControl = accessories.some(acc =>
    acc.services?.some(sv => sv.characteristics?.some(c => c.characteristicType === 'hue' && c.isWritable)) &&
    acc.services?.some(sv => sv.characteristics?.some(c => c.characteristicType === 'saturation' && c.isWritable))
  );

  const averageOf = (type: string): number => {
    let total = 0;
    let count = 0;
    for (const acc of accessories) {
      for (const sv of acc.services || []) {
        for (const c of sv.characteristics || []) {
          if (c.characteristicType === type) {
            const raw = getEffectiveValue ? getEffectiveValue(acc.id, type, c.value) : c.value;
            const n = raw !== null && raw !== undefined ? Number(raw) : NaN;
            if (!isNaN(n)) { total += n; count++; }
          }
        }
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  };

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

  // Which way round each member counts. HomeKit's 0-100 means openness on some
  // blinds and coverage on others, and a group can hold both; averaging the raw
  // numbers mixed the two and the tile read backwards on ordinary hardware.
  const standardLogicFor = useCallback((accessory: HomeKitAccessory) => {
    let manufacturer = '';
    let model = '';
    for (const service of accessory.services || []) {
      for (const char of service.characteristics || []) {
        if (char.characteristicType === 'manufacturer') manufacturer = String(char.value ?? '');
        if (char.characteristicType === 'model') model = String(char.value ?? '');
      }
    }
    return usesStandardPositionLogic(manufacturer, model);
  }, []);

  // True when every member counts the same way, so one written value suits them
  // all and the group can stay a single call.
  const blindsShareConvention = useMemo(() => {
    const conventions = new Set(accessories.filter(a =>
      a.services?.some(sv => sv.serviceType === 'window_covering')).map(standardLogicFor));
    return conventions.size <= 1;
  }, [accessories, standardLogicFor]);

  const blindsConvention = useMemo(() => {
    const first = accessories.find(a => a.services?.some(sv => sv.serviceType === 'window_covering'));
    return first ? standardLogicFor(first) : true;
  }, [accessories, standardLogicFor]);

  /** Average openness (0 closed → 100 open) across the group's blinds. */
  const averageOpenness = useCallback((characteristicType: 'current_position' | 'target_position') => {
    let total = 0;
    let count = 0;
    for (const accessory of accessories) {
      const standard = standardLogicFor(accessory);
      for (const service of accessory.services || []) {
        for (const char of service.characteristics || []) {
          if (char.characteristicType === characteristicType) {
            const value = getEffectiveValue ? getEffectiveValue(accessory.id, char.characteristicType, char.value) : char.value;
            const numValue = value !== null && value !== undefined ? Number(value) : null;
            if (numValue !== null && !isNaN(numValue)) {
              total += toOpenness(numValue, standard);
              count++;
            }
          }
        }
      }
    }
    return count > 0 ? Math.round(total / count) : 0;
  }, [accessories, getEffectiveValue, standardLogicFor]);

  const getAveragePosition = useCallback(() => averageOpenness('current_position'), [averageOpenness]);

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
  // Same vocabulary as a single blind. The group has no position_state of its
  // own, so movement is read from the gap between where the members are and
  // where they have been told to go.
  const blindsTarget = isBlindsGroup ? averageOpenness('target_position') : 0;
  const blindsMotion = coveringMotion(position, blindsTarget, null, true);
  const blindsStatus = coveringStatusText(blindsMotion.isMoving, blindsMotion.isOpening, position);

  /**
   * Send an openness to the group's blinds, in whatever each one counts in.
   * Both the compact slider and the expanded bar go through here — they used to
   * carry their own copy, and only one of them got the conversion.
   */
  const commitBlindsOpenness = useCallback((openness: number) => {
    if (blindsShareConvention || !onAccessorySlider) {
      onSlider('target_position', fromOpenness(openness, blindsConvention));
      return;
    }
    for (const acc of accessories) {
      if (!acc.services?.some(sv => sv.serviceType === 'window_covering')) continue;
      onAccessorySlider(acc.id, 'target_position', fromOpenness(openness, standardLogicFor(acc)));
    }
  }, [accessories, blindsShareConvention, blindsConvention, onAccessorySlider, onSlider, standardLogicFor]);

  /** The blind drawn as itself: colour is material, hanging from the top. */
  const blindsReadout = (coverageValue: number) => {
    const open = Math.round(100 - coverageValue);
    return open >= 100 ? 'Open' : open <= 0 ? 'Closed' : `${open}%`;
  };
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
  // One provider serves both the inline card and the overlay, so it stays
  // false — the overlay's own controls opt into the larger sizing explicitly.
  const colorContextValue = {
    colors: widgetColors,
    isOn: groupOn,
    iconStyle,
    expanded: false,
    heroDense: false,
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
  // Read from context, not props — same reasoning as WidgetCard's menu items.
  const { historyAvailable, openGroupHistory } = useHistory();
  const canShowHistory = accessories.some(a => historyAvailable(a));
  const pins = usePinnedTabs();
  // On touch, hiding is Edit Layout's job — see WidgetCard.
  const { touchMode } = useLayoutEdit();
  const menuOnHide = touchMode ? undefined : onHide;
  const menuOnToggleShowHidden = touchMode ? undefined : onToggleShowHidden;

  const hasContextMenu = !disableTooltip && !isDragging;


  // No Response styling (same as WidgetCard)
  const noResponseClass = allNoResponse ? 'opacity-50 grayscale' : '';

  // Hidden styling
  const hiddenClass = isHidden ? 'opacity-40 grayscale' : '';

  // Same actions as an accessory tile — see WidgetCard for why the primary one
  // is hide on the dashboard and remove inside a collection.
  const editPrimaryAction: PrimaryEditAction = onHide
    ? { kind: 'hide', isHidden: !!isHidden, onToggle: onHide, name: group.name }
    : (editMode && onRemove)
      ? { kind: 'remove', label: removeLabel || 'Remove', onRemove }
      : null;

  const showEditActions = editMode || (!!isHidden && !!onHide);
  const editTab: PinnedTab | null = editMode
    ? { type: 'serviceGroup', id: group.id, name: group.name, homeId: accessories[0]?.homeId }
    : null;

  const editActions = showEditActions
    ? <TileEditActions action={editPrimaryAction} tab={editTab} />
    : null;

  // Named outside edit mode, where there is no legend explaining what a bare eye
  // icon means — desktop reveals hidden tiles from the context menu and never
  // enters edit mode. Inside edit mode the bar spells the icons out, and a pill
  // across the middle would cover the name again.
  const hiddenLabel = isHidden && !editMode ? <HiddenLabel /> : null;

  const handleCardClick = useCallback(() => {
    if (isDragging || editMode) return;
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
  }, [isDragging, editMode, showCompact, isWidgetExpanded]);

  // Compact subtitle text
  const compactSubtitle = allNoResponse
    ? 'No Response'
    : isBlindsGroup ? blindsStatus : `${accessories.length} device${accessories.length !== 1 ? 's' : ''}`;

  // Editing is for arranging, not operating. The group's switches and sliders are
  // scattered through this card, so rather than gate each one, the whole card goes
  // inert and the drag handle alone is given its pointer events back. The
  // visibility button is a sibling of the Card, so it keeps working either way.
  const cardContent = (
    <Card
      className={`relative ${groupCardBgClass} ${noResponseClass} ${hiddenClass} ${editMode ? 'pointer-events-none' : 'cursor-pointer'}`}
      onClick={handleCardClick}
    >
      <CardHeader className={showCompact ? 'p-[14px]' : `p-4 ${(isBlindsGroup || (isLightsGroup && groupOn && (brightness !== null || colorTempInfo))) ? 'pb-2' : 'pb-4'}`}>
        {showCompact ? (
          // Compact mode - vertical layout matching preview style
          <div
            className={`${isDragging ? 'cursor-grabbing' : 'cursor-pointer'} ${editMode ? 'pointer-events-auto' : ''}`}
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
                {!isBlindsGroup && !editMode && (
                  <div
                    className={`relative shrink-0 scale-90 origin-top-right ${effectiveDisabled ? 'pointer-events-none' : ''}`}
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
              className={`flex items-center min-w-0 flex-1 gap-2 ${isDragging ? 'cursor-grabbing' : 'cursor-pointer'} ${editMode ? 'pointer-events-auto' : ''}`}
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
                    : isBlindsGroup ? blindsStatus : `${accessories.length} device${accessories.length !== 1 ? 's' : ''}`}
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
            {!isBlindsGroup && !editMode && (
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
      <AnimatedCollapse open={!editMode && !showCompact && !allNoResponse && (isBlindsGroup || (isLightsGroup && groupOn && (brightness !== null || colorTempInfo !== null)))}>
        <CardContent className={`relative px-4 pb-3 pt-1 space-y-2 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          {isBlindsGroup && (
            <SliderControl
              label="All Blinds"
              value={position}
              step={5}
              unit="%"
              // The bar is openness; the devices are not, necessarily. When the
              // members agree the group write carries one converted number, as
              // before. When they disagree no single number can serve them, so
              // each is written its own — correctness over one round trip.
              onCommit={commitBlindsOpenness}
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
              // Mirrored axis — warm left, cool right. See shared/colorTemp.
              value={mirrorMired(colorTempInfo.value, colorTempInfo.min, colorTempInfo.max)}
              min={colorTempInfo.min}
              max={colorTempInfo.max}
              step={10}
              formatValue={(v) => formatMirroredAsKelvin(v, colorTempInfo.min, colorTempInfo.max)}
              onCommit={(v) => onSlider('color_temperature', mirrorMired(v, colorTempInfo.min, colorTempInfo.max))}
              disabled={effectiveDisabled}
              trackBgClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-orange-200/60 to-sky-200/60" : "bg-muted/25"}
              trackColorClass={iconStyle === 'colourful' ? "bg-gradient-to-r from-orange-400 to-sky-400" : undefined}
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
          <div className={`space-y-2 pt-1 ${accessories.length > 6 ? 'max-h-[17rem] overflow-y-auto pr-1' : ''}`}>
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
                : isDarkBackground
                  ? (accIsOn ? 'bg-white/20' : 'bg-white/10')
                  : (accIsOn ? 'bg-primary/10' : 'bg-muted/30');
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
                      {/* expanded renders the larger overlay layout; the card stays transparent so ExpandedOverlay's blur layer shows through */}
                      <AccessoryWidget
                        accessory={accessory}
                        onToggle={onAccessoryToggle}
                        onSlider={onAccessorySlider}
                        getEffectiveValue={getEffectiveValue}
                        compact={false}
                        iconStyle={iconStyle}
                        disabled={effectiveDisabled}
                        expanded={true}
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
  // Group panels carry the same corner cluster as accessory panels.
  const groupActions: ExpandedAction[] = [];
  if (canShowHistory) {
    groupActions.push({ key: 'analytics', icon: 'analytics', label: 'Analytics', onClick: () => openGroupHistory(group) });
  }
  if (onShare) {
    groupActions.push({ key: 'share', icon: 'share', label: 'Share', onClick: onShare });
  }

  const expandedCardContent = (
    <Card className={`relative ${expandedCardBgClass} ${noResponseClass} cursor-pointer`} onClick={handleExpandedCardClick}>
      <CardHeader className={`p-5 ${(isBlindsGroup || (isLightsGroup && groupOn && (brightness !== null || colorTempInfo))) ? 'pb-2' : 'pb-5'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center min-w-0 flex-1 gap-2.5 cursor-pointer">
            <div className={`shrink-0 flex items-center justify-center h-11 w-11 rounded-full ${groupIconBgClass} ${groupIconTextClass}`}>
              {isBlindsGroup
                ? <Blinds className="h-5 w-5" />
                : <Lightbulb className="h-5 w-5" />
              }
            </div>
            <div className="min-w-0">
              <CardTitle className={`truncate font-medium leading-tight text-base `}>
                {getDisplayName(group.name, roomName)}
              </CardTitle>
              <CardDescription className={`text-sm mt-0.5 flex items-center gap-1.5 `}>
                {allNoResponse
                  ? 'No Response'
                  : isBlindsGroup ? blindsStatus : `${accessories.length} device${accessories.length !== 1 ? 's' : ''}`}
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
        <CardContent className={`relative px-5 pb-4 pt-1 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          {/* Brightness and colour sit side by side as tall bars, the way Apple
              Home shows them, rather than stacked horizontal sliders that read
              as a settings form. */}
          <div className="flex justify-center gap-[12px]">
            {isBlindsGroup && (
              <div className="h-[220px] w-[132px]">
                <VerticalSlider
                  // Coverage, filling from the top, exactly as a single blind
                  // draws itself — this bar showed openness growing upward, so
                  // a closed group read as an empty track labelled 0%.
                  value={100 - position}
                  invert
                  step={5}
                  onCommit={(v) => commitBlindsOpenness(100 - v)}
                  disabled={effectiveDisabled}
                  icon={Blinds}
                  formatValue={blindsReadout}
                  fillClassName="bg-violet-400/80"
                  trackClassName="bg-black/10"
                  className="h-full text-slate-900"
                  dense
                />
              </div>
            )}
            {isLightsGroup && groupOn && brightness !== null && (
              <div className="h-[220px] w-[132px]">
                <VerticalSlider
                  value={brightness}
                  step={1}
                  onCommit={(v) => onSlider('brightness', v)}
                  disabled={effectiveDisabled}
                  icon={Lightbulb}
                  label="Brightness"
                  fillStyle={{ backgroundColor: 'hsl(45 95% 58%)' }}
                  fillClassName=""
                  trackClassName="bg-black/10"
                  className="h-full text-slate-900"
                  dense
                />
              </div>
            )}
            {isLightsGroup && groupOn && colorTempInfo && (
              <div className="h-[220px] w-[132px]">
                <VerticalSlider
                  // Mirrored axis, so travelling up the bar gets cooler — which
                  // is the direction its gradient has always been painted in.
                  value={mirrorMired(colorTempInfo.value, colorTempInfo.min, colorTempInfo.max)}
                  min={colorTempInfo.min}
                  max={colorTempInfo.max}
                  step={10}
                  onCommit={(v) => onSlider('color_temperature', mirrorMired(v, colorTempInfo.min, colorTempInfo.max))}
                  disabled={effectiveDisabled}
                  icon={Palette}
                  label="Color Temp"
                  formatValue={(v) => formatMirroredAsKelvin(v, colorTempInfo.min, colorTempInfo.max)}
                  fillClassName="bg-gradient-to-t from-orange-300 to-sky-300"
                  fixedGradient
                  trackClassName="bg-gradient-to-t from-orange-200/40 to-sky-200/40"
                  className="h-full text-slate-900"
                  dense
                />
              </div>
            )}
          </div>
          {isLightsGroup && groupOn && hasColorControl && (
            <div className="mt-[14px] space-y-[12px]">
              <ColorSwatchRow
                hue={averageOf('hue')}
                saturation={averageOf('saturation')}
                onSelect={(h, sat) => {
                  onSlider('hue', h);
                  onSlider('saturation', sat);
                }}
                pickerOpen={pickerOpen}
                onTogglePicker={() => setPickerOpen(o => !o)}
                disabled={effectiveDisabled}
              />
              {pickerOpen && (
                <ColorControl
                  hue={averageOf('hue')}
                  saturation={averageOf('saturation')}
                  onCommitHue={(v) => {
                    onSlider('hue', v);
                    if (averageOf('saturation') === 0) onSlider('saturation', 100);
                  }}
                  onCommitSaturation={(v) => onSlider('saturation', v)}
                  disabled={effectiveDisabled}
                />
              )}
            </div>
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
        <CardContent className={`relative px-4 pb-4 pt-0 ${effectiveDisabled ? 'pointer-events-none' : ''}`} onClick={(e) => e.stopPropagation()}>
          {/* The members are the same compact tiles as the dashboard, in a grid.
              A list of name-plus-toggle rows could only ever switch a light on
              or off; a tile opens into the light's own expanded controls, which
              is what you want when one bulb in the group is wrong. */}
          <div className={`grid grid-cols-2 gap-[10px] pt-1 ${accessories.length > 4 ? 'max-h-[19rem] overflow-y-auto pr-1' : ''}`}>
            {accessories.map((accessory) => {
              const isAccessoryExpanded = expandedAccessoryId === accessory.id;
              return (
                <div
                  key={accessory.id}
                  data-expandable-widget
                  className="relative cursor-pointer"
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpandedAccessoryId(isAccessoryExpanded ? null : accessory.id);
                  }}
                >
                  {onAccessoryToggle && onAccessorySlider && getEffectiveValue && (
                    <>
                      <AccessoryWidget
                        accessory={accessory}
                        onToggle={onAccessoryToggle}
                        onSlider={onAccessorySlider}
                        getEffectiveValue={getEffectiveValue}
                        compact
                        iconStyle={iconStyle}
                        disabled={effectiveDisabled}
                      />
                      <ExpandedOverlay
                        isExpanded={isAccessoryExpanded}
                        onClose={() => setExpandedAccessoryId(null)}
                      >
                        <AccessoryWidget
                          accessory={accessory}
                          onToggle={onAccessoryToggle}
                          onSlider={onAccessorySlider}
                          getEffectiveValue={getEffectiveValue}
                          compact={false}
                          expanded
                          iconStyle={iconStyle}
                          disabled={effectiveDisabled}
                        />
                      </ExpandedOverlay>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {effectiveDisabled && effectiveOnDisabledClick && (
            <div
              className="absolute inset-0 z-50 pointer-events-auto cursor-default"
              onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
            />
          )}
          <ExpandedActionBar actions={groupActions} onDark={!groupOn && isDarkBackground} />
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
              {canShowHistory && (
                <ContextMenuItem onClick={() => openGroupHistory(group)}>
                  <LineChart className="h-4 w-4 mr-2" />
                  Analytics
                </ContextMenuItem>
              )}
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
              {menuOnHide && (
                <ContextMenuItem onClick={menuOnHide}>
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
              {menuOnToggleShowHidden && <ContextMenuSeparator />}
              {menuOnToggleShowHidden && (
                <ContextMenuItem onClick={menuOnToggleShowHidden}>
                  {showHiddenItems ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                  {showHiddenItems ? 'Hide Hidden Items' : 'Show Hidden Items'}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
          {hiddenLabel}
          {editActions}
          {/* Expanded overlay for compact mode */}
          <ExpandedOverlay
            isExpanded={isWidgetExpanded}
            onClose={handleOverlayMouseLeave}
            onMouseEnter={() => {}}
            onMouseLeave={handleOverlayMouseLeave}
            // Wider than a single-device panel: two bars side by side plus a
            // two-column grid of members need the room.
            width={360}
           
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
        {hiddenLabel}
        {editActions}
        {/* Expanded overlay for compact mode */}
        <ExpandedOverlay
          isExpanded={isWidgetExpanded}
          onClose={handleOverlayMouseLeave}
          onMouseEnter={() => {}}
          onMouseLeave={handleOverlayMouseLeave}
          width={360}
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
