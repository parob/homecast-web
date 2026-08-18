import { useCallback, useSyncExternalStore } from 'react';
import { isRingVisible, subscribeToKey } from '@/lib/pending-writes';

const noopUnsubscribe = () => {};
const alwaysFalse = () => false;

/**
 * Whether this accessory or group has a write outstanding long enough to say so.
 *
 * Read by the widget itself rather than passed down: `WidgetCard` already has
 * the accessory, and a prop would have to be threaded through 26 widgets and
 * then added to `AccessoryWidget`'s hand-written memo comparator, which
 * silently ignores props it does not list. A `useSyncExternalStore`
 * subscription re-renders through `memo` regardless.
 *
 * The snapshot is a boolean, never an object: `useSyncExternalStore` compares
 * with `Object.is`, so anything freshly allocated would re-render for ever.
 *
 * Pass undefined for a surface with nothing to track — a drag ghost, a preview,
 * the MQTT browser's synthetic accessories — and it stays false.
 */
export function usePendingWrite(key: string | null | undefined): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => (key ? subscribeToKey(key, onChange) : noopUnsubscribe),
    [key],
  );
  const snapshot = useCallback(() => (key ? isRingVisible(key) : false), [key]);
  return useSyncExternalStore(subscribe, snapshot, alwaysFalse);
}
