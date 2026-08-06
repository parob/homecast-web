import React, { useState } from 'react';
import { Slider } from '@/components/ui/slider';
import { LucideIcon } from 'lucide-react';
import { useWidgetColors } from '../WidgetCard';

interface SliderControlProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  formatValue?: (value: number) => string;
  onCommit: (value: number) => void;
  disabled?: boolean;
  icon?: LucideIcon;
  iconLeft?: LucideIcon;
  iconRight?: LucideIcon;
  compact?: boolean;
  trackBgClass?: string;
  trackColorClass?: string;
  fixedGradient?: boolean;
  /** Override for the expanded (large) sizing; defaults to the WidgetCard context */
  expanded?: boolean;
}

export const SliderControl: React.FC<SliderControlProps> = ({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  formatValue,
  onCommit,
  disabled = false,
  icon: Icon,
  iconLeft: IconLeft,
  iconRight: IconRight,
  compact = false,
  trackBgClass,
  trackColorClass: trackColorClassProp,
  fixedGradient,
  expanded,
}) => {
  const [dragging, setDragging] = useState<number | null>(null);
  const { colors, isOn, iconStyle, expanded: ctxExpanded } = useWidgetColors();
  const isLarge = !compact && (expanded ?? ctxExpanded);
  // The track is the hit target, and an 18px bar is fiddly with a mouse and
  // worse with a thumb. Anything that isn't a compact tile gets the tall track,
  // whether or not it is in the expanded panel. Label sizing still follows
  // isLarge — this is about the grab area, not the typography.
  const tallTrack = !compact;

  const displayValue = dragging !== null ? dragging : value;
  const formattedValue = formatValue ? formatValue(displayValue) : `${Math.round(displayValue)}${unit}`;

  // Only 'colourful' mode uses service-type colors for sliders
  // 'standard' and 'basic' use plain blue (primary) colors
  const useColoredSlider = iconStyle === 'colourful';
  const trackColorClass = trackColorClassProp !== undefined ? trackColorClassProp : (useColoredSlider ? colors.sliderTrack : undefined);
  const thumbColorClass = useColoredSlider ? `border-${colors.sliderThumb.replace('bg-', '')}` : undefined;

  const labelTextClass = compact ? 'text-[10px]' : (isLarge ? 'text-[13px]' : 'text-xs');
  const iconSizeClass = compact ? 'h-2.5 w-2.5' : (isLarge ? 'h-[16px] w-[16px]' : 'h-3 w-3');

  return (
    <div className={`${compact ? "space-y-1" : "space-y-2"} ${disabled ? 'cursor-not-allowed opacity-60 grayscale' : ''}`}>
      <div className="flex items-center justify-between">
        <div className={`flex items-center text-muted-foreground ${compact ? 'gap-1' : 'gap-1.5'} ${labelTextClass}`}>
          {Icon && <Icon className={iconSizeClass} />}
          <span>{label}</span>
        </div>
        <span className={`font-medium ${labelTextClass}`}>{formattedValue}</span>
      </div>
      <div className={`flex items-center ${compact ? 'gap-2' : 'gap-3'} ${disabled ? 'cursor-not-allowed' : ''}`}>
        {IconLeft && <IconLeft className={`${iconSizeClass} shrink-0`} />}
        <Slider
          value={[displayValue]}
          min={min}
          max={max}
          step={step}
          onValueChange={(v) => setDragging(v[0])}
          onValueCommit={(v) => {
            setDragging(null);
            onCommit(v[0]);
          }}
          disabled={disabled}
          className={`flex-1 ${disabled ? 'cursor-not-allowed' : ''}`}
          size={tallTrack ? 'lg' : 'default'}
          trackColorClass={trackColorClass}
          thumbColorClass={thumbColorClass}
          trackBgClass={trackBgClass}
          fixedGradient={fixedGradient}
        />
        {IconRight && <IconRight className={`${iconSizeClass} shrink-0`} />}
      </div>
    </div>
  );
};
