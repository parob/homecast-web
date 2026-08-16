// The rules that decide whether this device serves HomeKit itself.
//
// Two of these are load-bearing beyond their size. The relay-Mac exclusion is
// what stops a device registering a second write publisher over the top of its
// own relay duties, and the anti-flap test is what stops a relay bouncing every
// few seconds from turning the badge into a strobe.

import { describe, it, expect } from 'vitest';
import {
  decideLocalMode,
  localModeCanServe,
  resolveLocalId,
  EMPTY_MEMO,
  ENGAGE_AFTER_MS,
  ENGAGE_AFTER_MS_RELAY_CAPABLE,
  DISENGAGE_AFTER_MS,
  type LocalModeInputs,
  type LocalModeMemo,
  type LocalServeState,
} from '../local-mode';

/** County Hall, in both id spaces — the same fixture relay-routing uses. */
const LIVE = '3C4399F4-B7E7-5697-9866-D15A8C7CCFE5';
const HC = 'd08cb174-3548-4753-9abe-3d4a13d3326b';

function inputs(over: Partial<LocalModeInputs> = {}): LocalModeInputs {
  return {
    bridgeReady: true,
    isThisDeviceTheRelay: false,
    relayCapable: false,
    override: 'auto',
    socketState: 'connected',
    homes: [{ id: LIVE, relayState: 'offline' }],
    anyRelayKnown: true,
    homesLoaded: true,
    now: 0,
    ...over,
  };
}

/** Run a sequence of ticks, carrying the memo forward like the controller does. */
function run(seq: Array<Partial<LocalModeInputs>>, start: LocalModeMemo = EMPTY_MEMO) {
  let memo = start;
  return seq.map((over) => {
    const d = decideLocalMode(inputs(over), memo);
    memo = d.memo;
    return d;
  });
}

describe('decideLocalMode — hard guards', () => {
  it('never activates on the device that is currently the relay', () => {
    // The most important rule here. The relay already answers for every
    // client; a private second path would double its writes and fight
    // startRelayDuties for the same global publisher slot.
    const d = decideLocalMode(
      inputs({ isThisDeviceTheRelay: true, now: 10 * 60_000 }),
      { active: true, pendingSince: null },
    );
    expect(d.active).toBe(false);
  });

  it('never activates without a working HomeKit bridge', () => {
    expect(decideLocalMode(inputs({ bridgeReady: false }), EMPTY_MEMO).active).toBe(false);
  });

  it('respects an explicit off even with the relay down', () => {
    const d = decideLocalMode(inputs({ override: 'off', now: 10 * 60_000 }), EMPTY_MEMO);
    expect(d.active).toBe(false);
  });

  it('respects an explicit on immediately, with no engage delay', () => {
    const d = decideLocalMode(
      inputs({ override: 'on', homes: [{ id: LIVE, relayState: 'connected' }] }),
      EMPTY_MEMO,
    );
    expect(d.active).toBe(true);
    expect(d.reason).toBe('manual');
  });

  it('off beats on-the-device-that-is-the-relay ordering', () => {
    // Guard order is asserted deliberately: 'off' must win before we even ask
    // what kind of device this is.
    const d = decideLocalMode(inputs({ override: 'off', isThisDeviceTheRelay: true }), EMPTY_MEMO);
    expect(d.active).toBe(false);
  });
});

describe('decideLocalMode — "Always on" is not a magic wand', () => {
  it('still refuses when the device cannot serve HomeKit at all', () => {
    // Observed on a real iPhone: "Always on" selected, and Local Mode sat in
    // Standby, because HomeKit had not finished loading so bridgeReady was
    // false. Refusing is correct — you cannot serve a home you cannot read —
    // but the UI must then say *that*, not "your relay is handling this home".
    const d = decideLocalMode(inputs({ override: 'on', bridgeReady: false }), EMPTY_MEMO);
    expect(d.active).toBe(false);
  });

  it('engages the moment the bridge becomes ready', () => {
    // The other half of the same bug: capability was probed once at startup,
    // before HomeKit had loaded, and never re-probed — so this transition
    // never happened and "Always on" stayed inert forever.
    const r = run([
      { override: 'on', bridgeReady: false, now: 0 },
      { override: 'on', bridgeReady: true, now: 1_000 },
    ]);
    expect(r.map((d) => d.active)).toEqual([false, true]);
  });
});

describe('decideLocalMode — engaging', () => {
  it('waits the full engage delay, then activates', () => {
    const r = run([{ now: 0 }, { now: ENGAGE_AFTER_MS - 1 }, { now: ENGAGE_AFTER_MS }]);
    expect(r.map((d) => d.active)).toEqual([false, false, true]);
    expect(r[2].reason).toBe('relay-offline');
  });

  it('engages instantly when no relay was ever set up', () => {
    // The "just trying the app" case. There is nothing to wait for, and an
    // eight-second stall on first launch would read as the app being broken.
    const d = decideLocalMode(inputs({ anyRelayKnown: false, homes: [] }), EMPTY_MEMO);
    expect(d.active).toBe(true);
    expect(d.reason).toBe('no-relay-ever');
  });

  it('gives a relay-capable Mac much longer, so the server can promote it', () => {
    const seq = [{ now: 0 }, { now: ENGAGE_AFTER_MS + 1 }, { now: ENGAGE_AFTER_MS_RELAY_CAPABLE }];
    const r = run(seq.map((s) => ({ ...s, relayCapable: true })));
    expect(r.map((d) => d.active)).toEqual([false, false, true]);
  });

  it('reports socket-down when the cloud itself is unreachable', () => {
    const r = run([
      { now: 0, socketState: 'disconnected', homes: [{ id: LIVE, relayState: 'connected' }] },
      { now: ENGAGE_AFTER_MS, socketState: 'disconnected', homes: [{ id: LIVE, relayState: 'connected' }] },
    ]);
    expect(r[1].active).toBe(true);
    expect(r[1].reason).toBe('socket-down');
  });

  it('treats a reconnecting relay as still serving, and does not engage', () => {
    // The server already applied its own grace to reach 'reconnecting'.
    // Second-guessing it here would engage on every routine blip.
    const r = run([
      { now: 0, homes: [{ id: LIVE, relayState: 'reconnecting' }] },
      { now: 10 * 60_000, homes: [{ id: LIVE, relayState: 'reconnecting' }] },
    ]);
    expect(r.every((d) => !d.active)).toBe(true);
  });

  it('leaves a healthy cloud-managed home to its own infrastructure', () => {
    const r = run([
      { now: 0, homes: [{ id: LIVE, relayState: 'connected', isCloudManaged: true }] },
      { now: 10 * 60_000, homes: [{ id: LIVE, relayState: 'connected', isCloudManaged: true }] },
    ]);
    expect(r.every((d) => !d.active)).toBe(true);
  });
});

describe('decideLocalMode — disengaging', () => {
  it('holds on for the disengage delay after the relay returns', () => {
    const active: LocalModeMemo = { active: true, pendingSince: null };
    const up = { homes: [{ id: LIVE, relayState: 'connected' }] };
    const r = run([{ ...up, now: 0 }, { ...up, now: DISENGAGE_AFTER_MS - 1 }, { ...up, now: DISENGAGE_AFTER_MS }], active);
    expect(r.map((d) => d.active)).toEqual([true, true, false]);
  });

  it('does not blink while a relay flaps every five seconds', () => {
    // The anti-flap test. Disengage is slower than engage, so an alternating
    // up/down relay can never complete a disengage before the next drop
    // resets it — the badge stays put instead of strobing.
    const seq: Array<Partial<LocalModeInputs>> = [];
    for (let t = 0; t <= 120_000; t += 5_000) {
      seq.push({
        now: t,
        homes: [{ id: LIVE, relayState: (t / 5_000) % 2 === 0 ? 'connected' : 'offline' }],
      });
    }
    const r = run(seq, { active: true, pendingSince: null });
    expect(r.every((d) => d.active)).toBe(true);
  });
});

describe('localModeCanServe', () => {
  function serve(over: Partial<LocalServeState> = {}): LocalServeState {
    return {
      active: true,
      cloudReachable: true,
      liveHomeIds: new Set([LIVE]),
      hcToLive: new Map([[HC.toUpperCase(), LIVE]]),
      ...over,
    };
  }

  it('serves a home this device HomeKit reports', () => {
    expect(localModeCanServe('accessories.list', LIVE, serve())).toBe(true);
  });

  it('serves an hc_id that translates to a live home', () => {
    expect(localModeCanServe('accessories.list', HC, serve())).toBe(true);
  });

  it('refuses a home this device cannot see', () => {
    expect(localModeCanServe('accessories.list', 'D0000000-0000-0000-0000-000000000000', serve())).toBe(false);
  });

  it('never answers server-owned actions', () => {
    for (const a of ['subscribe', 'unsubscribe', 'subscriptions.list']) {
      expect(localModeCanServe(a, undefined, serve())).toBe(false);
    }
  });

  it('leaves homes.list to the cloud while the cloud is reachable', () => {
    // The cloud deduplicates cloud-managed homes across relays; a local answer
    // would quietly omit them.
    expect(localModeCanServe('homes.list', undefined, serve())).toBe(false);
  });

  it('answers homes.list locally once the cloud is unreachable', () => {
    // Because then the alternative to a slightly incomplete list is no list.
    expect(localModeCanServe('homes.list', undefined, serve({ cloudReachable: false }))).toBe(true);
  });

  it('serves nothing at all when inactive', () => {
    expect(localModeCanServe('accessories.list', LIVE, serve({ active: false }))).toBe(false);
  });
});

describe('resolveLocalId', () => {
  it('compares case-insensitively, because the two id spaces disagree', () => {
    // HomeKit reports uppercase, the cloud stores lowercase, and UUIDs are
    // case-insensitive per RFC 4122.
    const s = { liveHomeIds: new Set([LIVE]), hcToLive: new Map([[HC.toUpperCase(), LIVE]]) };
    expect(resolveLocalId(LIVE.toLowerCase(), s)).toBe(LIVE);
    expect(resolveLocalId(HC.toLowerCase(), s)).toBe(LIVE);
  });

  it('refuses a translation HomeKit is no longer reporting', () => {
    // The guarantee that makes a stale map harmless: it resolves to null and
    // the request goes to the cloud, rather than being answered wrongly.
    const s = { liveHomeIds: new Set<string>(), hcToLive: new Map([[HC.toUpperCase(), LIVE]]) };
    expect(resolveLocalId(HC, s)).toBeNull();
  });
});

describe('not having looked yet is not evidence', () => {
  it('stays off on a fresh login, before the homes have arrived', () => {
    // The bug this fixes: an unread cache read as "no relay has ever been set
    // up", which engages with *no* delay — so a first cloud login flipped into
    // Local Mode instantly and blamed the user for not having a relay.
    const d = decideLocalMode(
      inputs({ homesLoaded: false, homes: [], anyRelayKnown: false }),
      EMPTY_MEMO,
    );
    expect(d.active).toBe(false);
    expect(d.reason).toBeNull();
  });

  it('still engages at once for an account that genuinely has no relay', () => {
    // Same empty list, but we have actually looked. This case is meant to feel
    // instant and must not be caught by the guard above.
    const d = decideLocalMode(
      inputs({ homesLoaded: true, homes: [], anyRelayKnown: false }),
      EMPTY_MEMO,
    );
    expect(d.active).toBe(true);
    expect(d.reason).toBe('no-relay-ever');
  });

  it('still serves a dead socket even with nothing loaded', () => {
    // A socket that is down IS evidence, and is the case Local Mode exists for.
    const d = decideLocalMode(
      inputs({ homesLoaded: false, homes: [], anyRelayKnown: false, socketState: 'disconnected' }),
      EMPTY_MEMO,
    );
    expect(d.active).toBe(true);
  });
});

describe('standing down when the premise turns out to be wrong', () => {
  it('drops immediately once a relay appears, rather than waiting out the anti-flap delay', () => {
    const engaged = decideLocalMode(
      inputs({ homesLoaded: true, homes: [], anyRelayKnown: false }),
      EMPTY_MEMO,
    );
    expect(engaged.active).toBe(true);
    expect(engaged.reason).toBe('no-relay-ever');

    // One tick later the homes arrive with a healthy relay. A relay appearing
    // where we thought there was none is the answer arriving, not a flap.
    const after = decideLocalMode(
      inputs({
        homesLoaded: true,
        homes: [{ id: LIVE, relayState: 'connected' }],
        anyRelayKnown: true,
        now: 1000,
      }),
      engaged.memo,
    );
    expect(after.active).toBe(false);
  });

  it('keeps the slow disengage for a relay that merely dropped out', () => {
    // This one IS flap protection, and must not be shortened by the change above.
    const engaged = decideLocalMode(
      inputs({ now: ENGAGE_AFTER_MS }),
      { active: false, pendingSince: 0 },
    );
    expect(engaged.active).toBe(true);
    expect(engaged.reason).toBe('relay-offline');

    const soonAfter = decideLocalMode(
      inputs({ homes: [{ id: LIVE, relayState: 'connected' }], now: ENGAGE_AFTER_MS + 1000 }),
      engaged.memo,
    );
    expect(soonAfter.active).toBe(true);

    // The disengage clock starts when `wants` goes false — at soonAfter — not
    // when it engaged.
    const wellAfter = decideLocalMode(
      inputs({
        homes: [{ id: LIVE, relayState: 'connected' }],
        now: ENGAGE_AFTER_MS + 1000 + DISENGAGE_AFTER_MS + 1,
      }),
      soonAfter.memo,
    );
    expect(wellAfter.active).toBe(false);
  });
});
