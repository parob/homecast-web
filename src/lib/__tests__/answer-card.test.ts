// What the popover says, state by state — and the one property the whole
// design rests on: the dot in the header and the card under it are coloured
// from the same ranking, so they can never disagree.

import { describe, expect, it } from 'vitest';
import { buildAnswerCard, homeSubject, localModeStandingIn, type AnswerCardInput } from '../answer-card';
import { statusPresentation, type StatusInputs } from '../status-badge';
import { composeServing, type HomeServing } from '@/server/home-serving';
import type { ConnectionQuality } from '@/server/connection-quality';

const ME = 'mac_d6de42ce';
const MINI = 'mac_8ca2d5a2';
const CLOUD = 'mac_managed01';

const servedBy = (by: string | null, kind: HomeServing['kind'] = 'self_hosted'): HomeServing =>
  ({ state: 'served', by, kind, since: null, graceEndsAt: null });
const notServed = (state: 'waiting' | 'reconnecting' | 'offline', graceEndsAt: string | null = null): HomeServing =>
  ({ state, by: null, kind: null, since: null, graceEndsAt });
const local = (under: HomeServing | null = null): Pick<AnswerCardInput, 'serving' | 'relayServing'> =>
  ({ serving: composeServing(under, { active: true }, ME), relayServing: under });

const base: AnswerCardInput = {
  quality: 'good',
  reconnected: false,
  serving: servedBy(MINI),
  relayServing: servedBy(MINI),
  thisDevice: ME,
  unmapped: false,
  localReason: null,
  managed: false,
  community: false,
  rtt: '34ms',
  homeName: 'County Hall',
  deviceNoun: 'iPhone',
  now: Date.parse('2026-09-08T11:33:02Z'),
};
const at = (input: Partial<AnswerCardInput> = {}) => buildAnswerCard({ ...base, ...input });

describe('the healthy card', () => {
  it('says the home works and names the route, and does not draw the chain', () => {
    // parob/homecast-cloud#109: four green nodes, "Every hop is healthy", and
    // the round trip twice, to say nothing is wrong. Now: one line.
    const c = at();
    expect(c.verdict).toBe('County Hall is working');
    expect(c.tone).toBe('ok');
    expect(c.via).toBe('via Your relay · 34ms');
    expect(c.showChain).toBe(false);
    expect(c.because).toBeNull();
    expect(c.reconnect).toBe(false);
  });

  it('names the cloud relay on a cloud plan', () => {
    expect(at({ managed: true, serving: servedBy(CLOUD, 'cloud'), relayServing: servedBy(CLOUD, 'cloud') }).via)
      .toBe('via Cloud relay · 34ms');
  });

  it('still names the route when there is no round trip to trust', () => {
    expect(at({ rtt: null }).via).toBe('via Your relay');
  });

  it('keeps "again" for the recovery, because that is a transition the drawing cannot show', () => {
    expect(at({ reconnected: true }).verdict).toBe('County Hall is working again');
  });

  it('makes no claim while the evidence has expired', () => {
    const c = at({ quality: 'unknown' });
    expect(c.tone).toBe('idle');
    expect(c.verdict).toBe('Checking the route to County Hall…');
    expect(c.showChain).toBe(false);
  });

  it('claims only the link when there is no home to speak for', () => {
    // Onboarding, or several homes and none selected.
    const c = at({ serving: null, relayServing: null });
    expect(c.verdict).toBe('Connected to Homecast');
    expect(c.via).toBe('Round trip 34ms');
  });

  it('falls back to "Your home" when the home has no name', () => {
    expect(at({ homeName: null }).verdict).toBe('Your home is working');
    expect(homeSubject('  ')).toBe('Your home');
    expect(homeSubject(' George Street ')).toBe('George Street');
  });
});

describe('this device cannot get out', () => {
  it('names the device, not the home, and offers the one thing that helps', () => {
    const c = at({ quality: 'offline' });
    expect(c.tone).toBe('bad');
    expect(c.verdict).toBe("This iPhone can't reach Homecast");
    expect(c.because).toContain('Check your wifi or mobile signal');
    expect(c.because).toContain("County Hall itself may be fine");
    expect(c.reconnect).toBe(true);
    expect(c.showChain).toBe(true);
  });

  it('calls a Mac a Mac', () => {
    expect(at({ quality: 'offline', deviceNoun: 'Mac' }).verdict).toBe("This Mac can't reach Homecast");
  });

  it('says "working, slowly" rather than blaming the home', () => {
    // The old copy said "Your connection is slow" about a 28ms connection.
    const c = at({ quality: 'slow', rtt: '2.4s' });
    expect(c.tone).toBe('warn');
    expect(c.verdict).toBe('County Hall is working, slowly');
    expect(c.because).toContain('Your relay is answering normally behind it');
    expect(c.reconnect).toBe(true);
  });

  it('says the cloud relay is behind a slow link on a cloud plan', () => {
    expect(at({ quality: 'slow', managed: true }).because).toContain('The cloud relay is answering normally');
  });

  it('pulses while reconnecting and says nothing more', () => {
    const c = at({ quality: 'connecting' });
    expect(c.pulse).toBe(true);
    expect(c.verdict).toBe('Reconnecting to Homecast…');
    expect(c.because).toBeNull();
  });
});

describe('a stall — the flagship contrast', () => {
  it('offers Reconnect for the user own relay', () => {
    const c = at({ quality: 'stalled' });
    expect(c.verdict).toBe("County Hall isn't responding");
    expect(c.because).toBe("Homecast can't get an answer from your relay. Your iPhone and your internet are both fine.");
    expect(c.reconnect).toBe(true);
    expect(c.note).toBeNull();
  });

  it('offers nothing but the note for a dead cloud relay, because the user owns nothing to restart', () => {
    const c = at({ quality: 'stalled', managed: true });
    expect(c.because).toContain('The cloud relay for this home');
    expect(c.reconnect).toBe(false);
    expect(c.note).toMatch(/Homecast has been notified/);
  });
});

describe('the server says nothing may serve the home', () => {
  const gone = (state: 'waiting' | 'reconnecting' | 'offline', grace: string | null = null) =>
    ({ serving: notServed(state, grace), relayServing: notServed(state, grace) });

  it('is red, and offers no Reconnect, because the link is fine', () => {
    const c = at({ ...gone('offline'), managed: true });
    expect(c.tone).toBe('bad');
    expect(c.verdict).toBe("County Hall can't be reached");
    expect(c.because).toBe("The cloud relay isn't answering. Your iPhone and your internet are both fine.");
    expect(c.reconnect).toBe(false);
    expect(c.note).toMatch(/notified/);
    expect(c.showChain).toBe(true);
  });

  it('tells a self-hosted owner what to go and check', () => {
    const c = at(gone('offline'));
    expect(c.because).toContain('check that the relay is on and online');
    expect(c.note).toBeNull();
  });

  it('counts down the takeover as the second line, not an aside', () => {
    // The state that had no name (homecast-cloud#99).
    const c = at({ ...gone('waiting', '2026-09-08T11:36:02Z'), managed: true });
    expect(c.tone).toBe('warn');
    expect(c.pulse).toBe(true);
    expect(c.verdict).toBe("County Hall can't be reached right now");
    expect(c.because).toBe("The cloud relay isn't answering. Your own relay takes over in 3 min.");
    expect(c.note).toBeNull();
  });

  it('warns, and expects the relay back, during the reconnect grace', () => {
    const c = at({ ...gone('reconnecting'), managed: true });
    expect(c.tone).toBe('warn');
    expect(c.pulse).toBe(true);
    expect(c.because).toBe('The cloud relay dropped off a moment ago and should be back shortly.');
  });

  it('defers to a broken link, because the link explains it', () => {
    const c = at({ quality: 'offline', ...gone('offline') });
    expect(c.verdict).toBe("This iPhone can't reach Homecast");
  });
});

describe('Local Mode', () => {
  it('is amber "standing in" when the cloud relay is what went, and says so once', () => {
    // homecast-cloud#103: a heading, two paragraphs, a disclosure and a link,
    // under a chain that had already explained the situation. Now: one sentence.
    const c = at({ ...local(notServed('offline')), managed: true });
    expect(c.tone).toBe('warn');
    expect(c.verdict).toBe('County Hall is working');
    expect(c.because).toBe("The cloud relay isn't answering, so this iPhone is talking to your home directly — while Homecast is open.");
    expect(c.showChain).toBe(true);
    expect(c.reconnect).toBe(false);
  });

  it('does not say "while Homecast is open" on a Mac, which stays open', () => {
    expect(at({ ...local(notServed('offline')), deviceNoun: 'Mac' }).because)
      .toBe("Your relay isn't answering, so this Mac is talking to your home directly.");
  });

  it('names the cloud as what went when the cloud is what went', () => {
    const c = at({ quality: 'offline', ...local() });
    expect(c.tone).toBe('warn');
    expect(c.because).toContain('Homecast is unreachable, so this iPhone is talking to your home directly');
    // Not red: the home works. Not a Reconnect either — the socket being down
    // is the design.
    expect(c.reconnect).toBe(false);
  });

  it('is green, and a choice, when switched on by hand with nothing wrong', () => {
    const c = at({ ...local(servedBy(MINI)), localReason: 'manual' });
    expect(c.tone).toBe('ok');
    expect(c.because).toBe('This iPhone is talking to your home directly — Local Mode is switched on in Settings.');
    // Nothing is broken, so there is nothing for the drawing to point at.
    expect(c.showChain).toBe(false);
  });

  it('is green for someone who has never set a relay up', () => {
    const c = at({ ...local(null), localReason: 'no-relay-ever' });
    expect(c.tone).toBe('ok');
    expect(c.because).toContain("you haven't set up a relay yet");
  });

  it('carries the unmapped caveat as one amber line', () => {
    const c = at({ ...local(notServed('offline')), unmapped: true });
    expect(c.tone).toBe('warn');
    expect(c.caveat).toBe('Some devices show their Apple Home names until this iPhone can reach Homecast again.');
    expect(at({ ...local(notServed('offline')) }).caveat).toBeNull();
  });

  it('tells a cloud-plan Mac that took the home over that it is standing in for everyone', () => {
    // The screenshot under homecast-cloud#109: Local Mode AND the activated
    // standby on the same Mac, told as three different stories. One now.
    const c = at({ ...local(servedBy(ME, 'self_hosted')), managed: true, deviceNoun: 'Mac' });
    expect(c.tone).toBe('warn');
    expect(c.because).toBe("The cloud relay is offline, so this Mac is standing in — for you, and for everyone else at home — until it's back.");
  });
});

describe('the activated standby, without Local Mode', () => {
  it('is amber, says the home works, and hides the drawing because the path through this Mac is green', () => {
    const c = at({ managed: true, serving: servedBy(ME, 'self_hosted'), relayServing: servedBy(ME, 'self_hosted'), deviceNoun: 'Mac' });
    expect(c.tone).toBe('warn');
    expect(c.verdict).toBe('County Hall is working');
    expect(c.because).toContain('this Mac is standing in');
    expect(c.via).toBe('via This Mac · 34ms');
    expect(c.showChain).toBe(false);
  });

  it('is plain green when this Mac is simply the relay on a self-hosted plan', () => {
    const c = at({ serving: servedBy(ME), relayServing: servedBy(ME), deviceNoun: 'Mac' });
    expect(c.tone).toBe('ok');
    expect(c.because).toBeNull();
    expect(c.via).toBe('via This Mac · 34ms');
  });
});

describe('community mode', () => {
  it('says this Mac is the server and nothing goes through the cloud', () => {
    const c = at({ community: true, deviceNoun: 'Mac' });
    expect(c.tone).toBe('ok');
    expect(c.verdict).toBe('County Hall is working');
    expect(c.because).toContain('Nothing is going through the cloud');
    expect(c.showChain).toBe(false);
  });
});

describe('localModeStandingIn', () => {
  const i = { quality: 'good' as ConnectionQuality, relayServing: servedBy(MINI), thisDevice: ME, managed: false, localReason: null };
  it('is a choice when the link is fine, the relay is served, and no reason says otherwise', () => {
    expect(localModeStandingIn(i)).toBe(false);
  });
  it('is a backup path when the link is down, the relay is gone, or the controller says so', () => {
    expect(localModeStandingIn({ ...i, quality: 'offline' })).toBe(true);
    expect(localModeStandingIn({ ...i, relayServing: notServed('offline') })).toBe(true);
    expect(localModeStandingIn({ ...i, localReason: 'relay-offline' })).toBe(true);
    expect(localModeStandingIn({ ...i, localReason: 'socket-down' })).toBe(true);
    expect(localModeStandingIn({ ...i, localReason: 'manual' })).toBe(false);
  });
  it('is a backup path on a cloud-plan Mac the server says is serving', () => {
    expect(localModeStandingIn({ ...i, managed: true, relayServing: servedBy(ME) })).toBe(true);
    expect(localModeStandingIn({ ...i, managed: false, relayServing: servedBy(ME) })).toBe(false);
  });
});

// ── The property ──────────────────────────────────────────────────────────
//
// For every combination of link quality, server fact, Local Mode, plan and
// relay duty: the colour `statusPresentation` puts on the dot is the colour
// `buildAnswerCard` puts on the verdict. This is what "one answer" means, and
// it is the invariant the three-pill merge existed for, one layer down.
describe('the dot and the card agree', () => {
  const toneOfDot = (dotClass: string) =>
    /red/.test(dotClass) ? 'bad' : /amber/.test(dotClass) ? 'warn' : /emerald|green/.test(dotClass) ? 'ok' : 'idle';

  const qualities: ConnectionQuality[] = ['good', 'unknown', 'connecting', 'slow', 'stalled', 'offline'];
  const facts: Array<HomeServing | null> = [
    null, servedBy(ME), servedBy(MINI), servedBy(CLOUD, 'cloud'),
    notServed('waiting', '2026-09-08T11:36:02Z'), notServed('reconnecting'), notServed('offline'),
  ];
  const reasons: AnswerCardInput['localReason'][] = [null, 'manual', 'relay-offline'];

  const cases: Array<[string, AnswerCardInput, StatusInputs]> = [];
  for (const quality of qualities) {
    for (const fact of facts) {
      for (const managed of [false, true]) {
        for (const relayEnabled of [false, true]) {
          for (const activeLocal of [false, true]) {
            for (const localReason of activeLocal ? reasons : [null]) {
              for (const unmapped of activeLocal ? [false, true] : [false]) {
                const serving = activeLocal ? composeServing(fact, { active: true }, ME) : fact;
                const shared = { quality, reconnected: false, serving, relayServing: fact, thisDevice: ME, unmapped, localReason, managed, community: false };
                cases.push([
                  `${quality} · ${fact ? `${fact.state}${fact.by ? `:${fact.by === ME ? 'me' : fact.by === CLOUD ? 'cloud' : 'other'}` : ''}` : 'none'} · managed=${managed} · relay=${relayEnabled} · local=${activeLocal}${localReason ? `(${localReason})` : ''}${unmapped ? ' unmapped' : ''}`,
                  { ...shared, rtt: '34ms', homeName: 'County Hall', deviceNoun: 'Mac' },
                  { ...shared, relayEnabled },
                ]);
              }
            }
          }
        }
      }
    }
  }

  it.each(cases)('%s', (_name, cardInput, dotInput) => {
    const card = buildAnswerCard(cardInput);
    const dot = statusPresentation(dotInput);
    // `connecting` is the one state drawn neutral-and-pulsing on the dot; the
    // card calls that idle too.
    expect(card.tone).toBe(toneOfDot(dot.dotClass));
    expect(card.pulse).toBe(dot.pulse);
  });

  it('never offers Reconnect when the fault is not this device link', () => {
    for (const [, cardInput] of cases) {
      const card = buildAnswerCard(cardInput);
      if (card.reconnect) expect(['offline', 'connecting', 'slow', 'stalled']).toContain(cardInput.quality);
    }
  });

  it('draws the chain only when a hop is not green', () => {
    for (const [, cardInput] of cases) {
      const card = buildAnswerCard(cardInput);
      const anyFault = card.chain.hops.some(h => h.tone !== 'ok') || card.chain.nodes.some(n => n.tone !== 'ok');
      if (card.showChain) expect(anyFault).toBe(true);
    }
  });
});
