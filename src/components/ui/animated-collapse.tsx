import * as React from "react";
import { cn } from "@/lib/utils";

interface AnimatedCollapseProps {
  open: boolean;
  children: React.ReactNode;
  className?: string;
  fade?: boolean;
  /** When true, closing happens instantly without animation */
  instantClose?: boolean;
  /** When true, disables all transitions (useful during drag operations) */
  disableTransition?: boolean;
}

export const AnimatedCollapse: React.FC<AnimatedCollapseProps> = ({
  open,
  children,
  className,
  instantClose = false,
  disableTransition = false,
}) => {
  // Lazy unmount: keep children mounted while open or animating closed
  const [shouldRender, setShouldRender] = React.useState(open);

  React.useEffect(() => {
    if (open) {
      setShouldRender(true);
    } else {
      // Unmount children after close animation (200ms) to reduce DOM nodes
      const timeout = setTimeout(() => setShouldRender(false), instantClose ? 0 : 200);
      return () => clearTimeout(timeout);
    }
  }, [open, instantClose]);

  // Track if we should animate - always animate open, but respect instantClose for closing
  const shouldAnimate = !disableTransition && (open || !instantClose);

  return (
    <div
      className={cn(
        "grid",
        shouldAnimate && "transition-[grid-template-rows,opacity] duration-200 ease-out",
        className
      )}
      style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
    >
      <div
        className={cn(
          // min-w-0 as well as min-h-0: this is a grid item, and a grid item's
          // default `min-width: auto` refuses to shrink below its content's
          // intrinsic width. Anything with a wide intrinsic size — a
          // `datetime-local` input is the one that found this — widened the
          // item, and with `overflow-visible` while open it spilled out of the
          // card rather than being clipped. `w-full` on the child can't help;
          // the item is already wider than the card by then.
          "min-h-0 min-w-0",
          open ? "overflow-visible" : "overflow-hidden",
          shouldAnimate && "transition-opacity duration-200 ease-out"
        )}
        style={{ opacity: open ? 1 : 0 }}
      >
        {shouldRender ? children : null}
      </div>
    </div>
  );
};

interface AnimatedFadeProps {
  show: boolean;
  children: React.ReactNode;
  className?: string;
  duration?: number;
}

export const AnimatedFade: React.FC<AnimatedFadeProps> = ({
  show,
  children,
  className,
  duration = 200,
}) => {
  return (
    <div
      className={cn(
        "transition-opacity ease-out",
        className
      )}
      style={{
        opacity: show ? 1 : 0,
        transitionDuration: `${duration}ms`,
      }}
    >
      {children}
    </div>
  );
};
