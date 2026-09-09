// The case this whole merge exists for is the first test below: Local Mode
// active while the connection is offline. Those two co-occur *by design* —
// Local Mode engages because the cloud is unreachable — and the app used to
// render them as a red pill and a green pill sitting on the same row
// contradicting each other.
//
// Everything about the home now arrives as one value, `serving`, so the
// table at the bottom is invariant 4 of homecast-cloud#102: for every state
// the server can report crossed with whether this device is serving the home
// itself, the label the dot carries.
//
// The colour rule is the answer card's (homecast-cloud#109): the dot is about
// whether the home works, not about what this machine is doing. What that
// changed is called out where it is tested.

import { describe, it, expect } from 'vitest';
import { statusPresentation, STANDING_IN_PRESENTATION, type StatusInputs } from '../status-badge';
import { connectionPresentation, RECONNECTED_PRESENTATION } from '../connection-presentation';
import { composeServing, type HomeServing } from '@/server/home-serving';
import type { ConnectionQuality } from '@/server/connection-quality';

const ME = 'mac_d6de42ce';
const MINI = 'mac_8ca2d5a2';
const CLOUD = 'mac_managed01';

const fact = (over: Partial<HomeServing> = {}): HomeServing =>
  ({ state: 'served', by: MINI, kind: 'self_hosted', since: null, graceEndsAt: null, ...over });
const servedBy = (by: string, kind: HomeServing['kind'] = 'self_hosted') => fact({ by, kind });
const notServed = (state: 'waiting' | 'reconnecting' | 'offline'): HomeServing =>
  fact({ state, by: null, kind: null, graceEndsAt: state === 'waiting' ? '2026-09-08T11:36:02Z' : null });
/** Local Mode over the server's fact — `relayServing` keeps the server's half. */
const local = (under: HomeServing | null = null): Pick<StatusInputs, 'serving' | 'relayServing'> =>
  ({ serving: composeServing(under, { active: true }, ME), relayServing: under });

function inputs(over: Partial<StatusInputs> = {}): StatusInputs {
  return {
    quality: 'good',
    reconnected: false,
    serving: servedBy(MINI),
    relayServing: servedBy(MINI),
    thisDevice: ME,
    unmapped: false,
    localReason: null,
    relayEnabled: false,
    managed: false,
    community: false,
    ...over,
  };
}

describe('statusPresentation', () => {
  it('says the home is standing in, not Offline, when both are true', () => {
    // The reason the merge was worth doing. "Offline" is not wrong, it is just
    // the less useful half of the truth: the home is working.
    const p = statusPresentation(inputs({ quality: 'offline', ...local() }));
    expect(p.label).toBe('Standing in');
    expect(p.dotClass).not.toContain('red');
  });

  it('is amber, not green, when Local Mode is a backup path', () => {
    // A backup path is worth knowing about: on a phone it ends when the app
    // closes, and automations on the relay are not running. Local Mode used to
    // be green here while the activated standby was amber — two colours for
    // one situation.
    for (const i of [
      inputs({ quality: 'offline', ...local() }),
      inputs({ ...local(notServed('offline')) }),
      inputs({ ...local(servedBy(MINI)), localReason: 'relay-offline' }),
    ]) {
      const p = statusPresentation(i);
      expect(p.label).toBe('Standing in');
      expect(p.dotClass).toContain('amber');
    }
  });

  it('is green Local Mode when switched on by hand with nothing wrong', () => {
    const p = statusPresentation(inputs({ ...local(servedBy(MINI)), localReason: 'manual' }));
    expect(p.label).toBe('Local Mode');
    expect(p.dotClass).toContain('green');
  });

  it('flags an unmapped Local Mode on the dot even when it was a choice', () => {
    // The home works, but under Apple Home's names rather than the user's own.
    const p = statusPresentation(inputs({ ...local(servedBy(MINI)), localReason: 'manual', unmapped: true }));
    expect(p.dotClass).toContain('amber');
  });

  it('reports connection trouble when Local Mode has not taken over', () => {
    for (const q of ['offline', 'stalled', 'slow', 'connecting'] as const) {
      const p = statusPresentation(inputs({ quality: q }));
      expect(p).toEqual(connectionPresentation(q));
    }
  });

  it('stays a quiet dot when everything is fine', () => {
    const p = statusPresentation(inputs());
    expect(p.label).toBeNull();
    expect(p.pulse).toBe(false);
  });

  it('stays a quiet dot when it has heard nothing about the home yet', () => {
    // No fact is not a fault. The quiet dot is the honest default; the popover
    // says "checking".
    expect(statusPresentation(inputs({ serving: null, relayServing: null }))).toEqual(statusPresentation(inputs()));
  });

  it('says the home is unreachable, in red, while the link to the cloud is perfect', () => {
    // homecast-cloud#99: the dot sat on quiet emerald while every write to the
    // home came back NO_DEVICE, because every other state here is about this
    // device's link, and that link was flawless. Red rather than the old
    // amber: from the user's side the home does not work.
    const p = statusPresentation(inputs({ serving: notServed('offline'), relayServing: notServed('offline') }));
    expect(p.label).toBe('Relay offline');
    expect(p.dotClass).toContain('red');
  });

  it('names the takeover grace rather than calling it connected, and pulses', () => {
    // The state that had no name. An old server reported it as `connected`,
    // and five minutes of a green dot over a home refusing every write was
    // the whole of #99. Amber and moving: it is about to resolve itself.
    const p = statusPresentation(inputs({ serving: notServed('waiting'), relayServing: notServed('waiting') }));
    expect(p.label).toBe('Relay offline');
    expect(p.dotClass).toContain('amber');
    expect(p.pulse).toBe(true);
    expect(p.headline).toMatch(/standby takes over/);
  });

  it('pulses for a relay the server expects back', () => {
    const p = statusPresentation(inputs({ serving: notServed('reconnecting'), relayServing: notServed('reconnecting') }));
    expect(p.label).toBe('Relay reconnecting');
    expect(p.pulse).toBe(true);
  });

  it('lets a broken link outrank an unserved home, because the link explains it', () => {
    const p = statusPresentation(inputs({ quality: 'offline', serving: notServed('offline'), relayServing: notServed('offline') }));
    expect(p.label).toBe('Offline');
  });

  it('does not confirm a recovery of the link as a recovery of the home', () => {
    // "Reconnected" over a home that is still refusing writes would read as
    // "and your home works again".
    const p = statusPresentation(inputs({ reconnected: true, serving: notServed('offline'), relayServing: notServed('offline') }));
    expect(p.label).toBe('Relay offline');
  });

  it('stays a quiet green dot while the cloud relay serves a cloud-plan home', () => {
    // This Mac has its relay on, and the fact says the cloud relay holds the
    // home. That is the healthy shape of a cloud-plan Mac: nothing to report,
    // so no label — the same quiet dot as any other good connection. The
    // popover's "This Mac" row says standing by.
    const p = statusPresentation(inputs({ relayEnabled: true, managed: true, serving: servedBy(CLOUD, 'cloud'), relayServing: servedBy(CLOUD, 'cloud') }));
    expect(p).toEqual(statusPresentation(inputs()));
    expect(p.label).toBeNull();
    expect(p.dotClass).toContain('emerald');
  });

  it('says this Mac is standing in once the standby has been activated', () => {
    // The cloud relay has been gone for the takeover grace and this Mac is
    // now the one serving. The amber is about the cloud relay being offline.
    // One word for the situation, shared with Local Mode, rather than one per
    // mechanism ("Standby active").
    const p = statusPresentation(inputs({ relayEnabled: true, managed: true, serving: servedBy(ME), relayServing: servedBy(ME) }));
    expect(p).toEqual(STANDING_IN_PRESENTATION);
    expect(p.dotClass).toContain('amber');
  });

  it('lets connection trouble and Local Mode outrank the activated standby', () => {
    for (const s of [servedBy(CLOUD, 'cloud'), servedBy(ME)]) {
      expect(statusPresentation(inputs({ relayEnabled: true, managed: true, serving: s, relayServing: s, quality: 'offline' })).label).toBe('Offline');
    }
    // Local Mode over a cloud relay that is fine is a choice; over this Mac's
    // own takeover it is the same backup path told from the device's side.
    expect(statusPresentation(inputs({ relayEnabled: true, managed: true, ...local(servedBy(CLOUD, 'cloud')) })).label).toBe('Local Mode');
    expect(statusPresentation(inputs({ relayEnabled: true, managed: true, ...local(servedBy(ME)) })).label).toBe('Standing in');
  });

  it('does not need the relay flag to recognise this Mac as the activated standby', () => {
    // The server naming this device is proof enough that its relay is on, and
    // the card has no such input — so neither does the ranking.
    const p = statusPresentation(inputs({ relayEnabled: false, managed: true, serving: servedBy(ME), relayServing: servedBy(ME) }));
    expect(p.label).toBe('Standing in');
  });

  it('stays quiet on an active relay with a healthy connection', () => {
    // The standing "Relay" word is gone by design: when all is well the bubble
    // says nothing, and the popover's row still reports Active relay.
    const p = statusPresentation(inputs({ relayEnabled: true, serving: servedBy(ME), relayServing: servedBy(ME) }));
    expect(p.label).toBeNull();
  });

  it('stays quiet when another of your Macs is the relay', () => {
    // This used to be an amber "Standby" pill over a home that worked
    // perfectly. Duty describes what this machine is doing, not whether you
    // can reach anything; it is a row in the popover now.
    const p = statusPresentation(inputs({ relayEnabled: true, serving: servedBy(MINI), relayServing: servedBy(MINI) }));
    expect(p.label).toBeNull();
    expect(p.dotClass).toContain('emerald');
  });

  it('never says Standby on a device that is not a relay', () => {
    const p = statusPresentation(inputs({ relayEnabled: false, serving: servedBy(MINI) }));
    expect(p.label).toBeNull();
  });

  it('never reports duty on a Community Mac, which has nobody to stand by for', () => {
    // The Community seed can predate the device id and carry `by: null`; a
    // Community Mac is the server whatever the fact says about who.
    const p = statusPresentation(inputs({ relayEnabled: true, community: true, managed: true, serving: servedBy(ME), relayServing: servedBy(ME), thisDevice: null }));
    expect(p.label).toBeNull();
  });

  it('lets connection trouble outrank duty', () => {
    // When you cannot reach anything, why beats who.
    const p = statusPresentation(inputs({ quality: 'offline', relayEnabled: true, serving: servedBy(MINI) }));
    expect(p.label).toBe('Offline');
  });

  it('confirms a recovery once nothing louder is happening', () => {
    const p = statusPresentation(inputs({ reconnected: true }));
    expect(p).toEqual(RECONNECTED_PRESENTATION);
  });

  it('does not confirm a recovery while still in trouble', () => {
    // "Reconnected" next to a broken connection would be a lie.
    const p = statusPresentation(inputs({ reconnected: true, quality: 'stalled' }));
    expect(p.label).toBe('Not responding');
  });

  it('does not confirm a recovery while Local Mode is carrying the home', () => {
    const p = statusPresentation(inputs({ reconnected: true, ...local(notServed('offline')) }));
    expect(p.label).toBe('Standing in');
  });

  it('always has something for a screen reader', () => {
    const qualities: ConnectionQuality[] = ['good', 'unknown', 'connecting', 'slow', 'stalled', 'offline'];
    const facts = [null, servedBy(ME), servedBy(MINI), notServed('waiting'), notServed('reconnecting'), notServed('offline')];
    for (const q of qualities) {
      for (const f of facts) {
        for (const active of [false, true]) {
          const p = statusPresentation(inputs({
            quality: q,
            serving: active ? composeServing(f, { active: true }, ME) : f,
            relayServing: f,
            relayEnabled: true,
          }));
          expect(p.srLabel.length).toBeGreaterThan(0);
          expect(p.headline.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

// Invariant 4 of homecast-cloud#102, as a table: every state the server can
// report, crossed with whether this device is serving the home itself, with a
// healthy link. Local Mode composes over the server's fact and outranks it in
// every row; whether it reads as a choice or a backup path is decided by what
// the server says about the relay.
describe('the label, by server state × this device (invariant 4)', () => {
  const rows: Array<[string, HomeServing | null, boolean, string | null]> = [
    ['served by another',      servedBy(MINI),           false, null],
    ['served by me',           servedBy(ME),             false, null],
    ['waiting',                notServed('waiting'),     false, 'Relay offline'],
    ['reconnecting',           notServed('reconnecting'), false, 'Relay reconnecting'],
    ['offline',                notServed('offline'),     false, 'Relay offline'],
    ['unknown',                null,                     false, null],
    ['served by another',      servedBy(MINI),           true,  'Local Mode'],
    ['served by me',           servedBy(ME),             true,  'Local Mode'],
    ['waiting',                notServed('waiting'),     true,  'Standing in'],
    ['reconnecting',           notServed('reconnecting'), true,  'Standing in'],
    ['offline',                notServed('offline'),     true,  'Standing in'],
    ['unknown',                null,                     true,  'Local Mode'],
  ];
  it.each(rows)('server=%s, device serving=%s → %s', (_name, server, active, label) => {
    const serving = active ? composeServing(server, { active: true }, ME) : server;
    expect(statusPresentation(inputs({ serving, relayServing: server })).label).toBe(label);
  });
});
