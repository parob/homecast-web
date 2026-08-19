import { useBackgroundContext } from '@/contexts/BackgroundContext';
import { cn } from '@/lib/utils';

/**
 * A pinned accessory's control panel, with a line saying where it lives.
 *
 * Every other route to a control walks through its home and its room, so the
 * screen behind already says which "Lamp" you have open. A pinned tab skips all
 * of that — you can be three homes away — and two homes with a Kitchen Lamp
 * each were indistinguishable once expanded.
 *
 * Above the widget rather than inside it: the widget is the same component the
 * dashboard grid renders, where this line would be repeating what the page
 * title already says.
 */
export function PinnedControl({ context, children }: {
  context?: string;
  children: React.ReactNode;
}) {
  const { isDarkBackground } = useBackgroundContext();

  if (!context) return <>{children}</>;

  return (
    // The padding is the point. This sits on the overlay's own glass, and at
    // `px-1` with nothing above it the line was jammed into the panel's top-left
    // corner and read as something that had escaped rather than a caption. The
    // glass is `inset-0` of this box, so the padding grows the panel with it.
    <div className="flex flex-col gap-2 px-1.5 pt-1.5">
      <p
        className={cn(
          // No surface of its own — a second panel above the panel would read
          // as two things being open at once.
          'px-1 text-[11px] font-medium leading-none truncate',
          isDarkBackground ? 'text-white/70' : 'text-muted-foreground',
        )}
      >
        {context}
      </p>
      {children}
    </div>
  );
}
