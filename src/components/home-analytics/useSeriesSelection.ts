import { useCallback, useState } from 'react';

/**
 * What the stacked panels are currently picking out.
 *
 * Two layers, and they are not the same thing:
 *
 *  · `hovered` — transient. Pointing at a line, or at its name in the key,
 *    lifts it and fades the rest. It follows the pointer and it leaves with it.
 *  · `latched` — sticky. Clicking latches, and a latched set is a FILTER
 *    rather than a highlight: it survives the pointer leaving, it takes several
 *    at once, and while anything is latched hovering stops moving it, so a
 *    chart you have narrowed down stays narrowed while you read it.
 *
 * Both are keyed by IDENTITY — the accessory, or the room when the view is
 * per-room averages — never by series key, because pointing at Underfloor
 * Heating's temperature must also pick out its humidity in the panel below,
 * and those are two different series.
 *
 * The invariant that holds the whole thing together: **anything latched ⇒
 * nothing hovered**. Hover updates are dropped while a latch exists (the
 * callers guard on `latched.size`), so a `hovered` left standing across a latch
 * is a value nothing can correct — and `highlight` falls straight back to it
 * the moment the last latch goes. That is how releasing the last selection used
 * to leave one line lit and every other line, in every panel, faded. On a phone
 * the stale value is a phantom to begin with: a tap synthesises `mouseenter`,
 * and nothing synthesises the leave until you tap somewhere else — which is
 * exactly what "I have to tap elsewhere before it comes back" was.
 */
export interface SeriesSelection {
  /** The identity under the pointer, or null. Ignored while anything is latched. */
  hovered: string | null;
  /** Only meaningful when nothing is latched; callers guard on `latched.size`. */
  setHovered: (id: string | null) => void;
  /** The latched identities. Empty means "no filter". */
  latched: Set<string>;
  /** Latch an identity, or let it go. `null` lets EVERYTHING go. */
  toggleLatch: (id: string | null) => void;
  /** What the panels should light: the latch wins, then hover, then nothing. */
  highlight: string | null;
}

export function useSeriesSelection(): SeriesSelection {
  const [hovered, setHovered] = useState<string | null>(null);
  const [latched, setLatched] = useState<Set<string>>(new Set());

  const toggleLatch = useCallback((id: string | null) => {
    // Every latch change re-reads hover from scratch. While a latch is on the
    // value is ignored anyway, so clearing costs nothing there — and it means
    // the fallback below is always null when the last latch goes, so the whole
    // view comes back without waiting for a pointer event that, on touch, only
    // arrives when you tap something else.
    setHovered(null);
    // A click on empty plot lets everything go. The chart has documented this
    // since before the latch existed (see EChartsTimeChart's onClick); an
    // `if (!id) return` quietly killed it when the single pin became a set,
    // and it is the only way out of a selection you can no longer see.
    if (!id) {
      setLatched(prev => (prev.size === 0 ? prev : new Set()));
      return;
    }
    setLatched(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  return {
    hovered,
    setHovered,
    latched,
    toggleLatch,
    highlight: latched.size > 0 ? null : hovered,
  };
}
