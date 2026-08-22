/**
 * How each connection quality looks, kept out of the component so the rules
 * can be tested rather than eyeballed against a throttled browser.
 *
 * Two rules here are load-bearing, and both are easy to lose in a later tidy-up:
 *
 *  1. **`good` carries no label and no motion.** The indicator is present at
 *     every state on purpose — an indicator that only appears when something is
 *     wrong is indistinguishable from one that is broken or not measuring, and
 *     leaves the user with nowhere to look. But being present is not the same
 *     as asking for attention: the healthy state has to cost nothing to ignore,
 *     or it becomes the noise it was meant to cut through.
 *
 *  2. **`unknown` is not a fault.** It means the evidence expired, which
 *     happens routinely and innocently every time a tab is backgrounded, since
 *     the heartbeat is suspended while hidden. Painting it amber would cry wolf
 *     on every resume.
 */

import type { ConnectionQuality } from '@/server/connection-quality';

export interface ConnectionPresentation {
  /** Shown beside the dot. `null` means the dot stands alone. */
  label: string | null;
  /** Tailwind background for the dot. */
  dotClass: string;
  /** Gentle attention. Only ever true for a state that is actively wrong. */
  pulse: boolean;
  /** Always present, for screen readers, even when there is no visible label. */
  srLabel: string;
  /** One line of plain speech for the popover. */
  headline: string;
}

const PRESENTATION: Record<ConnectionQuality, ConnectionPresentation> = {
  good: {
    label: null,
    // Legible as healthy if you look for it, invisible if you are not.
    dotClass: 'bg-emerald-500/60',
    pulse: false,
    srLabel: 'Connection is good',
    headline: 'Connection is good',
  },
  unknown: {
    label: null,
    // Neutral on purpose: this is the absence of a claim, not a bad one.
    dotClass: 'bg-muted-foreground/40',
    pulse: false,
    srLabel: 'Checking connection',
    headline: 'Checking connection…',
  },
  slow: {
    label: 'Slow',
    dotClass: 'bg-amber-500',
    pulse: false,
    srLabel: 'Connection is slow',
    headline: 'Your connection is slow',
  },
  stalled: {
    label: 'Not responding',
    dotClass: 'bg-amber-500',
    pulse: true,
    srLabel: 'Connection is not responding',
    headline: 'Your home is not responding',
  },
  offline: {
    label: 'Offline',
    dotClass: 'bg-red-500',
    pulse: false,
    srLabel: 'Disconnected',
    headline: "You're not connected",
  },
};

export function connectionPresentation(q: ConnectionQuality): ConnectionPresentation {
  return PRESENTATION[q] ?? PRESENTATION.unknown;
}

/**
 * A round-trip time as something worth reading.
 *
 * Returns null when there is nothing measured, so callers render "Checking…"
 * rather than a confident "0ms" — the same mistake, one layer up.
 */
export function formatRtt(ms: number | null | undefined): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return null;
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}
