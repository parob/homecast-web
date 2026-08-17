import * as React from "react";
import { TriStateToggle } from "@/components/ui/tri-state-toggle";
import type { TriState } from "./powerState";
import { useWidgetColors } from '../WidgetCard';

/**
 * The widget switch: a `TriStateToggle` wearing the service's colour.
 *
 * Colour is the only thing this adds, so it stays a wrapper rather than a
 * second implementation — the version that hand-rolled its own Radix switch had
 * already drifted from `ui/switch.tsx` in three details.
 *
 * `checked` is kept for the dozen widgets that control one accessory, which can
 * only ever be on or off. `state` is for callers that aggregate — pass it and
 * `checked` is ignored.
 */
interface ColoredSwitchProps {
  checked?: boolean;
  state?: TriState;
  onCheckedChange?: (next: boolean) => void;
  disabled?: boolean;
  'aria-label'?: string;
  /** Detail for the accessible description, e.g. "3 of 8 on". */
  description?: string;
  className?: string;
}

const ColoredSwitch = ({
  checked,
  state,
  onCheckedChange,
  disabled,
  description,
  className,
  'aria-label': ariaLabel,
}: ColoredSwitchProps) => {
  const { colors, iconStyle } = useWidgetColors();

  const resolved: TriState = state ?? (checked ? 'on' : 'off');

  // Service-type colour only in 'colourful' mode; 'standard' uses the primary.
  // Keyed on the resolved state rather than the context's isOn so the colour is
  // right even when the accessory is unreachable.
  const useColored = iconStyle === 'colourful' && resolved !== 'off';

  return (
    <TriStateToggle
      state={resolved}
      onCheckedChange={(next) => onCheckedChange?.(next)}
      disabled={disabled}
      label={ariaLabel}
      description={description}
      checkedColorClass={useColored ? colors.switchBg : 'bg-primary'}
      className={className}
    />
  );
};
ColoredSwitch.displayName = "ColoredSwitch";

export { ColoredSwitch };
