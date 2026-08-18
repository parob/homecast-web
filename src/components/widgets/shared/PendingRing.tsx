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
 * count `ActionsSection` is already reading out.
 */
export const PendingRing: React.FC<PendingRingProps> = ({ pendingKey, className = '', children }) => {
  const pending = usePendingWrite(pendingKey);
  return (
    <div className={`relative inline-flex shrink-0 ${className}`} aria-busy={pending || undefined}>
      {children}
      {pending && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-full border-2 border-transparent border-t-current animate-spin motion-reduce:animate-none motion-reduce:border-current motion-reduce:opacity-60"
        />
      )}
    </div>
  );
};
