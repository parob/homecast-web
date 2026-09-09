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

// `cloudStandbyState` and `homesServedInsteadOfCloud` used to live here: what
// this Mac was doing for the cloud-managed homes, derived from this map and
// the homes list. That is now read from the serving fact per home
// (`lib/relay-section-state.ts`); the map is kept only because the server
// still sends it and the connection still records it.
