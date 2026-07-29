// Whether the relay answers a request itself or sends it to the server.
//
// Extracted from the request path because it is one boolean carrying three
// different questions, and conflating two of them was a real bug: an id the
// relay *owns* is not necessarily an id its HomeKit can *look up*. The cloud
// addresses homes by stable hc_id, HomeKit only knows live UUIDs, and an hc_id
// passed the ownership check, reached HomeKit and failed with HOME_NOT_FOUND
// on every home of the managed relay.

export interface RelayRoutingState {
  /** Server-assigned: this device is the relay currently serving its homes. */
  isActiveRelay: boolean;
  /** From the last homes.list, the homes this account owns. */
  ownedHomeIds: ReadonlySet<string>;
  /** Ids this relay's HomeKit has rejected, so we stop claiming them. */
  unservableHomeIds: ReadonlySet<string>;
}

/**
 * Can this relay answer the request from its own HomeKit?
 *
 * Ids are compared uppercased: HomeKit reports uppercase, the cloud stores
 * lowercase, and UUIDs are case-insensitive per RFC 4122.
 */
export function canServeLocally(
  action: string,
  homeId: string | undefined,
  state: RelayRoutingState,
): boolean {
  if (!state.isActiveRelay) return false;
  // homes.list always goes to the server, which deduplicates cloud-managed
  // homes across relays. A purely local answer would be missing that.
  if (action === 'homes.list') return false;
  // Not scoped to a home — nothing to resolve, so the relay can serve it.
  if (!homeId) return true;

  const key = homeId.toUpperCase();
  return state.ownedHomeIds.has(key) && !state.unservableHomeIds.has(key);
}
