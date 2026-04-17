/**
 * Is this accessory actually responding?
 *
 * `HMAccessory.isReachable` on macOS is famously stuck false for
 * shared-user / bridged accessories even when reads and events work.
 * A much better signal is already in the `accessories.list` payload:
 * HomeKit strips `value` from a characteristic when it can't currently
 * read it from the device. Values present → responsive. Values stripped
 * → no response. Same signal Apple's Home app uses.
 */

import type { HomeKitAccessory } from '@/lib/graphql/types';

/**
 * True if the accessory has at least one readable, non-metadata characteristic
 * with a concrete value. `accessory_information` is excluded — its values
 * (manufacturer, model, etc.) are populated from the pairing record and
 * persist even when the device is offline.
 */
export function accessoryHasLiveValues(
  accessory: HomeKitAccessory | undefined | null,
): boolean {
  if (!accessory) return false;
  for (const svc of accessory.services || []) {
    if (svc.serviceType === 'accessory_information') continue;
    for (const c of svc.characteristics || []) {
      if (c.isReadable === false) continue;
      if (c.value !== undefined && c.value !== null) return true;
    }
  }
  return false;
}

/**
 * True if the tile should render as responsive (enable controls, show values).
 * Trusts positive `isReachable`; otherwise falls back to value-presence so a
 * stuck `isReachable=false` doesn't hide a working device.
 */
export function isAccessoryResponsive(
  accessory: HomeKitAccessory | undefined | null,
  isReachable: boolean | undefined,
): boolean {
  return isReachable === true || accessoryHasLiveValues(accessory);
}
