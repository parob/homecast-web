/**
 * Thin facade over Sonner for the observability UX.
 *
 * Rules:
 * - Only surface material events to the user, and deduplicate rapid-fire ones
 *   so a flapping backend cannot spam notifications.
 * - A toast reports an *event*. Anything that is a *condition* — something
 *   that persists and that the user may want to check on — does not belong
 *   here, because a toast fires once and is gone in seconds.
 *
 * The connection toasts used to live here and have moved to the header badge
 * (components/layout/ConnectionBadge) for exactly that reason: "Connecting…"
 * described a state that outlasted its own four-second toast, and its absence
 * afterwards was indistinguishable from never having been told.
 */

import { toast } from 'sonner';

// Suppress a toast for a message that just fired within the debounce window.
const DEBOUNCE_MS = 2_000;
const lastShown = new Map<string, number>();

function shouldShow(key: string): boolean {
  const now = Date.now();
  const prev = lastShown.get(key) ?? 0;
  if (now - prev < DEBOUNCE_MS) return false;
  lastShown.set(key, now);
  return true;
}

/**
 * Generic error toast — for user-facing GraphQL / network failures that
 * weren't just a transient transport blip.
 */
export function toastError(title: string, description?: string): void {
  if (!shouldShow(`err:${title}`)) return;
  toast.error(title, { description, duration: 5000 });
}
