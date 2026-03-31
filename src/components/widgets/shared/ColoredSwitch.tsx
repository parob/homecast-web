import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";
import { useWidgetColors } from '../WidgetCard';

interface ColoredSwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {}

const ColoredSwitch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  ColoredSwitchProps
>(({ className, checked, ...props }, ref) => {
  const { colors, iconStyle } = useWidgetColors();

  // Only use service-type colored switch in 'colourful' mode
  // 'standard' uses default primary colors
  // Use checked prop (not isOn from context) so coloring works even when unreachable
  const useColored = iconStyle === 'colourful' && checked;
  const bgClass = checked
    ? (useColored ? colors.switchBg : 'bg-primary')
    : 'bg-input';

  // Use semi-opaque white for thumb when checked to appear as lighter tint
  const thumbClass = checked ? 'bg-white/60' : 'bg-background';

  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-[colors,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 active:scale-90",
        bgClass,
        className
      )}
      checked={checked}
      onClick={(e) => e.stopPropagation()}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-1",
          thumbClass
        )}
      />
    </SwitchPrimitives.Root>
  );
});
ColoredSwitch.displayName = "ColoredSwitch";

export { ColoredSwitch };
