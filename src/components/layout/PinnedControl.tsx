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
    // The padding is the point, and it is split deliberately. The vertical
    // padding is on this box, because the overlay's glass is `inset-0` of it
    // and so grows with it — that is what puts space above the caption rather
    // than jamming it into the panel's top corner. The horizontal inset is on
    // the caption itself, because padding here would narrow the widget below
    // instead, and the card is not what needed moving.
    //
    // Lands ~22px down and ~26px in from the panel edge, on top of the
    // overlay's own 10px ring.
    // `pb` as well as `pt`: the glass is `inset-0` of this box, so with padding
    // only above it stopped level with the widget's last pixel and the card's
    // bottom edge sat on the very rim of the panel — reading as cut off rather
    // than contained.
    <div className="flex flex-col gap-2 px-1.5 pb-2 pt-3">
      <p
        className={cn(
          // No surface of its own — a second panel above the panel would read
          // as two things being open at once.
          'px-2.5 text-[11px] font-medium leading-none truncate',
          isDarkBackground ? 'text-white/70' : 'text-muted-foreground',
        )}
      >
        {context}
      </p>
      {children}
    </div>
  );
}
