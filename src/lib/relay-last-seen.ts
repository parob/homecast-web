/**
 * Relative-time helpers for relay status lines.
 *
 * Uses the browser-native Intl.RelativeTimeFormat rather than date-fns:
 * this module is imported by many components across different lazy chunks,
 * so pulling in date-fns here hoisted a ~460 KB shared chunk onto every
 * route. Intl is built in and free.
 */

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' });

// Largest-unit-wins, mirroring date-fns formatDistanceToNowStrict (no weeks).
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['day', 86_400],
  ['hour', 3_600],
  ['minute', 60],
  ['second', 1],
];

/** "5 seconds ago" / "3 months ago" for a past timestamp (ms since epoch). */
function relativeAgo(ms: number): string {
  const diffSec = Math.round((ms - Date.now()) / 1000); // negative = past
  const abs = Math.abs(diffSec);
  for (const [unit, secs] of UNITS) {
    if (abs >= secs || unit === 'second') {
      return rtf.format(Math.round(diffSec / secs), unit);
    }
  }
  return rtf.format(0, 'second');
}

/**
 * Format a "last online X ago" string for relay-offline indicators.
 *
 * Accepts either a number (ms since epoch) or an ISO string. Returns
 * "Never online" when the input is null/undefined — the relay has never
 * been seen on this account. Very recent timestamps (< 10 s) collapse to
 * "just now" so a clean disconnect/reconnect flicker doesn't flash "0 s
 * ago" at the user.
 */
export function formatLastOnline(input: number | string | null | undefined): string {
  if (input == null) return 'Never online';
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms) || ms <= 0) return 'Never online';
  const elapsed = Date.now() - ms;
  if (elapsed < 10_000) return 'Last online just now';
  return `Last online ${relativeAgo(ms)}`;
}

/**
 * Short relative timestamp without the "Last online" / "just now" prefixing.
 * Use for compact status lines like "Online · 3 seconds ago".
 */
export function formatRelativeAgo(input: number | string | null | undefined): string {
  if (input == null) return 'never';
  const ms = typeof input === 'number' ? input : Date.parse(input);
  if (!Number.isFinite(ms) || ms <= 0) return 'never';
  if (Date.now() - ms < 10_000) return 'just now';
  return relativeAgo(ms);
}
