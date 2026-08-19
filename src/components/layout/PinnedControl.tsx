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
    <div className="flex flex-col gap-1.5">
      <p
        className={cn(
          // Sits on the overlay's own glass, not on a surface of its own — a
          // second panel above the panel would read as two things open.
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
