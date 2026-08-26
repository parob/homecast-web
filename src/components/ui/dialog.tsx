import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { DIALOG_Z, dialogElevation, topPanelElevation } from "@/lib/overlay-elevation";

/**
 * Reports the moment the dialog actually opens.
 *
 * `DialogContent` below is rendered by its caller whether or not the dialog is
 * open — `<Dialog open={!!target}><DialogContent>` mounts the wrapper once, on
 * the caller's first render, and it is Radix's portal that comes and goes. So
 * the wrapper cannot read anything about "the screen as it is right now" from
 * its own mount; by then nothing has happened yet. `DialogPortal` wraps each
 * child in `Presence`, so a sentinel INSIDE the content mounts exactly when the
 * dialog opens — and again on every reopen. A layout effect lands before paint,
 * so the elevation it sets is the one the first frame is drawn with.
 */
function OpenProbe({ onOpen }: { onOpen: () => void }) {
  React.useLayoutEffect(() => { onOpen(); }, [onOpen]);
  return null;
}

const Dialog = DialogPrimitive.Root;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogClose = DialogPrimitive.Close;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay> & { style?: React.CSSProperties }
>(({ className, style, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-[10050] bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    style={style}
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    hideCloseButton?: boolean;
    /** Restyle the backdrop, the same way SheetContent already allows. */
    overlayClassName?: string;
  }
>(({ className, children, style, hideCloseButton, overlayClassName, ...props }, ref) => {
  // A dialog opened FROM an expanded panel has to be above it — the panel is a
  // portal sibling, not an ancestor, so only z-index separates them. Measured
  // at open, not continuously: a dialog that a panel is later elevated INSIDE
  // must keep the level it opened with, or the two climb over each other.
  // See lib/overlay-elevation.
  const [panelAwareZ, setPanelAwareZ] = React.useState(DIALOG_Z);
  const measure = React.useCallback(
    () => setPanelAwareZ(dialogElevation(topPanelElevation())),
    [],
  );
  const zIndex = style?.zIndex ?? panelAwareZ;
  return (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} style={{ zIndex }} />
    <DialogPrimitive.Content
      ref={ref}
      aria-describedby={undefined}
      className={cn(
        // `grid-cols-[minmax(0,1fr)]` is load-bearing, not tidying. Without it
        // the single column is an `auto` track, whose floor is the items'
        // min-content width — and that floor is allowed to overflow the box it
        // sits in. A recharts chart renders `<svg width="391" style="100%">`,
        // and the pixel ATTRIBUTE is what min-content is taken from, so the
        // Analytics popup's track sized itself to 391px inside a 378px content
        // box: every row laid out 13px past the right padding, and the
        // `overflow-x-hidden` those callers add clipped the right-hand captions
        // mid-word. It ratchets, too — recharts then measures the wider track
        // and re-renders to match, so nothing brings it back down. minmax(0,·)
        // caps the track at the dialog's own width; content shrinks to fit.
        "fixed left-[50%] top-[50%] z-[10050] grid grid-cols-[minmax(0,1fr)] w-full max-w-[95vw] sm:max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] rounded-2xl",
        // A tall dialog must clear the notch. `100dvh` on iOS spans the whole
        // screen including the status bar, so capping against it alone slides
        // the header under the island. The dialog is centred, so it overhangs
        // both edges equally — the budget is twice the LARGER inset, not the
        // sum. A caller's own max-h still wins (tailwind-merge).
        "max-h-[calc(100dvh-2*max(var(--safe-area-top),var(--safe-area-bottom))-2rem)]",
        className,
      )}
      style={{ ...style, zIndex }}
      {...props}
    >
      <OpenProbe onOpen={measure} />
      {children}
      {!hideCloseButton && (
        <DialogPrimitive.Close className="absolute right-[13px] top-[16px] rounded-full p-2 opacity-70 ring-offset-background transition-[opacity,background-color] data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none">
          <X className="h-4 w-4" />
          <span className="sr-only">Close</span>
        </DialogPrimitive.Close>
      )}
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col space-y-1.5 text-center sm:text-left", className)} {...props} />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)} {...props} />
);
DialogFooter.displayName = "DialogFooter";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-sm text-muted-foreground", className)} {...props} />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
};
