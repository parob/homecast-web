import type { HomeMemberInfo, HomeMemberStatus } from '@/lib/graphql/types';

/**
 * A home invite is addressed to an email, not to an account, so a member who
 * isn't active yet is stuck in one of two different places — and the owner's
 * next move differs: chase them to create an account, or chase them to accept
 * the invitation that's already waiting. One "Pending" label hid the
 * difference (it only ever meant the first), so both are named here.
 */
export const MEMBER_STATUS_LABELS: Record<HomeMemberStatus, string> = {
  awaiting_signup: 'Awaiting sign-up',
  awaiting_acceptance: 'Awaiting acceptance',
  active: 'Active',
};

/** Servers older than the split sent only `isPending`, which meant "no account yet". */
export function memberStatus(member: Pick<HomeMemberInfo, 'status' | 'isPending'>): HomeMemberStatus {
  if (member.status) return member.status;
  return member.isPending ? 'awaiting_signup' : 'active';
}

/**
 * Shared-items rows have no schedule when they represent a member, so the
 * server sends the invite state in `accessSchedule` instead: null once active.
 * `'pending'` is what a pre-split server sent for "no account yet".
 */
export function entryMemberStatus(accessSchedule?: string | null): HomeMemberStatus {
  if (accessSchedule === 'pending' || accessSchedule === 'awaiting_signup') return 'awaiting_signup';
  if (accessSchedule === 'awaiting_acceptance') return 'awaiting_acceptance';
  return 'active';
}

/**
 * One badge for the summary row — the detail view names the states, this only
 * has to say how many are outstanding — with the breakdown on hover.
 */
export function summariseOutstandingInvites(
  entries: { accessSchedule?: string | null }[],
): { count: number; title: string } | null {
  const statuses = entries.map(e => entryMemberStatus(e.accessSchedule));
  const awaitingSignup = statuses.filter(s => s === 'awaiting_signup').length;
  const awaitingAcceptance = statuses.filter(s => s === 'awaiting_acceptance').length;
  const count = awaitingSignup + awaitingAcceptance;
  if (count === 0) return null;

  const parts: string[] = [];
  if (awaitingSignup > 0) parts.push(`${awaitingSignup} awaiting sign-up`);
  if (awaitingAcceptance > 0) parts.push(`${awaitingAcceptance} awaiting acceptance`);
  return { count, title: parts.join(', ') };
}
