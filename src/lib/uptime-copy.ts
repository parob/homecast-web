/**
 * Words for the Reliability section.
 *
 * The server records *why* a probe did not verify as a short internal code —
 * `probe_timeout (consecutive=1)`, `accessory_error: read_error`,
 * `probe_error: ValueError` — and the section used to print that code
 * verbatim under the badge. These map each code to a sentence a home owner
 * can act on. Pure, so the mapping is unit-tested.
 */

/** What the last probe result means, in the owner's terms. */
export function describeProbeReason(reason: string | null | undefined): string {
  if (!reason) return 'The last check did not read a value.';
  if (reason.startsWith('probe_timeout')) return 'The relay did not answer the last check in time.';
  if (reason === 'no_probe_target') return 'No accessory in this home can be read for a check.';
  if (reason.startsWith('accessory_error: unreachable')) return 'The accessory we tried was unreachable.';
  if (reason.startsWith('accessory_error: homekit_error')) return 'Apple Home did not answer the relay.';
  if (reason.startsWith('accessory_error')) return 'The accessory we tried returned an error.';
  if (reason.startsWith('cached_read')) return 'Apple Home answered from its cache; nothing in the house was asked.';
  if (reason.startsWith('probe_error')) return 'The check could not be sent to the relay.';
  return 'The last check did not read a value.';
}

/** The short label and the explanation for each status the server can report. */
export function describeStatus(status: string): { label: string; explanation: string } {
  switch (status) {
    case 'verified':
      return {
        label: 'Verified',
        explanation: 'Your relay just read a live value from one of your accessories. Everything between the cloud and your home is working.',
      };
    case 'connected':
      return {
        label: 'Connected',
        explanation: 'Your relay is reachable. The last check did not read a live value from an accessory, which is usually the accessory, not the relay.',
      };
    case 'degraded':
      return {
        label: 'Degraded',
        explanation: 'Your relay is connected, but its recent checks have timed out. Apple Home on the relay Mac appears stuck; reloading the relay usually clears it.',
      };
    case 'offline':
      return {
        label: 'Offline',
        explanation: 'Your relay is not connected to the cloud. Accessories cannot be controlled from outside your home until it reconnects.',
      };
    default:
      return { label: 'Unknown', explanation: 'No reliability data for this home yet.' };
  }
}
