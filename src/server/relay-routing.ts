// Whether the relay answers a request itself or sends it to the server.
//
// Extracted from the request path because it is one boolean carrying three
// different questions, and conflating two of them was a real bug: an id the
// relay *owns* is not necessarily an id its HomeKit can *look up*. The cloud
// addresses homes by stable hc_id, HomeKit only knows live UUIDs, and an hc_id
// passed the ownership check, reached HomeKit and failed with HOME_NOT_FOUND
// on every home of the managed relay.

/**
 * Actions the server owns, which the relay must never try to answer.
 *
 * `subscribe`/`unsubscribe` manage server-side push scopes and carry no
 * `homeId`, so they fell through the "no home to resolve, serve it here" branch
 * and died as `Unknown action: subscribe` — twice per reconnect, for months,
 * filling the fault log with failures that were nothing to do with HomeKit.
 *
 * `homes.list` is here for a different reason: the server deduplicates
 * cloud-managed homes across relays, and a local answer would omit them.
 */
const SERVER_ONLY_ACTIONS = new Set([
  'homes.list',
  'subscribe',
  'unsubscribe',
  'subscriptions.list',
]);

export interface RelayRoutingState {
  /** Server-assigned: this device is the relay currently serving its homes. */
  isActiveRelay: boolean;
  /** From the last homes.list, the homes this account owns. */
  ownedHomeIds: ReadonlySet<string>;
  /**
   * Homes HomeKit itself reports on this Mac, asked directly rather than
   * inferred. Empty means not yet known — fall back to ownership, since
   * refusing everything until it loads would break the relay on startup.
   */
  liveHomeIds: ReadonlySet<string>;
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
  if (SERVER_ONLY_ACTIONS.has(action)) return false;
  // Not scoped to a home — nothing to resolve, so the relay can serve it.
  if (!homeId) return true;

  const key = homeId.toUpperCase();
  if (state.unservableHomeIds.has(key)) return false;

  // Once HomeKit has told us what it has, that is the answer — it is the thing
  // that would have to resolve the id, so anything else is a guess. Ownership
  // was that guess, and it is wrong for every id in the cloud's stable-id
  // space: those name homes this relay owns but HomeKit has never heard of.
  if (state.liveHomeIds.size > 0) return state.liveHomeIds.has(key);

  return state.ownedHomeIds.has(key);
}
