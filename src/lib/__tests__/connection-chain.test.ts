// The drawing, and only the drawing. What the popover *says* about these
// states is `answer-card.test.ts`; this file pins which node and which hop are
// painted which colour, from which fact.

import { describe, expect, it } from 'vitest';
import { buildChain, chainHasFault, homeNodeName, relayNodeName, takeoverIn, type ChainInput } from '../connection-chain';
import { composeServing, type HomeServing } from '@/server/home-serving';

const ME = 'mac_d6de42ce';
const MINI = 'mac_8ca2d5a2';

const servedBy = (by: string | null, kind: HomeServing['kind'] = 'self_hosted'): HomeServing =>
  ({ state: 'served', by, kind, since: null, graceEndsAt: null });
const notServed = (state: 'waiting' | 'reconnecting' | 'offline', graceEndsAt: string | null = null): HomeServing =>
  ({ state, by: null, kind: null, since: null, graceEndsAt });
/** Local Mode over whatever the server says — `relayServing` keeps the server's half. */
const local = (under: HomeServing | null = null): Pick<ChainInput, 'serving' | 'relayServing'> =>
  ({ serving: composeServing(under, { active: true }, ME), relayServing: under });

const base: ChainInput = {
  quality: 'good',
  serving: servedBy(MINI),
  relayServing: servedBy(MINI),
  thisDevice: ME,
  managed: false,
  community: false,
  rtt: '34ms',
  homeName: null,
};

const at = (input: Partial<ChainInput> = {}) => buildChain({ ...base, ...input });
const relay = (input: Partial<ChainInput> = {}) =>
  at(input).nodes.find(n => n.key === 'relay')!;
const home = (input: Partial<ChainInput> = {}) =>
  at(input).nodes.find(n => n.key === 'home')!;

describe('relay node naming', () => {
  // The product already has exactly two words for this and they are not ours
  // to reinvent: HomeOverviewSection/HomesSection say "Cloud Relay" and
  // "Self-hosted relay", useRelayCannotEdit types them 'cloud' | 'self-hosted'.
  it('names a cloud-managed relay as the cloud relay, never as the user hardware', () => {
    expect(relayNodeName({ managed: true, selfRelay: false, community: false })).toBe('Cloud relay');
  });

  it('names a self-hosted relay seen from another device as theirs', () => {
    expect(relayNodeName({ managed: false, selfRelay: false, community: false })).toBe('Your relay');
  });

  it('names the relay as this Mac when it is the device being looked at', () => {
    expect(relayNodeName({ managed: false, selfRelay: true, community: false })).toBe('This Mac');
  });

  it('never calls a cloud relay the user Mac, even when this device is a relay', () => {
    // managed wins over selfRelay: a cloud customer's device is not the relay
    // for that home, whatever the socket happens to say.
    expect(relayNodeName({ managed: true, selfRelay: true, community: false })).toBe('Cloud relay');
  });

  // parob/homecast-cloud#107, second report: "the cloud relay isn't working
  // (I turned it off to test this) but the client doesn't reflect this at all —
  // it still thinks it's going via the cloud relay". The server had said who
  // was serving — the customer's own Mac, kind self_hosted — and the name was
  // taken from the plan instead.
  it('names the relay the server says is serving, over the plan', () => {
    expect(relayNodeName({ managed: true, selfRelay: false, community: false, kind: 'self_hosted' })).toBe('Your relay');
    expect(relayNodeName({ managed: true, selfRelay: true, community: false, kind: 'self_hosted' })).toBe('This Mac');
    expect(relayNodeName({ managed: false, selfRelay: false, community: false, kind: 'cloud' })).toBe('Cloud relay');
  });

  it('falls back to the plan when nothing is serving, because then there is no kind', () => {
    expect(relayNodeName({ managed: true, selfRelay: false, community: false, kind: null })).toBe('Cloud relay');
    expect(relayNodeName({ managed: false, selfRelay: false, community: false, kind: null })).toBe('Your relay');
  });
});

describe('a cloud plan whose own Mac has taken the home over (#107)', () => {
  it('draws the Mac as the relay, not the cloud relay it replaced', () => {
    expect(relay({ managed: true, serving: servedBy(MINI, 'self_hosted'), relayServing: servedBy(MINI, 'self_hosted') }).name)
      .toBe('Your relay');
    expect(relay({ managed: true, serving: servedBy(ME, 'self_hosted'), relayServing: servedBy(ME, 'self_hosted') }).name)
      .toBe('This Mac');
  });

  it('still draws the cloud relay while it is the one serving', () => {
    expect(relay({ managed: true, serving: servedBy(MINI, 'cloud'), relayServing: servedBy(MINI, 'cloud') }).name)
      .toBe('Cloud relay');
  });

  it('still calls a dead relay the cloud relay, since nothing else is known', () => {
    expect(relay({ managed: true, serving: notServed('offline'), relayServing: notServed('offline') }).name)
      .toBe('Cloud relay');
  });
});

describe('home node naming', () => {
  // parob/homecast-cloud#61: the chain named every node for the situation it
  // was in except the last one, which said "Home" to someone whose home is
  // called George Street.
  it('names the home the chain is describing', () => {
    expect(home({ homeName: 'George Street' }).name).toBe('George Street');
  });

  it('names it in every branch, not just the healthy path', () => {
    // Three separate branches build this node — community, Local Mode, and the
    // normal path — and all three used to hardcode it.
    expect(home({ community: true, homeName: 'George Street' }).name).toBe('George Street');
    expect(home({ quality: 'offline', ...local(), homeName: 'George Street' }).name).toBe('George Street');
    expect(home({ quality: 'stalled', homeName: 'George Street' }).name).toBe('George Street');
  });

  it('falls back to the generic when there is no name to give', () => {
    // Onboarding, or several homes with none selected. "Home" is still the
    // honest answer there.
    expect(home({ homeName: null }).name).toBe('Home');
    expect(homeNodeName(null)).toBe('Home');
    expect(homeNodeName(undefined)).toBe('Home');
  });

  it('treats a whitespace-only name as no name', () => {
    // A HomeKit home can be renamed to a space, and a chain row of spaces is
    // worse than the generic.
    expect(home({ homeName: '   ' }).name).toBe('Home');
    expect(homeNodeName('  ')).toBe('Home');
  });

  it('keeps the name it was given rather than tidying it', () => {
    // The name is the user's, shown as they wrote it — only the surrounding
    // whitespace goes.
    expect(homeNodeName('  George Street  ')).toBe('George Street');
    expect(homeNodeName("Mum & Dad's")).toBe("Mum & Dad's");
  });

  it('does not rename any other node', () => {
    // The relay words are settled (rule 2) and a home name must not leak into
    // them.
    const c = at({ homeName: 'George Street' });
    expect(c.nodes.map(n => n.name)).toEqual([
      'This device',
      'Homecast',
      'Your relay',
      'George Street',
    ]);
  });
});

describe('healthy states', () => {
  it('paints every hop green, with the round trip on the first hop', () => {
    const c = at({ quality: 'good' });
    expect(c.nodes.every(n => n.tone === 'ok')).toBe(true);
    expect(c.hops[0].label).toBe('34ms');
    expect(chainHasFault(c)).toBe(false);
  });

  it('draws no round trip when the caller has none it trusts', () => {
    // parob/homecast-web#98: a 14.6s round trip painted green. The caller
    // decides whether the number is a reading (`rttForDisplay`); the chain
    // just draws what it is given, and given nothing draws nothing.
    expect(at({ quality: 'good', rtt: null }).hops[0].label).toBeNull();
  });

  it('makes no claim at all when the evidence has expired', () => {
    // `unknown` is not a fault — it is what a backgrounded tab produces. A
    // confident green from expired samples would rebuild the exact bug the
    // indicator exists to remove.
    const c = at({ quality: 'unknown' });
    expect(c.nodes.every(n => n.tone === 'idle')).toBe(true);
    expect(c.hops.every(h => h.tone === 'idle')).toBe(true);
    expect(c.hops[0].label).toBeNull();
  });
});

describe('which hop is broken', () => {
  it('puts offline on the near hop', () => {
    const c = at({ quality: 'offline' });
    expect(c.hops[0].tone).toBe('bad');
    expect(c.hops[0].label).toBe('no answer');
    // Nothing beyond the break has been measured, so nothing beyond it is
    // painted as failing.
    expect(c.hops[1].tone).toBe('idle');
    expect(c.hops[2].tone).toBe('idle');
    expect(c.nodes[3].tone).toBe('idle');
  });

  it('puts a stall on the far hop', () => {
    const c = at({ quality: 'stalled' });
    expect(c.hops[0].tone).toBe('ok');
    expect(c.hops[1].tone).toBe('bad');
  });

  it('marks a slow link amber on the near hop, with the number', () => {
    const c = at({ quality: 'slow', rtt: '2.4s' });
    expect(c.hops[0].tone).toBe('warn');
    expect(c.hops[0].label).toBe('2.4s');
  });

  it('does not idle the rest of the path for a merely slow hop', () => {
    // Slow is not a break: the far hops are still being measured and are fine.
    const c = at({ quality: 'slow' });
    expect(c.hops[1].tone).toBe('ok');
    expect(c.hops[2].tone).toBe('ok');
  });

  it('draws the identical broken hop for a dead cloud relay and a dead self-hosted one', () => {
    // Same picture, opposite advice (in the card) — that contrast is the point.
    const managed = at({ quality: 'stalled', managed: true });
    const own = at({ quality: 'stalled', managed: false });
    expect(managed.hops.map(h => h.tone)).toEqual(own.hops.map(h => h.tone));
  });
});

describe('Local Mode is a bypass, not a break', () => {
  it('shows the home green while the cloud hop is dead', () => {
    const c = at({ quality: 'offline', ...local() });
    expect(c.bypass).toBe(true);
    expect(c.nodes.find(n => n.key === 'cloud')!.tone).toBe('bad');
    // The whole reason the three pills were merged: a green home and
    // "You're not connected" must never appear in the same box.
    expect(c.nodes.find(n => n.key === 'home')!.tone).toBe('ok');
    expect(c.hops[2].label).toBe('direct');
  });

  // homecast-cloud#103's screenshot: a phone with a healthy socket drew
  // "Homecast · no answer" two lines above a section saying the *relay* was
  // what had gone. The cloud hop was painted dead unconditionally.
  it('paints the relay, not the cloud, when the relay is what went', () => {
    const c = at({ quality: 'good', ...local(notServed('offline')), managed: true });
    expect(c.nodes.find(n => n.key === 'cloud')!.tone).toBe('ok');
    expect(c.hops[0].label).toBe('34ms');
    expect(c.nodes.find(n => n.key === 'relay')!.tone).toBe('bad');
    expect(c.hops[1].label).toBe('no relay');
    expect(c.nodes.find(n => n.key === 'home')!.tone).toBe('ok');
    expect(c.bypass).toBe(true);
  });

  it('paints the cloud when the cloud is what went, and makes no claim about the relay', () => {
    const c = at({ quality: 'offline', ...local(notServed('offline')) });
    expect(c.nodes.find(n => n.key === 'cloud')!.tone).toBe('bad');
    // Nothing beyond a dead hop has been measured — the server's last word
    // about the relay is not evidence about it now.
    expect(c.nodes.find(n => n.key === 'relay')!.tone).toBe('idle');
  });

  it('has no fault to point at when nothing is broken (switched on by hand)', () => {
    const c = at({ quality: 'good', ...local(servedBy(MINI)) });
    expect(c.nodes.every(n => n.tone === 'ok')).toBe(true);
    expect(chainHasFault(c)).toBe(false);
  });

  it('warns rather than condemns a relay the server expects back', () => {
    const c = at({ quality: 'good', ...local(notServed('reconnecting')) });
    expect(c.nodes.find(n => n.key === 'relay')!.tone).toBe('warn');
    expect(c.hops[1].label).toBe('reconnecting');
  });
});

describe('the cloud says nothing may serve the home', () => {
  // The same fault `stalled` infers from a timeout, stated outright by the
  // server as the fact for the home. Same picture, no timeout to wait for.
  it('draws the break on the relay hop while the link is fine', () => {
    const c = at({ quality: 'good', serving: notServed('offline'), relayServing: notServed('offline') });
    expect(c.hops[0].tone).toBe('ok');
    expect(c.hops[1].tone).toBe('bad');
    expect(c.hops[1].label).toBe('no relay');
    expect(c.nodes[2].tone).toBe('bad');
    expect(c.nodes[3].tone).toBe('idle');
  });

  it('warns for a relay that is expected back', () => {
    const c = at({ serving: notServed('reconnecting'), relayServing: notServed('reconnecting'), managed: true });
    expect(c.hops[1].tone).toBe('warn');
  });

  it('defers to the link when that is broken too, because the link explains it', () => {
    const c = at({ quality: 'offline', serving: notServed('offline'), relayServing: notServed('offline') });
    expect(c.hops[0].tone).toBe('bad');
    expect(c.hops[1].tone).toBe('idle');
  });

  it('names this Mac as the relay when the fact says so', () => {
    expect(relay({ serving: servedBy(ME), relayServing: servedBy(ME) }).name).toBe('This Mac');
    expect(relay({ serving: servedBy(MINI), relayServing: servedBy(MINI) }).name).toBe('Your relay');
  });
});

describe('takeoverIn', () => {
  const now = Date.parse('2026-09-08T11:33:02Z');
  it('speaks in minutes, then seconds, then any moment', () => {
    expect(takeoverIn('2026-09-08T11:36:02Z', now)).toBe('in 3 min');
    expect(takeoverIn('2026-09-08T11:34:02Z', now)).toBe('in 60s');
    expect(takeoverIn('2026-09-08T11:33:05Z', now)).toBe('any moment');
    expect(takeoverIn('2026-09-08T11:32:00Z', now)).toBe('any moment');
  });
  it('has a word for not knowing', () => {
    expect(takeoverIn(null, now)).toBe('shortly');
    expect(takeoverIn('soon', now)).toBe('shortly');
  });
});

describe('community mode', () => {
  it('has no cloud hop at all', () => {
    const c = at({ community: true });
    expect(c.nodes.map(n => n.key)).not.toContain('cloud');
    expect(c.hops).toHaveLength(c.nodes.length - 1);
  });
});

describe('model invariants', () => {
  const states: Partial<ChainInput>[] = [
    { quality: 'good' },
    { quality: 'unknown' },
    { quality: 'connecting' },
    { quality: 'slow' },
    { quality: 'stalled' },
    { quality: 'offline' },
    { quality: 'stalled', managed: true },
    { quality: 'offline', ...local() },
    { quality: 'good', ...local(notServed('offline')) },
    { serving: notServed('waiting'), relayServing: notServed('waiting') },
    { serving: notServed('reconnecting'), relayServing: notServed('reconnecting') },
    { serving: notServed('offline'), relayServing: notServed('offline'), managed: true },
    { serving: null, relayServing: null },
    { community: true },
  ];

  it.each(states)('always has one fewer hop than nodes: %j', state => {
    const c = at(state);
    expect(c.hops).toHaveLength(c.nodes.length - 1);
  });

  it.each(states)('never labels an idle hop: %j', state => {
    for (const h of at(state).hops) {
      if (h.tone === 'idle') expect(h.label).toBeNull();
    }
  });
});
