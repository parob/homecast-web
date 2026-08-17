import { describe, it, expect } from 'vitest';
import {
  memberStatus,
  entryMemberStatus,
  summariseOutstandingInvites,
  MEMBER_STATUS_LABELS,
} from '@/lib/home-members';

describe('memberStatus', () => {
  it('trusts the server status when it is sent', () => {
    expect(memberStatus({ status: 'awaiting_acceptance', isPending: false })).toBe('awaiting_acceptance');
    expect(memberStatus({ status: 'active', isPending: false })).toBe('active');
  });

  it('falls back to isPending for a pre-split server', () => {
    // isPending only ever meant "no account with this email yet".
    expect(memberStatus({ status: undefined as never, isPending: true })).toBe('awaiting_signup');
    expect(memberStatus({ status: undefined as never, isPending: false })).toBe('active');
  });
});

describe('entryMemberStatus', () => {
  it('reads the invite state a shared-items row carries in accessSchedule', () => {
    expect(entryMemberStatus('awaiting_signup')).toBe('awaiting_signup');
    expect(entryMemberStatus('awaiting_acceptance')).toBe('awaiting_acceptance');
    expect(entryMemberStatus(null)).toBe('active');
    expect(entryMemberStatus(undefined)).toBe('active');
  });

  it("treats a pre-split server's 'pending' as awaiting sign-up", () => {
    expect(entryMemberStatus('pending')).toBe('awaiting_signup');
  });
});

describe('summariseOutstandingInvites', () => {
  it('is null when everyone has accepted', () => {
    expect(summariseOutstandingInvites([{ accessSchedule: null }, { accessSchedule: null }])).toBeNull();
    expect(summariseOutstandingInvites([])).toBeNull();
  });

  it('counts someone who signed up but has not accepted', () => {
    // The bug this replaced: only missing accounts were counted, so an
    // unanswered invitation showed no badge at all.
    expect(summariseOutstandingInvites([{ accessSchedule: 'awaiting_acceptance' }])).toEqual({
      count: 1,
      title: '1 awaiting acceptance',
    });
  });

  it('breaks the count down on hover when both states are present', () => {
    expect(
      summariseOutstandingInvites([
        { accessSchedule: 'awaiting_signup' },
        { accessSchedule: 'awaiting_acceptance' },
        { accessSchedule: 'awaiting_acceptance' },
        { accessSchedule: null },
      ]),
    ).toEqual({ count: 3, title: '1 awaiting sign-up, 2 awaiting acceptance' });
  });
});

describe('MEMBER_STATUS_LABELS', () => {
  it('names both waiting states distinctly', () => {
    expect(MEMBER_STATUS_LABELS.awaiting_signup).not.toBe(MEMBER_STATUS_LABELS.awaiting_acceptance);
  });
});
