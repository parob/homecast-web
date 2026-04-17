/**
 * Thin facade over Sonner for the observability UX.
 *
 * Rules:
 * - Only surface material events to the user. Chatty reconnects should stay
 *   invisible; disconnects that linger or recoveries from a bad state are
 *   worth a toast.
 * - Deduplicate rapid-fire state changes so a flapping connection doesn't
 *   spam notifications.
 */

import { toast } from 'sonner';

type ConnState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

// Suppress a toast for a state that just fired within the debounce window.
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
 * Emit a toast for a connection state transition, if it's material.
 *
 * Material transitions:
 *   connected → disconnected/reconnecting   (visible problem)
 *   reconnecting/disconnected → connected    (recovery — only if we warned)
 *
 * Boring transitions (connecting ↔ connected on first load) are silent.
 */
export function toastConnection(prev: ConnState, next: ConnState): void {
  // First connection on page load is silent.
  if (prev === 'disconnected' && next === 'connecting') return;
  if (prev === 'connecting' && next === 'connected') return;

  // Drop → visible warning. Use a persistent toast ID so subsequent
  // disconnects replace rather than stack.
  if ((prev === 'connected' || prev === 'connecting') &&
      (next === 'disconnected' || next === 'reconnecting')) {
    if (!shouldShow('conn:down')) return;
    toast.warning('Connection lost', {
      id: 'conn',
      description:
        next === 'reconnecting'
          ? 'Reconnecting to Homecast…'
          : 'Trying to reach Homecast.',
      duration: 6000,
    });
    return;
  }

  // Recovery — only fire if we had previously shown the warning toast.
  if ((prev === 'reconnecting' || prev === 'disconnected') && next === 'connected') {
    if (lastShown.has('conn:down')) {
      if (!shouldShow('conn:up')) return;
      toast.success('Reconnected', { id: 'conn', duration: 3000 });
      lastShown.delete('conn:down');
    }
    return;
  }
}

/**
 * Generic error toast — for user-facing GraphQL / network failures that
 * weren't just a transient transport blip.
 */
export function toastError(title: string, description?: string): void {
  if (!shouldShow(`err:${title}`)) return;
  toast.error(title, { description, duration: 5000 });
}
