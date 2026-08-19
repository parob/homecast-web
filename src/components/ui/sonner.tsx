import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

/**
 * The app's only toast surface.
 *
 * There used to be two — this one and a shadcn/Radix `<Toaster/>` mounted
 * beside it in App.tsx — which meant the same app answered in two shapes at two
 * different corners depending on which import a call site happened to reach
 * for. The Radix one is gone; everything routes through `toast()` from `sonner`.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="top-center"
      // Stacked, not piled. Sonner's default collapses everything after the
      // first into a peek behind it and only fans them out on hover — which on
      // a phone is a hover that never comes, so three toasts read as one toast
      // drawn slightly wrong. `expand` lays them out as a list from the start.
      expand
      gap={10}
      // Beyond three the column reaches the accessories. Older ones drop off
      // rather than the stack growing without limit.
      visibleToasts={3}
      offset="calc(16px + var(--safe-area-top) + var(--mac-app-inset, 0px))"
      mobileOffset="calc(16px + var(--safe-area-top) + var(--mac-app-inset, 0px))"
      toastOptions={{
        classNames: {
          // A capsule is a one-line shape: the moment an icon, a title and a
          // description share it, a 9999px radius pinches the text into the
          // curve. So the pill stays a pill only while it holds one line, and
          // relaxes to a large-radius card when a description is present —
          // which is the same thing the Dynamic Island does when it expands.
          toast: [
            "group toast",
            "group-[.toaster]:bg-background/80 group-[.toaster]:backdrop-blur-xl",
            "group-[.toaster]:text-foreground group-[.toaster]:border-transparent",
            "group-[.toaster]:shadow-lg",
            "group-[.toaster]:rounded-full group-[.toaster]:px-4 group-[.toaster]:py-2",
            "group-[.toaster]:[&:has([data-description])]:rounded-2xl",
            "group-[.toaster]:[&:has([data-description])]:px-4",
            "group-[.toaster]:[&:has([data-description])]:py-3",
          ].join(" "),
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
