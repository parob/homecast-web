import { describe, expect, it } from 'vitest';
import { buildChain, homeNodeName, relayNodeName, type ChainInput } from '../connection-chain';

const base: ChainInput = {
  quality: 'good',
  reconnected: false,
  relayStatus: false,
  localMode: { active: false, unmapped: false },
  managed: false,
  selfRelay: false,
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
    expect(
      home({
        quality: 'offline',
        localMode: { active: true, unmapped: false },
        homeName: 'George Street',
      }).name,
    ).toBe('George Street');
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
    const c = at({ quality: 'offline', localMode: { active: true, unmapped: false } });
    expect(c.bypass).toBe(true);
    expect(c.nodes.find(n => n.key === 'cloud')!.tone).toBe('bad');
    // The whole reason the three pills were merged: a green home and
    // "You're not connected" must never appear in the same box.
    expect(c.nodes.find(n => n.key === 'home')!.tone).toBe('ok');
    expect(c.sentence).toContain('talking to your home directly');
  });

  it('says so when the device cannot recognise everything yet', () => {
    const c = at({ quality: 'offline', localMode: { active: true, unmapped: true } });
    expect(c.sentence).toContain('may not be recognised');
  });

  it('offers no reconnect, because the socket being down is the design', () => {
    const c = at({ quality: 'offline', localMode: { active: true, unmapped: false } });
    expect(c.bypass).toBe(true);
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
    { quality: 'offline', localMode: { active: true, unmapped: false } },
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
