/**
 * homecast-cloud#99: the client already knows the relay is gone.
 *
 * A phone sat for 61 seconds with a perfect socket to the cloud, three writes
 * refused with NO_DEVICE, and a cached home still claiming its relay was fine.
 * Local Mode never engaged and the status dot stayed on quiet emerald, because
 * between them they had nothing to react to. These tests are that missing
 * evidence, and what the two policies now do with it.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_REACHABILITY, noteRefused, noteServed, unreachableHomeIds,
} from '../relay-reachability';
import { decideLocalMode, EMPTY_MEMO, ENGAGE_AFTER_MS, DISENGAGE_AFTER_MS } from '../local-mode';
import { statusPresentation } from '@/lib/status-badge';
import { buildChain } from '@/lib/connection-chain';

describe('relay reachability', () => {
  it('marks a home the cloud has refused', () => {
    const m = noteRefused(EMPTY_REACHABILITY, 'd08cb174', 1_000);
    expect([...unreachableHomeIds(m)]).toEqual(['D08CB174']);
  });

  it('clears the mark once a request for that home is answered', () => {
    let m = noteRefused(EMPTY_REACHABILITY, 'D08CB174', 1_000);
    m = noteServed(m, 'D08CB174', 2_000);
    expect(unreachableHomeIds(m).size).toBe(0);
  });

  it('re-marks when a later request is refused again', () => {
    let m = noteServed(EMPTY_REACHABILITY, 'D08CB174', 1_000);
    m = noteRefused(m, 'D08CB174', 2_000);
    expect(unreachableHomeIds(m).has('D08CB174')).toBe(true);
  });

  it('does not expire on its own', () => {
    // Deliberate: once Local Mode is serving, nothing asks the cloud about
    // this home, so no fresh refusal arrives to renew the mark. An expiry
    // would disengage Local Mode, collect a refusal, and re-engage — a flap
    // manufactured by the mechanism meant to prevent one.
    const m = noteRefused(EMPTY_REACHABILITY, 'D08CB174', 0);
    expect(unreachableHomeIds(m).has('D08CB174')).toBe(true);
  });

  it('keeps homes apart', () => {
    const m = noteRefused(EMPTY_REACHABILITY, 'A', 1_000);
    expect(unreachableHomeIds(m).has('B')).toBe(false);
  });
});

// The state the report shows, verbatim: the socket to the cloud is connected
// throughout, and homes.list was answered once — inside the server's 120s
// "reconnecting" grace — and never asked again.
const REPORTED = {
  bridgeReady: true,
  isThisDeviceTheRelay: false,
  relayCapable: false,          // an iPhone
  override: 'auto' as const,
  socketState: 'connected' as const,
  homes: [{ id: 'D08CB174', relayState: 'reconnecting', isCloudManaged: true }],
  anyRelayKnown: true,
  homesLoaded: true,
};

describe('Local Mode, given a refused home', () => {
  it('stays off on the cached homes alone — the bug', () => {
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...REPORTED, now: 0 }, memo).memo;
    const d = decideLocalMode({ ...REPORTED, now: 90_000 }, memo);
    expect(d.active).toBe(false);
  });

  it('engages once the cloud has refused that home', () => {
    const unreachableHomeIds = new Set(['D08CB174']);
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...REPORTED, unreachableHomeIds, now: 0 }, memo).memo;
    const d = decideLocalMode(
      { ...REPORTED, unreachableHomeIds, now: ENGAGE_AFTER_MS }, memo,
    );
    expect(d.active).toBe(true);
    expect(d.reason).toBe('relay-offline');
  });

  it('still waits out the engage delay, so a blip cannot flip it', () => {
    const unreachableHomeIds = new Set(['D08CB174']);
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...REPORTED, unreachableHomeIds, now: 0 }, memo).memo;
    const d = decideLocalMode(
      { ...REPORTED, unreachableHomeIds, now: ENGAGE_AFTER_MS - 1 }, memo,
    );
    expect(d.active).toBe(false);
  });

  it('matches home ids case-insensitively', () => {
    const unreachableHomeIds = new Set(['D08CB174']);
    const homes = [{ id: 'd08cb174', relayState: 'reconnecting' }];
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...REPORTED, homes, unreachableHomeIds, now: 0 }, memo).memo;
    expect(decideLocalMode(
      { ...REPORTED, homes, unreachableHomeIds, now: ENGAGE_AFTER_MS }, memo,
    ).active).toBe(true);
  });

  it('ignores a "connected" that was fetched BEFORE the refusal', () => {
    // The takeover grace: the standby Mac holds a session for the home, so
    // homes.list reports a flat `connected` while every request is refused.
    // Ranking `connected` above the refusal — the mistake in #85 — leaves
    // Local Mode asleep for the whole five minutes.
    const homes = [{ id: 'D08CB174', relayState: 'connected', isCloudManaged: true }];
    const refusedHomes = new Map([['D08CB174', 10_000]]);
    const inputs = { ...REPORTED, homes, refusedHomes, homesFetchedAt: 5_000 };
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...inputs, now: 10_000 }, memo).memo;
    expect(decideLocalMode({ ...inputs, now: 10_000 + ENGAGE_AFTER_MS }, memo).active).toBe(true);
  });

  it('accepts a "connected" fetched AFTER the refusal — the relay is back', () => {
    const homes = [{ id: 'D08CB174', relayState: 'connected', isCloudManaged: true }];
    const refusedHomes = new Map([['D08CB174', 10_000]]);
    const inputs = { ...REPORTED, homes, refusedHomes, homesFetchedAt: 20_000 };
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...inputs, now: 20_000 }, memo).memo;
    expect(decideLocalMode({ ...inputs, now: 90_000 }, memo).active).toBe(false);
  });

  it('a refusal with no homes.list answer at all still counts', () => {
    const homes = [{ id: 'D08CB174', relayState: 'connected', isCloudManaged: true }];
    const refusedHomes = new Map([['D08CB174', 10_000]]);
    const inputs = { ...REPORTED, homes, refusedHomes, homesFetchedAt: null };
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...inputs, now: 10_000 }, memo).memo;
    expect(decideLocalMode({ ...inputs, now: 10_000 + ENGAGE_AFTER_MS }, memo).active).toBe(true);
  });

  it('leaves an unrefused home entirely alone, grace and all', () => {
    const homes = [{ id: 'OTHER', relayState: 'reconnecting' }];
    const refusedHomes = new Map([['D08CB174', 10_000]]);
    const inputs = { ...REPORTED, homes, refusedHomes, homesFetchedAt: 5_000, anyRelayKnown: true };
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...inputs, now: 10_000 }, memo).memo;
    // 'reconnecting' on a home nothing has refused is the server's grace, and
    // it still means served — that debounce is not ours to override.
    expect(decideLocalMode({ ...inputs, now: 90_000 }, memo).active).toBe(false);
  });

  it('disengages on the slow timer once the relay is back', () => {
    const unreachableHomeIds = new Set(['D08CB174']);
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...REPORTED, unreachableHomeIds, now: 0 }, memo).memo;
    memo = decideLocalMode({ ...REPORTED, unreachableHomeIds, now: ENGAGE_AFTER_MS }, memo).memo;
    expect(memo.active).toBe(true);

    // Relay answers again: the mark is cleared and the home reports connected.
    // The disengage clock starts on the first tick that no longer wants Local
    // Mode, not on the moment the relay recovered.
    const back = { ...REPORTED, homes: [{ id: 'D08CB174', relayState: 'connected' }] };
    const standDownAt = ENGAGE_AFTER_MS;
    memo = decideLocalMode({ ...back, now: standDownAt }, memo).memo;
    expect(memo.active).toBe(true);
    expect(decideLocalMode(
      { ...back, now: standDownAt + DISENGAGE_AFTER_MS - 1 }, memo,
    ).active).toBe(true);
    expect(decideLocalMode(
      { ...back, now: standDownAt + DISENGAGE_AFTER_MS }, memo,
    ).active).toBe(false);
  });

  it('never engages on the relay Mac itself', () => {
    const unreachableHomeIds = new Set(['D08CB174']);
    const inputs = { ...REPORTED, isThisDeviceTheRelay: true, unreachableHomeIds };
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...inputs, now: 0 }, memo).memo;
    expect(decideLocalMode({ ...inputs, now: 90_000 }, memo).active).toBe(false);
  });

  it('an explicit "off" still wins', () => {
    const inputs = {
      ...REPORTED, override: 'off' as const, unreachableHomeIds: new Set(['D08CB174']),
    };
    let memo = EMPTY_MEMO;
    memo = decideLocalMode({ ...inputs, now: 0 }, memo).memo;
    expect(decideLocalMode({ ...inputs, now: 90_000 }, memo).active).toBe(false);
  });
});

describe('the status dot, given a refused home', () => {
  const base = {
    quality: 'good' as const,
    reconnected: false,
    localMode: { active: false, unmapped: false },
    relayStatus: null,
  };

  it('used to sit on the quiet emerald dot — the bug', () => {
    expect(statusPresentation(base).label).toBeNull();
  });

  it('says so when the home is unreachable', () => {
    const p = statusPresentation({ ...base, homeUnreachable: true });
    expect(p.label).toBe('Relay offline');
    expect(p.dotClass).toBe('bg-amber-500');
  });

  it('yields to a broken connection, which explains it', () => {
    const p = statusPresentation({ ...base, quality: 'offline', homeUnreachable: true });
    expect(p.label).toBe('Offline');
  });

  it('yields to Local Mode, which is the home working', () => {
    const p = statusPresentation({
      ...base, localMode: { active: true, unmapped: false }, homeUnreachable: true,
    });
    expect(p.label).toBe('Local Mode');
  });

  it('outranks the transient "Reconnected", which is about the link', () => {
    const p = statusPresentation({ ...base, reconnected: true, homeUnreachable: true });
    expect(p.label).toBe('Relay offline');
  });
});

describe('the connection chain, given a refused home', () => {
  const base = {
    quality: 'good' as const,
    reconnected: false,
    relayStatus: null,
    localMode: { active: false, unmapped: false },
    selfRelay: false,
    community: false,
    rtt: '26ms',
    homeName: 'County Hall',
  };

  it('used to call every hop healthy while the home refused every write', () => {
    const c = buildChain({ ...base, managed: true });
    expect(c.sentence).toBe('Every hop is healthy.');
    expect(c.nodes.map((n) => n.tone)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });

  it('breaks the Homecast→relay hop instead', () => {
    const c = buildChain({ ...base, managed: true, homeUnreachable: true });
    expect(c.hops[1].tone).toBe('bad');
    expect(c.hops[1].label).toBe('no relay');
    // The relay node carries it; nothing past a break is claimed either way.
    expect(c.nodes.map((n) => n.tone)).toEqual(['ok', 'ok', 'bad', 'idle']);
    expect(c.sentence).toMatch(/cloud relay for this home isn't answering/);
  });

  it('offers a cloud customer no action to take', () => {
    const c = buildChain({ ...base, managed: true, homeUnreachable: true });
    expect(c.noUserAction).toMatch(/nothing to restart at your end/);
  });

  it('names a self-hosted relay as theirs, and does offer an action', () => {
    const c = buildChain({ ...base, managed: false, homeUnreachable: true });
    expect(c.nodes[2].name).toBe('Your relay');
    expect(c.sentence).toMatch(/can't get an answer from your relay/);
    expect(c.noUserAction).toBeNull();
  });

  it('agrees with the badge: a broken socket outranks it', () => {
    const c = buildChain({ ...base, managed: true, quality: 'offline', homeUnreachable: true });
    expect(c.sentence).toMatch(/can't reach Homecast/);
    expect(c.hops[0].tone).toBe('bad');
  });

  it('agrees with the badge: Local Mode outranks it', () => {
    const c = buildChain({
      ...base, managed: true, homeUnreachable: true,
      localMode: { active: true, unmapped: false },
    });
    expect(c.bypass).toBe(true);
    expect(c.nodes[3].tone).toBe('ok');
  });

  it('keeps the home named', () => {
    const c = buildChain({ ...base, managed: true, homeUnreachable: true });
    expect(c.nodes[3].name).toBe('County Hall');
  });
});
