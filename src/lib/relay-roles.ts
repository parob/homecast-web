/**
 * What the server says this Mac's relay is doing for each home.
 *
 * One physical home can be relayed by two Macs at once: the cloud-managed
 * relay under the operator's Apple ID, and the customer's own Mac under
 * theirs. The server decides which one serves the home — the cloud relay
 * whenever it is live, the customer's Mac only after the cloud relay has been
 * gone for five minutes — and tells the relay in `relay_status.homeRoles`,
 * keyed by the home's stable id. `isActiveRelay` is a different fact (this
 * account's active relay, of possibly several Macs) and is untouched.
 *
 * Pure, so what the popover and the header say is decided in one testable
 * place rather than reproduced by unplugging a Mac mini.
 */

export type RelayHomeRole = 'primary' | 'standby';
export type RelayHomeRoles = Record<string, RelayHomeRole>;

/** The `homeRoles` map off the wire, or null when the server did not send one. */
export function parseHomeRoles(raw: unknown): RelayHomeRoles | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const out: RelayHomeRoles = {};
  for (const [id, role] of Object.entries(raw as Record<string, unknown>)) {
    if (role === 'primary' || role === 'standby') out[id.toUpperCase()] = role;
  }
  return out;
}

export interface CloudStandbyHome {
  id: string;
  name?: string;
  isCloudManaged?: boolean;
}

export type CloudStandby =
  /** Every cloud-managed home is served by the cloud relay; this Mac waits. */
  | 'standby'
  /** The cloud relay is gone and this Mac has taken at least one home over. */
  | 'serving'
  /** Nothing to say: no roles known (an older server) or no cloud-managed homes. */
  | null;

/**
 * Whether this Mac is standing by for, or standing in for, the cloud relay.
 *
 * `null` roles means the server has not said, which keeps every older
 * presentation exactly as it was. Home ids are compared case-insensitively:
 * the server keys by uppercase hc_id and the homes list is not guaranteed to.
 */
export function cloudStandbyState(i: {
  relayRoles: RelayHomeRoles | null;
  homes: ReadonlyArray<CloudStandbyHome>;
}): CloudStandby {
  if (!i.relayRoles) return null;
  const cloudHomes = i.homes.filter((h) => h.isCloudManaged);
  if (cloudHomes.length === 0) return null;
  const roleOf = (h: CloudStandbyHome) => i.relayRoles?.[h.id.toUpperCase()];
  if (cloudHomes.some((h) => roleOf(h) === 'primary')) return 'serving';
  return 'standby';
}

/** The cloud-managed homes this Mac is currently serving, for the copy. */
export function homesServedInsteadOfCloud(i: {
  relayRoles: RelayHomeRoles | null;
  homes: ReadonlyArray<CloudStandbyHome>;
}): CloudStandbyHome[] {
  if (!i.relayRoles) return [];
  return i.homes.filter((h) => h.isCloudManaged && i.relayRoles?.[h.id.toUpperCase()] === 'primary');
}
