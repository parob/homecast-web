/**
 * What the add-home dialog shows about relays — pure, unit-tested.
 *
 * The server ranks the relays and marks one `recommended` (the same one it
 * would pick if the customer chose nothing), so this file never re-derives the
 * ranking. It only decides what to preselect and how to word it.
 */
import type { CloudRelayAvailability, CloudRelayOption } from '@/lib/graphql/types';

const AVAILABILITY_LABELS: Record<CloudRelayAvailability, string> = {
  plenty: 'Plenty of space',
  limited: 'Almost full',
  full: 'Full',
};

export function availabilityLabel(a: CloudRelayAvailability): string {
  return AVAILABILITY_LABELS[a] ?? a;
}

export function isFull(r: CloudRelayOption): boolean {
  return r.availability === 'full';
}

export function allFull(relays: CloudRelayOption[]): boolean {
  return relays.every(isFull);
}

/**
 * The relay the dialog starts on: the recommendation, else the first one with
 * space (every relay with space is offline), else none — the customer queues.
 */
export function initialRelay(relays: CloudRelayOption[]): CloudRelayOption | null {
  return relays.find(r => r.recommended) ?? relays.find(r => !isFull(r)) ?? null;
}

/** One line on why the recommended relay was recommended. */
export function recommendationReason(r: CloudRelayOption, regionHint: string): string {
  const near = r.region === regionHint;
  if (near && r.availability === 'plenty') return 'Closest to you, with plenty of space';
  if (near) return 'Closest to you';
  return 'Most space available right now';
}

/** Whether the customer may start another cloud home. Unknown → let the server decide. */
export function canAddCloudHome(allowance: { cloudHomeLimit: number; cloudHomesUsed: number } | null | undefined): boolean {
  if (!allowance) return true;
  return allowance.cloudHomesUsed < allowance.cloudHomeLimit;
}

export function homeLimitTitle(limit: number): string {
  return limit === 1
    ? 'Your plan includes one home for now'
    : `Your plan includes ${limit} homes for now`;
}

/** The server's "that relay filled up / isn't available" refusal — worth a refetch. */
export function isRelayTakenError(error: string | null | undefined): boolean {
  return !!error && /filled up|isn't available/i.test(error);
}
