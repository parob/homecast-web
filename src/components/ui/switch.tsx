import * as React from "react";
import * as SwitchPrimitives from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

interface SwitchProps extends React.ComponentPropsWithoutRef<typeof SwitchPrimitives.Root> {
  /** Custom class for the checked/on state background color */
  checkedColorClass?: string;
  /** Custom class for the unchecked/off state background color */
  uncheckedColorClass?: string;
  /** Custom class for the thumb when unchecked */
  uncheckedThumbClass?: string;
}

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitives.Root>,
  SwitchProps
>(({ className, checkedColorClass, uncheckedColorClass, uncheckedThumbClass, checked, ...props }, ref) => {
  // When a custom checked color is provided, apply it directly based on checked state
  // Otherwise use the default data-attribute based styling
  const bgClass = checkedColorClass || uncheckedColorClass
    ? (checked ? (checkedColorClass || 'bg-primary') : (uncheckedColorClass || 'bg-muted'))
    : '';
  const defaultCheckedClass = checkedColorClass || uncheckedColorClass ? '' : 'data-[state=checked]:bg-primary';
  const defaultUncheckedClass = uncheckedColorClass ? '' : 'data-[state=unchecked]:bg-muted';

  return (
    <SwitchPrimitives.Root
      className={cn(
        "peer inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",
        defaultUncheckedClass,
        defaultCheckedClass,
        bgClass,
        className,
      )}
      checked={checked}
      {...props}
      ref={ref}
    >
      <SwitchPrimitives.Thumb
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-full shadow-sm ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-1",
          checked ? "bg-white/60" : (uncheckedThumbClass || "bg-background"),
        )}
      />
    </SwitchPrimitives.Root>
  );
});
Switch.displayName = SwitchPrimitives.Root.displayName;

export { Switch };
