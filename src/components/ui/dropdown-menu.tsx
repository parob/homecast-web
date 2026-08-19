import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";

import { cn } from "@/lib/utils";
import { OVERLAY_SCRIM, scrimCutout } from "@/lib/overlay-scrim";

const DropdownMenu = DropdownMenuPrimitive.Root;

/**
 * The trigger, which goes solid white while its menu is open.
 *
 * `asChild` is the norm at these call sites (the trigger is a `Button`), and
 * Radix's Slot concatenates className onto the child — so this lands on the
 * real button rather than replacing whatever it already wore.
 */
const DropdownMenuTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Trigger
    ref={ref}
    className={cn(
      "transition-colors duration-fast",
      "data-[state=open]:!bg-white data-[state=open]:!text-black",
      // No z-index here on purpose. Lifting the trigger over the scrim cannot
      // work — see MenuScrim — so the scrim is cut open around it instead, and
      // the button stays exactly where its call site put it.
      "data-[state=open]:shadow-sm",
      className,
    )}
    {...props}
  />
));
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;

const DropdownMenuGroup = DropdownMenuPrimitive.Group;

/**
 * The dim behind a card menu, with the trigger punched out of it.
 *
 * Two earlier attempts failed for the same reason. Raising the trigger over the
 * scrim needs it to win a z-index race, and it cannot: `AppHeader` and the tab
 * bar are `fixed z-[10001]`, a dnd-kit drag transform and a `backdrop-filter`
 * glass tile each establish a stacking context of their own, and nothing inside
 * one can be painted above something outside it no matter what z-index it
 * carries. The button went white and stayed under the blur.
 *
 * So nothing is reordered. The scrim is clipped so the trigger's own patch of
 * screen is never painted over in the first place — no dim there and, because
 * `backdrop-filter` only applies where the element actually paints, no blur
 * either. The real button shows through, crisp and lit, wherever it happens to
 * live in the tree. This is what an iOS context menu does.
 *
 * A browser without `clip-path: path()` gets an uncut scrim, which is the old
 * behaviour rather than a broken one.
 */
function MenuScrim({ className }: { className?: string }) {
  const [clip, setClip] = React.useState<string | undefined>(undefined);
  const ref = React.useRef<HTMLDivElement>(null);

  React.useLayoutEffect(() => {
    const measure = () => {
      // Radix keeps exactly one menu open at a time, so this is unambiguous.
      const trigger = document.querySelector<HTMLElement>(
        '[aria-haspopup="menu"][data-state="open"]',
      );
      const t = trigger?.getBoundingClientRect();
      // This scrim is `fixed inset-0`, so its box is the viewport — but it is
      // measured rather than assumed, because the one that is not (see
      // ExpandedOverlay) cost a misplaced hole and a gap along the bottom.
      const box = ref.current?.getBoundingClientRect();
      setClip(box && t
        ? scrimCutout(box.width, box.height, {
            left: t.left - box.left, top: t.top - box.top, width: t.width, height: t.height,
          })
        : undefined);
    };
    measure();
    // The scrim is `fixed`, so its coordinates are the viewport's: anything
    // that moves the trigger within it has to move the hole too.
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, []);

  return <div ref={ref} aria-hidden style={{ clipPath: clip }} className={className} />;
}

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuSub = DropdownMenuPrimitive.Sub;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center rounded-md px-2.5 py-2 text-sm outline-none data-[state=open]:bg-accent focus:bg-accent data-[highlighted]:bg-accent active:bg-accent",
      inset && "pl-8",
      className,
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto h-4 w-4" />
  </DropdownMenuPrimitive.SubTrigger>
));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-[10060] min-w-[8rem] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className,
    )}
    {...props}
  />
));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    /**
     * Draw the app's blurred scrim behind the menu, and grow the menu out of
     * its trigger rather than fading it in alongside.
     *
     * For the card menus — the `⋮` ones — where the menu is the only thing
     * that matters while it is up. Left off for the incidental dropdowns (a
     * sort order, a picker) where blurring the whole page to choose "Name"
     * would be a lot of ceremony.
     */
    scrim?: boolean;
  }
>(({ className, sideOffset = 4, scrim, ...props }, ref) => (
  <>
    {/* Its own portal, not a sibling of the content inside one.
        Radix's Portal renders `<Primitive.div asChild>`, which is
        `Children.only` — and a `{cond && ...}` that evaluates to `false`
        still counts as a second child, so every menu WITHOUT a scrim threw.
        One child each. It mounts and unmounts with the menu, so it needs no
        open state of its own; Radix already blocks outside interaction while a
        menu is up, leaving this with nothing to do but be seen. */}
    {scrim && (
      <DropdownMenuPrimitive.Portal>
        <MenuScrim
          className={cn(
            // Under the app chrome, not over it.
            //
            // AppHeader is `fixed z-[10001]` and the tab bar likewise — both
            // are stacking contexts, so a scrim above them covers everything
            // inside them and nothing within can climb back out. The header's
            // own ⋮ went white and then disappeared under the dim. Below them
            // the chrome and its lit trigger stay visible, and a trigger in
            // ordinary page flow still lifts clear on its own.
            "fixed inset-0 z-[10000] animate-in fade-in-0 duration-base",
            OVERLAY_SCRIM,
          )}
        />
      </DropdownMenuPrimitive.Portal>
    )}
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      // Radix computes the corner nearest the trigger. Scaling from there is
      // what makes the menu look like it unfolded out of the button; the
      // default origin scales it from its own middle, which reads as a
      // separate object arriving.
      style={scrim ? { transformOrigin: "var(--radix-dropdown-menu-content-transform-origin)" } : undefined}
      className={cn(
        "z-[10060] min-w-[8rem] overflow-hidden rounded-xl border bg-popover p-1 text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        scrim && [
          "border-0 shadow-2xl duration-base",
          // Overrides the 95% above — a menu that grows from 75% at the
          // trigger's corner is legible as one movement out of the button.
          "data-[state=open]:zoom-in-75 data-[state=closed]:zoom-out-75",
          // It is coming OUT of the button, not sliding in beside it.
          "data-[side=bottom]:slide-in-from-top-0 data-[side=top]:slide-in-from-bottom-0",
          "data-[side=left]:slide-in-from-right-0 data-[side=right]:slide-in-from-left-0",
        ],
        className,
      )}
      {...props}
      />
    </DropdownMenuPrimitive.Portal>
  </>
));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-md px-2.5 py-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground active:bg-accent active:text-accent-foreground",
      inset && "pl-8",
      className,
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground active:bg-accent active:text-accent-foreground",
      className,
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground active:bg-accent active:text-accent-foreground",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className)}
    {...props}
  />
));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-muted", className)} {...props} />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

const DropdownMenuShortcut = ({ className, ...props }: React.HTMLAttributes<HTMLSpanElement>) => {
  return <span className={cn("ml-auto text-xs tracking-widest opacity-60", className)} {...props} />;
};
DropdownMenuShortcut.displayName = "DropdownMenuShortcut";

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
};
