import React, { createContext, useContext, memo } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuItem,
} from '@/components/ui/context-menu';
import { Trash2, Eye, EyeOff, Share2, Bug } from 'lucide-react';
import { AnimatedCollapse } from '@/components/ui/animated-collapse';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import { getDisplayName } from '@/lib/graphql/types';
import { useAccessoryStatus } from '@/lib/accessoryFreshness';
import { getAllCharacteristics, formatCharacteristicType, formatCharacteristicValue, ServiceType } from './types';
import { getIconColor, IconStyle, IconColor, DEFAULT_ICON_COLOR } from './iconColors';
import { useDragHandle } from '@/components/shared/SortableItem';
import { WidgetWrapper } from './WidgetWrapper';

// Context for passing widget colors to child components
export interface WidgetColorContextType {
  colors: IconColor;
  isOn: boolean;
  iconStyle: IconStyle;
}

export const WidgetColorContext = createContext<WidgetColorContextType>({
  colors: DEFAULT_ICON_COLOR,
  isOn: false,
  iconStyle: 'standard',
});

export const useWidgetColors = () => useContext(WidgetColorContext);

// Context for view-only interaction — shared views provide this so WidgetCard
// can show feedback when disabled controls are clicked (without modifying 25 widget files)
export interface WidgetInteractionContextType {
  disabled?: boolean;
  onDisabledClick?: () => void;
}

export const WidgetInteractionContext = createContext<WidgetInteractionContextType>({});

interface WidgetCardProps {
  title: string;
  subtitle?: React.ReactNode;
  icon: React.ReactNode;
  isOn?: boolean;
  isReachable?: boolean;
  headerAction?: React.ReactNode;
  children?: React.ReactNode;
  childrenVisible?: boolean;
  /** Content that renders outside the collapsed area, can overflow the card bounds */
  overlayContent?: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  accessory?: HomeKitAccessory;
  compact?: boolean;
  onExpandToggle?: () => void;
  /** Callback to show debug info for this accessory (admin only) */
  onDebug?: () => void;
  serviceType?: ServiceType | string | null;
  iconStyle?: IconStyle;
  /** When true, disables hover effects and interactivity (for drag mode) */
  editMode?: boolean;
  /** When true, widget is expanded and should float above others with glow effect */
  expanded?: boolean;
  /** Current edit mode type for showing appropriate visibility icon */
  editModeType?: 'ui' | null;
  /** Whether device is hidden in UI */
  isHiddenUi?: boolean;
  /** When true, reduces padding between header and content */
  tightContent?: boolean;
  /** Custom background class when widget is off (overrides default bg-muted/30) */
  offBgClass?: string;
  /** When true, allows title to wrap onto two lines instead of truncating */
  multiLineTitle?: boolean;
  /** Home name for tooltip display */
  homeName?: string;
  /** When true, disables tooltip (e.g., when any item is being dragged) */
  disableTooltip?: boolean;
  /** Callback to remove accessory from collection/group */
  onRemove?: () => void;
  /** Label for remove action (e.g., "Remove from Collection", "Remove from Group") */
  removeLabel?: string;
  /** Callback to hide accessory */
  onHide?: () => void;
  /** Label for hide action (e.g., "Hide from Room") */
  hideLabel?: string;
  /** Whether the accessory is currently hidden */
  isHidden?: boolean;
  /** Whether hidden items are currently being shown */
  showHiddenItems?: boolean;
  /** Callback to toggle showing hidden items */
  onToggleShowHidden?: () => void;
  /** Callback to share this accessory */
  onShare?: () => void;
  /** When true, controls are disabled and show as view-only */
  disabled?: boolean;
  /** Location subtitle (e.g., "Home · Room") shown after main subtitle in collections */
  locationSubtitle?: string;
}

export const WidgetCard = memo(React.forwardRef<HTMLDivElement, WidgetCardProps>(({
  title,
  subtitle,
  icon,
  isOn = false,
  isReachable = true,
  headerAction,
  children,
  childrenVisible,
  overlayContent,
  className = '',
  style,
  accessory,
  compact = false,
  onExpandToggle,
  onDebug,
  serviceType,
  iconStyle = 'standard',
  editMode = false,
  expanded = false,
  editModeType,
  isHiddenUi = false,
  tightContent = false,
  offBgClass,
  multiLineTitle = false,
  homeName,
  disableTooltip = false,
  onRemove,
  removeLabel,
  onHide,
  hideLabel,
  isHidden = false,
  showHiddenItems,
  onToggleShowHidden,
  onShare,
  disabled = false,
  locationSubtitle,
}, ref) => {
  // Read interaction context (provided by shared views for view-only mode)
  const interactionCtx = useContext(WidgetInteractionContext);
  const effectiveDisabled = disabled || interactionCtx.disabled || false;
  const effectiveOnDisabledClick = interactionCtx.onDisabledClick;

  // "No response" resolves from observed behaviour (fresh values / recent
  // control failure), not purely HMAccessory.isReachable — which HomeKit
  // famously leaves stuck false while reads still succeed. See
  // lib/accessoryFreshness.ts for the exact rule.
  const status = useAccessoryStatus(accessory?.id, isReachable);
  const effectiveIsReachable = status === 'responsive';

  // When not responding, default to off state visually
  const effectiveCompact = compact;
  const effectiveIsOn = effectiveIsReachable ? isOn : false;
  const effectiveOnExpandToggle = onExpandToggle;

  // Get colors for this service type (used for 'standard' and 'colourful' styles)
  const useServiceColors = (iconStyle === 'standard' || iconStyle === 'colourful') && serviceType;
  const widgetColors = useServiceColors ? getIconColor(serviceType) : DEFAULT_ICON_COLOR;

  const effectiveHeaderAction = editModeType ? undefined : headerAction;
  // If childrenVisible is not explicitly set, default to true when children exist
  const showChildren = childrenVisible ?? !!children;
  const characteristics = accessory ? getAllCharacteristics(accessory) : [];
  const hasCharacteristics = characteristics.length > 0;

  // Strip room prefix from title if it matches the accessory's room
  const displayTitle = accessory ? getDisplayName(title, accessory.roomName) : title;

  const handleCardClick = (e: React.MouseEvent) => {
    if (effectiveDisabled) return;
    // Allow toggling between compact and expanded states
    if (effectiveOnExpandToggle) {
      e.preventDefault();
      e.stopPropagation();
      effectiveOnExpandToggle();
    }
  };

  // Determine icon background and text color classes based on icon style
  // 'standard' and 'colourful' both use service-type colors for icons
  // 'basic' uses primary/muted colors
  const iconColor = useServiceColors ? getIconColor(serviceType) : null;
  const iconBgClass = iconColor
    ? (effectiveIsOn ? iconColor.bg : iconColor.bgOff)
    : (effectiveIsOn ? 'bg-primary' : 'bg-muted hover:bg-muted/80');
  const iconTextClass = iconColor
    ? (effectiveIsOn ? iconColor.text : iconColor.textOff)
    : (effectiveIsOn ? 'text-primary-foreground' : '');
  const iconShadowClass = effectiveIsOn ? (iconColor ? 'shadow-sm' : 'shadow-sm shadow-primary/25') : '';

  // Determine card background class based on state and icon style
  // Only 'colourful' style uses service-type colored card backgrounds
  // Card is always transparent - background handled externally
  const cardBgClass = '!bg-transparent';

  // Icon opacity: more visible when off but reachable, very faded when not responding
  const iconOpacityClass = !effectiveIsReachable
    ? 'opacity-20 grayscale'  // No Response: very faded
    : (!effectiveIsOn ? 'opacity-70' : '');  // Off but reachable: slightly faded, On: full

  // Effective subtitle - show "No Response" when device is not reachable
  // When locationSubtitle is provided, show it as a second line or after the main subtitle
  const effectiveSubtitle = !effectiveIsReachable ? 'No Response' : (
    locationSubtitle
      ? (subtitle ? <>{subtitle}<span className="opacity-60"> {locationSubtitle}</span></> : <span className="opacity-80">{locationSubtitle}</span>)
      : subtitle
  );

  // Icon element (shared between compact and non-compact)
  const iconElement = (
    <div className={`shrink-0 items-center justify-center flex ${
      effectiveCompact ? 'h-8 w-8 rounded-full' : 'h-9 w-9 rounded-full'
    } ${iconBgClass} ${iconTextClass} ${iconShadowClass} ${iconOpacityClass}`}>
      <div className="[&>svg]:h-4 [&>svg]:w-4">
        {icon}
      </div>
    </div>
  );

  // Compact mode header content - vertical layout matching preview style
  const compactHeaderContent = (
    <div className="space-y-2">
      <div className="flex items-start justify-between">
        {iconElement}
        {effectiveHeaderAction && (
          <div
            className={`relative shrink-0 scale-75 origin-top-right ${effectiveDisabled ? 'pointer-events-none' : ''}`}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {effectiveHeaderAction}
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
        <CardTitle className={`text-xs font-medium truncate selectable`}>
          {displayTitle}
        </CardTitle>
        <CardDescription className={`text-[10px] mt-0.5 selectable`}>
          {effectiveSubtitle || '\u00A0'}
        </CardDescription>
      </div>
    </div>
  );

  // Hide subtitle when multiLineTitle AND reachable (to allow title wrapping)
  // But always show subtitle when not responding (to display "No Response")
  const hideSubtitleForMultiLine = multiLineTitle && effectiveIsReachable;

  // Non-compact mode header content - horizontal layout
  const headerContent = (
    <div className="flex min-w-0 gap-2.5 items-center">
      {iconElement}
      <div className="min-w-0 flex-1">
        <div className={!effectiveSubtitle && !multiLineTitle ? 'translate-y-2' : 'translate-y-0'}>
          <CardTitle className={`font-medium leading-tight text-sm ${multiLineTitle ? 'line-clamp-2' : 'truncate'} selectable`}>
            {displayTitle}
          </CardTitle>
          <div className={`overflow-hidden ${hideSubtitleForMultiLine ? 'max-h-0 opacity-0' : 'max-h-8 opacity-100'}`}>
            <CardDescription
              className={`text-xs mt-0.5 ${effectiveSubtitle ? 'opacity-100' : 'opacity-0'} selectable`}
            >
              {effectiveSubtitle || '\u00A0'}
            </CardDescription>
          </div>
        </div>
      </div>
    </div>
  );

  // Apply No Response styling to inner content only, not the tooltip portal
  const noResponseClass = !effectiveIsReachable ? 'opacity-50 grayscale' : '';

  // Hidden state styling - applied to content, not visibility button
  // Use isHidden prop (for context menu hide) or isHiddenUi (for edit mode)
  const isCurrentlyHidden = isHidden || (editModeType === 'ui' && isHiddenUi);
  const hiddenClass = isCurrentlyHidden ? 'opacity-40 grayscale' : '';

  // Hidden badge - floating centered overlay (always show when hidden)
  // Rendered outside the Card element so it's not affected by the card's opacity/grayscale
  const hiddenBadge = isHidden ? (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
      <span className="bg-zinc-500/90 text-white text-xs font-medium px-2.5 py-1 rounded-full shadow-sm">
        Hidden
      </span>
    </div>
  ) : null;

  // Expanded state styling: just z-index, shadow is on ExpandedOverlay wrapper
  const expandedClass = expanded
    ? 'relative z-50'
    : '';

  // Create color context value
  const colorContextValue: WidgetColorContextType = {
    colors: widgetColors,
    isOn: effectiveIsOn,
    iconStyle,
  };

  // Get drag handle from SortableItem context (if inside a sortable)
  const dragHandle = useDragHandle();
  const isDragging = dragHandle?.isDragging ?? false;

  // Wiggle offset for edit mode — derive from accessory ID for natural variation
  const wiggleOffset = editMode && accessory?.id
    ? `${(accessory.id.charCodeAt(0) % 5) * 0.05}deg`
    : undefined;
  const wiggleClass = editMode ? 'wiggle' : '';

  const cardInner = (
    <>
      <CardHeader className={effectiveCompact ? "p-3" : `p-4 ${showChildren ? (tightContent ? 'pb-0' : 'pb-2') : 'pb-4'}`}>
        {effectiveCompact ? (
          // Compact mode - vertical layout with switch inside
          <div
            className={`${noResponseClass} ${hiddenClass} ${isDragging ? '!cursor-grabbing' : '!cursor-pointer'}`}
            {...(dragHandle?.attributes || {})}
            {...(dragHandle?.listeners || {})}
          >
            {compactHeaderContent}
          </div>
        ) : (
          // Non-compact mode - horizontal layout with separate switch
          <div className="flex items-center justify-between gap-2">
            <div
              className={`min-w-0 flex-1 ${noResponseClass} ${hiddenClass} ${isDragging ? '!cursor-grabbing' : '!cursor-default'}`}
              {...(dragHandle?.attributes || {})}
              {...(dragHandle?.listeners || {})}
            >
              {headerContent}
            </div>
            {effectiveHeaderAction && (
              <div
                className={`relative shrink-0 ${effectiveDisabled ? 'pointer-events-none' : ''}`}
                onPointerDown={(e) => e.stopPropagation()}
              >
                {effectiveHeaderAction}
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
      {children && (
        <AnimatedCollapse open={!effectiveCompact && showChildren}>
          <CardContent
            className={`px-4 pb-4 ${tightContent ? 'pt-0' : 'pt-2'}`}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className={`relative z-10 ${effectiveDisabled ? 'pointer-events-none' : 'pointer-events-auto cursor-auto'} ${noResponseClass} ${hiddenClass}`}>
              {children}
              {effectiveDisabled && effectiveOnDisabledClick && (
                <div
                  className="absolute inset-0 z-50 pointer-events-auto cursor-default"
                  onClick={(e) => { e.stopPropagation(); effectiveOnDisabledClick(); }}
                />
              )}
            </div>
          </CardContent>
        </AnimatedCollapse>
      )}
      {/* Overlay content renders outside AnimatedCollapse to allow overflow */}
      {overlayContent}
    </>
  );


  // Wrap with context menu if we have characteristics, location info, or actions to show
  // Context menu appears on right-click (desktop) or long-press (touch)
  const hasContextMenuContent = hasCharacteristics || homeName || accessory?.roomName || onRemove || onHide || onToggleShowHidden || onShare || onDebug;
  if (hasContextMenuContent && !editMode && !isDragging && !disableTooltip) {
    return (
      <WidgetColorContext.Provider value={colorContextValue}>
        <WidgetWrapper isOn={effectiveIsOn} iconStyle={iconStyle} accentColorClass={widgetColors?.blurBg}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <Card
                ref={ref}
                onClick={handleCardClick}
                className={`relative ${cardBgClass} ${effectiveCompact ? 'cursor-pointer active:scale-[0.97]' : 'cursor-default'} transition-[transform,opacity] hover:opacity-80 ${expandedClass} ${hiddenClass} ${className}`}
                style={style}
              >
                {cardInner}
              </Card>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              {(homeName || accessory?.roomName) && (
                <>
                  <ContextMenuLabel className="text-xs text-muted-foreground font-normal">
                    {homeName && accessory?.roomName
                      ? `${homeName} · ${accessory.roomName}`
                      : homeName || accessory?.roomName}
                  </ContextMenuLabel>
                  <ContextMenuSeparator />
                </>
              )}
              {characteristics.length > 5 ? (
                <ScrollArea className="h-[180px]">
                  {characteristics.map((char, i) => (
                    <div key={i} className="flex justify-between px-2 py-1.5 text-sm">
                      <span className="text-muted-foreground">
                        {formatCharacteristicType(char.type)}
                      </span>
                      <span>{formatCharacteristicValue(char.type, char.value)}</span>
                    </div>
                  ))}
                </ScrollArea>
              ) : (
                characteristics.map((char, i) => (
                  <div key={i} className="flex justify-between px-2 py-1.5 text-sm">
                    <span className="text-muted-foreground">
                      {formatCharacteristicType(char.type)}
                    </span>
                    <span>{formatCharacteristicValue(char.type, char.value)}</span>
                  </div>
                ))
              )}
              {(onShare || onRemove || onHide || onDebug) && characteristics.length > 0 && <ContextMenuSeparator />}
              {onShare && (
                <ContextMenuItem onClick={onShare}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share Accessory
                </ContextMenuItem>
              )}
              {onHide && (
                <ContextMenuItem onClick={onHide}>
                  {isHidden ? <Eye className="h-4 w-4 mr-2" /> : <EyeOff className="h-4 w-4 mr-2" />}
                  {hideLabel || (isHidden ? 'Unhide Accessory' : 'Hide Accessory')}
                </ContextMenuItem>
              )}
              {onDebug && (
                <ContextMenuItem onClick={onDebug}>
                  <Bug className="h-4 w-4 mr-2" />
                  Debug Accessory
                </ContextMenuItem>
              )}
              {onRemove && (
                <ContextMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  {removeLabel || 'Remove Accessory'}
                </ContextMenuItem>
              )}
              {(onShare || onHide || onDebug || onRemove) && onToggleShowHidden && <ContextMenuSeparator />}
              {onToggleShowHidden && (
                <ContextMenuItem onClick={onToggleShowHidden}>
                  {showHiddenItems ? <EyeOff className="h-4 w-4 mr-2" /> : <Eye className="h-4 w-4 mr-2" />}
                  {showHiddenItems ? 'Hide Hidden Items' : 'Show Hidden Items'}
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
          {/* Hidden badge outside Card so it's not affected by opacity/grayscale */}
          {hiddenBadge}
        </WidgetWrapper>
      </WidgetColorContext.Provider>
    );
  }

  return (
    <WidgetColorContext.Provider value={colorContextValue}>
      <div className={wiggleClass} style={{ '--wiggle-offset': wiggleOffset } as React.CSSProperties}>
        <WidgetWrapper isOn={effectiveIsOn} iconStyle={iconStyle} accentColorClass={widgetColors?.blurBg}>
          <Card
            ref={ref}
            onClick={handleCardClick}
            className={`relative ${cardBgClass} ${effectiveCompact ? 'cursor-pointer active:scale-[0.97]' : 'cursor-default'} transition-[transform,opacity] hover:opacity-80 ${expandedClass} ${hiddenClass} ${className}`}
          >
            {cardInner}
          </Card>
          {/* Hidden badge outside Card so not affected by opacity/grayscale */}
          {hiddenBadge}
        </WidgetWrapper>
      </div>
    </WidgetColorContext.Provider>
  );
}));

WidgetCard.displayName = 'WidgetCard';
