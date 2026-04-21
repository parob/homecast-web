import { formatDistanceToNowStrict } from 'date-fns';

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
  return `Last online ${formatDistanceToNowStrict(new Date(ms), { addSuffix: true })}`;
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
  return formatDistanceToNowStrict(new Date(ms), { addSuffix: true });
}
