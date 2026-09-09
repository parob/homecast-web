import { describe, expect, it } from 'vitest';
import { buildChain, homeNodeName, relayNodeName, takeoverIn, type ChainInput } from '../connection-chain';
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
  reconnected: false,
  serving: servedBy(MINI),
  relayServing: servedBy(MINI),
  thisDevice: ME,
  unmapped: false,
  managed: false,
  community: false,
  rtt: '34ms',
  homeName: null,
  now: Date.parse('2026-09-08T11:33:02Z'),
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
    // The relay words are settled (rule 3) and a home name must not leak into
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
  it('says every hop is healthy, with the round trip on the first hop', () => {
    const c = at({ quality: 'good' });
    expect(c.sentence).toBe('Every hop is healthy.');
    expect(c.nodes.every(n => n.tone === 'ok')).toBe(true);
    expect(c.hops[0].label).toBe('34ms');
    expect(c.noUserAction).toBeNull();
  });

  it('makes no claim at all when the evidence has expired', () => {
    // `unknown` is not a fault — it is what a backgrounded tab produces. A
    // confident green from expired samples would rebuild the exact bug the
    // indicator exists to remove.
    const c = at({ quality: 'unknown' });
    expect(c.nodes.every(n => n.tone === 'idle')).toBe(true);
    expect(c.hops.every(h => h.tone === 'idle')).toBe(true);
    expect(c.hops[0].label).toBeNull();
    expect(c.sentence).toBe('Checking the route to your home.');
  });

  it('confirms recovery without claiming a fault', () => {
    const c = at({ quality: 'good', reconnected: true });
    expect(c.sentence).toBe('Every hop is healthy again.');
  });
});

describe('which hop is broken', () => {
  it('puts offline on the near hop and says what the user can check', () => {
    const c = at({ quality: 'offline' });
    expect(c.hops[0].tone).toBe('bad');
    expect(c.sentence).toContain("can't reach Homecast");
    // Nothing beyond the break has been measured, so nothing beyond it is
    // painted as failing.
    expect(c.hops[1].tone).toBe('idle');
    expect(c.hops[2].tone).toBe('idle');
    expect(c.nodes[3].tone).toBe('idle');
  });

  it('puts a stall on the far hop and says the user side is fine', () => {
    const c = at({ quality: 'stalled' });
    expect(c.hops[0].tone).toBe('ok');
    expect(c.hops[1].tone).toBe('bad');
    expect(c.sentence).toContain('Your device and your internet are both fine');
  });

  it('corrects the copy that is actively wrong today about a fast link', () => {
    // Today this state says "Your connection is slow" about a 28ms connection,
    // because the slowness is further along the path.
    const c = at({ quality: 'slow', rtt: '28ms' });
    expect(c.hops[0].tone).toBe('warn');
    expect(c.sentence).toContain('answering normally behind it');
  });

  it('does not idle the rest of the path for a merely slow hop', () => {
    // Slow is not a break: the far hops are still being measured and are fine.
    const c = at({ quality: 'slow' });
    expect(c.hops[1].tone).toBe('ok');
    expect(c.hops[2].tone).toBe('ok');
  });
});

describe('a cloud relay that has died', () => {
  it('offers no action, because the user owns nothing to restart', () => {
    const c = at({ quality: 'stalled', managed: true });
    expect(c.noUserAction).toBeTruthy();
    expect(c.sentence).toContain('cloud relay');
    expect(c.sentence).not.toContain('your Mac');
  });

  it('offers the reconnect path when the relay is the user own', () => {
    const c = at({ quality: 'stalled', managed: false });
    expect(c.noUserAction).toBeNull();
  });

  it('draws the identical broken hop as the self-hosted case', () => {
    // Same picture, opposite advice — that contrast is the point.
    const managed = at({ quality: 'stalled', managed: true });
    const own = at({ quality: 'stalled', managed: false });
    expect(managed.hops.map(h => h.tone)).toEqual(own.hops.map(h => h.tone));
    expect(managed.sentence).not.toBe(own.sentence);
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
    expect(c.sentence).toContain('talking to your home directly');
  });

  it('says so when the device cannot recognise everything yet', () => {
    const c = at({ quality: 'offline', ...local(), unmapped: true });
    expect(c.sentence).toContain('may not be recognised');
  });

  it('offers no reconnect, because the socket being down is the design', () => {
    const c = at({ quality: 'offline', ...local() });
    expect(c.bypass).toBe(true);
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
    expect(c.sentence).toBe("The cloud relay isn't answering, so this device is talking to your home directly.");
    expect(c.bypass).toBe(true);
  });

  it('paints the cloud when the cloud is what went, and makes no claim about the relay', () => {
    const c = at({ quality: 'offline', ...local(notServed('offline')) });
    expect(c.nodes.find(n => n.key === 'cloud')!.tone).toBe('bad');
    // Nothing beyond a dead hop has been measured — the server's last word
    // about the relay is not evidence about it now.
    expect(c.nodes.find(n => n.key === 'relay')!.tone).toBe('idle');
    expect(c.sentence).toContain('Homecast is unreachable');
  });

  it('says only that it is direct when nothing is broken (switched on by hand)', () => {
    const c = at({ quality: 'good', ...local(servedBy(MINI)) });
    expect(c.nodes.every(n => n.tone === 'ok')).toBe(true);
    expect(c.sentence).toBe('This device is talking to your home directly.');
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
    expect(c.sentence).toContain('Your device and your internet are both fine');
  });

  it('counts down the takeover during the grace', () => {
    const grace = '2026-09-08T11:36:02Z';   // three minutes after `now`
    const c = at({ serving: notServed('waiting', grace), relayServing: notServed('waiting', grace), managed: true });
    expect(c.sentence).toBe("The cloud relay for this home isn't answering. Your own relay takes over in 3 min.");
    expect(c.noUserAction).toBeTruthy();
  });

  it('warns, and offers no reassurance, for a relay that is expected back', () => {
    const c = at({ serving: notServed('reconnecting'), relayServing: notServed('reconnecting'), managed: true });
    expect(c.hops[1].tone).toBe('warn');
    expect(c.sentence).toContain('should be back shortly');
    expect(c.noUserAction).toBeNull();
  });

  it('defers to the link when that is broken too, because the link explains it', () => {
    const c = at({ quality: 'offline', serving: notServed('offline'), relayServing: notServed('offline') });
    expect(c.hops[0].tone).toBe('bad');
    expect(c.sentence).toContain("can't reach Homecast");
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
    expect(c.sentence).toContain('Nothing is going through the cloud');
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
    { quality: 'good', reconnected: true },
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

  it.each(states)('always says something: %j', state => {
    expect(at(state).sentence.length).toBeGreaterThan(0);
  });
});
