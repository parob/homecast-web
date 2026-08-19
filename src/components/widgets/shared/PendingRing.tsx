import React from 'react';
import { usePendingWrite } from '@/hooks/usePendingWrite';

interface PendingRingProps {
  /**
   * Which registry key to watch. Undefined never rings — which is what keeps
   * the MQTT browser's widgets inert. Its handlers are fire-and-forget publishes
   * with no promise to track, so nothing ever registers their synthetic ids and
   * the ring is off by construction rather than by a flag someone has to
   * remember to pass.
   */
  pendingKey?: string;
  /**
   * Force the ring on from the caller's own state, ignoring the registry.
   *
   * For a caller that already knows, and knows something broader: the tab bar's
   * "running" spans a whole activation — a scene, a popover opening — not just
   * the writes a registry key can see. Keying it off `pendingKey` alone would
   * have silently dropped the spinner for every pin that is not an action.
   */
  pending?: boolean;
  /**
   * Draw the ring outside the child rather than on its rim.
   *
   * For a bare glyph with no chip behind it. On the rim, a ring would cut
   * straight through the icon; the tile and action-card variants get away with
   * `inset-0` only because they wrap a coloured circle the glyph sits inside.
   */
  outset?: boolean;
  /**
   * Repeat the icon circle's own size (`h-8 w-8` …) and its text colour here.
   *
   * The size, because the arc is `inset-0` and has to land on the circle's rim.
   * The colour, because `border-t-current` then picks up `iconTextClass` — and
   * the palette already pairs every `text` with the `bg` it sits on
   * (`iconColors.ts`), so contrast is guaranteed in both themes, over both
   * wallpapers, on and off, with no branching here.
   *
   * Deliberately NOT the opacity class. An off tile fades its icon to 70% and an
   * unreachable one to 20% and greyscale, and "still sending" is the one thing
   * on a No Response tile that has to stay legible.
   */
  className?: string;
  children: React.ReactNode;
}

/**
 * An arc that sweeps around a tile's icon while its write is still travelling.
 *
 * Around rather than instead of: the glyph is how you find a tile, and swapping
 * it for a spinner makes a grid of pending accessories unreadable at exactly
 * the moment you want to scan it.
 *
 * It rides the circle's rim rather than floating outside it. Outside, the arc
 * would sit on the card glass, where there is no colour that works — a plain
 * div inherits `text-card-foreground` (dark), and `WidgetWrapper` only forces
 * white onto `h3`/`p`/`span`, so an off tile over a dark wallpaper would draw a
 * dark arc on a dark backdrop. On the rim it inherits a colour the palette has
 * already proved against that exact fill.
 *
 * Absolutely positioned, so the ring costs no layout and the tile never moves.
 *
 * `aria-busy` rather than a live region: during an Action run forty tiles go
 * pending at once, and forty announcements of "sending" would bury the progress
 * count `ActionCard` is already reading out.
 */
export const PendingRing: React.FC<PendingRingProps> = ({ pendingKey, pending, outset, className = '', children }) => {
  const tracked = usePendingWrite(pendingKey);
  const show = pending ?? tracked;
  // Written as whole literals so Tailwind's scanner sees both class names.
  const ringInset = outset ? '-inset-1' : 'inset-0';
  return (
    <div className={`relative inline-flex shrink-0 ${className}`} aria-busy={show || undefined}>
      {children}
      {show && (
        <>
          {/* The track. Without it the sweeping segment is the only ink on the
              rim, and a lone 90 degree mass orbiting an icon reads as a wobble
              — the ring looks off-centre even though it is exactly concentric.
              A fixed faint circle gives the eye something to hold, and the
              bright part becomes motion along it.

              Element opacity rather than `border-current/20`: Tailwind 3 cannot
              put an opacity modifier on `currentColor`, which has no colour
              channels to multiply. */}
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute ${ringInset} rounded-full border-2 border-current opacity-20`}
          />
          <span
            aria-hidden="true"
            className={`pointer-events-none absolute ${ringInset} rounded-full border-2 border-transparent border-t-current animate-spin motion-reduce:animate-none`}
          />
        </>
      )}
    </div>
  );
};
