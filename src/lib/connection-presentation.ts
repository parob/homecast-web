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
  connecting: {
    label: 'Connecting…',
    // Neutral, not amber. This carries the wording the connection toast used
    // to, and that toast was deliberately not a warning: "a drop is nearly
    // always transient, and 'Connection lost' in alarm colours asked the user
    // to act on something they cannot act on." Amber stays reserved for a
    // connection that is genuinely degraded. The motion is what says something
    // is happening.
    dotClass: 'bg-muted-foreground/60',
    pulse: true,
    srLabel: 'Connecting',
    headline: 'Reconnecting…',
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

/**
 * How long the recovery confirmation stays up.
 *
 * The old toast used 3000ms for "Reconnected" and this keeps that, because the
 * job is the same: close the loop on a message the user already saw, then get
 * out of the way.
 */
export const RECONNECTED_VISIBLE_MS = 3_000;

/**
 * The transient "it's back" state.
 *
 * Not a ConnectionQuality, because it is not a state of the connection — it is
 * a statement about a state the connection just left. Modelling it as one
 * would mean the classifier had to remember history, which is exactly what it
 * is built not to do.
 */
export const RECONNECTED_PRESENTATION: ConnectionPresentation = {
  label: 'Reconnected',
  dotClass: 'bg-emerald-500',
  pulse: false,
  srLabel: 'Reconnected',
  headline: 'Connection is good',
};

/**
 * Did we say something the user could see?
 *
 * This is the old toast's rule kept intact — "recovery, only if we had
 * previously shown the warning" — and it is derived from the label rather than
 * from a second list, so a state can never warn without qualifying for the
 * confirmation, or vice versa.
 */
export function warnsUser(q: ConnectionQuality): boolean {
  return connectionPresentation(q).label !== null;
}
