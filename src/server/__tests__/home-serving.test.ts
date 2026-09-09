/**
 * The client half of one fact per home (homecast-cloud#102, #104).
 *
 * Invariant 5: a refusal refetches, once, and changes nothing. Plus the seed
 * rows of invariant 4 — `effectiveServing` as a table over the server's state
 * and this device's — and the two fallbacks that let the web ship in either
 * order relative to the server: an older server's fields, and no server at all.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseServing,
  synthesiseServing,
  composeServing,
  servedByThisDevice,
  ingestHomesList,
  ingestHomeServingPush,
  getHomeServing,
  effectiveServing,
  noteRefused,
  subscribeHomeServing,
  setThisDevice,
  setDeviceServing,
  setRefetch,
  resetHomeServing,
  type HomeServing,
} from '../home-serving';

const ME = 'mac_d6de42ce';
const MINI = 'mac_8ca2d5a2';

const served = (by = MINI, kind: HomeServing['kind'] = 'cloud'): HomeServing =>
  ({ state: 'served', by, kind, since: '2026-09-08T11:31:02Z', graceEndsAt: null });
const waiting = (): HomeServing =>
  ({ state: 'waiting', by: null, kind: null, since: '2026-09-08T11:31:02Z', graceEndsAt: '2026-09-08T11:36:02Z' });

beforeEach(() => resetHomeServing());

describe('parseServing', () => {
  it('reads the wire shape', () => {
    expect(parseServing({ state: 'waiting', by: null, kind: null, since: 'x', graceEndsAt: 'y' }))
      .toEqual({ state: 'waiting', by: null, kind: null, since: 'x', graceEndsAt: 'y' });
  });
  it('rejects anything that is not a fact', () => {
    expect(parseServing(null)).toBeNull();
    expect(parseServing({ state: 'green' })).toBeNull();
    expect(parseServing('served')).toBeNull();
  });
  it('drops a kind it does not know rather than inventing one', () => {
    expect(parseServing({ state: 'served', by: MINI, kind: 'quantum' })?.kind).toBeNull();
  });
});

describe('synthesiseServing — an older server', () => {
  it('connected is served', () => {
    expect(synthesiseServing({ relayState: 'connected', relayId: MINI, isCloudManaged: true }))
      .toMatchObject({ state: 'served', by: MINI, kind: 'cloud' });
  });
  it('reconnecting and offline pass through', () => {
    expect(synthesiseServing({ relayState: 'reconnecting' })?.state).toBe('reconnecting');
    expect(synthesiseServing({ relayState: 'offline' })?.state).toBe('offline');
  });
  it('the boolean alone still means something', () => {
    expect(synthesiseServing({ relayConnected: true })?.state).toBe('served');
    expect(synthesiseServing({ relayConnected: false })?.state).toBe('offline');
  });
  it('a bare answer says nothing, so the store is left alone', () => {
    expect(synthesiseServing({})).toBeNull();
  });
  it('cannot express waiting — that is the whole reason the server field exists', () => {
    // An old server reports a takeover grace as connected. Documented, not fixed here.
    expect(synthesiseServing({ relayState: 'connected' })?.state).toBe('served');
  });
});

describe('composeServing — invariant 4, the seed rows', () => {
  const rows: Array<[HomeServing | null, boolean, string]> = [
    [served(), false, 'served'],
    [waiting(), false, 'waiting'],
    [{ ...waiting(), state: 'reconnecting', graceEndsAt: null }, false, 'reconnecting'],
    [{ ...waiting(), state: 'offline', graceEndsAt: null }, false, 'offline'],
    [null, false, 'null'],
    [served(), true, 'served'],
    [waiting(), true, 'served'],
    [{ ...waiting(), state: 'offline', graceEndsAt: null }, true, 'served'],
    [null, true, 'served'],
  ];
  it.each(rows)('server=%j device.active=%s → %s', (home, active, expected) => {
    const out = composeServing(home, { active }, ME);
    expect(out?.state ?? 'null').toBe(expected);
    if (active) expect(out).toMatchObject({ by: ME, kind: 'local' });
  });
  it('local never claims a server kind', () => {
    expect(composeServing(served(MINI, 'cloud'), { active: true }, ME)?.kind).toBe('local');
  });
});

describe('servedByThisDevice', () => {
  it('is the relay-Mac question, asked of the fact', () => {
    expect(servedByThisDevice(served(ME, 'self_hosted'), ME)).toBe(true);
    expect(servedByThisDevice(served(MINI, 'cloud'), ME)).toBe(false);
    expect(servedByThisDevice(waiting(), ME)).toBe(false);
    expect(servedByThisDevice(null, ME)).toBe(false);
  });
});

describe('the store', () => {
  it('is fed by homes.list, preferring the server field', () => {
    ingestHomesList([{ id: 'd08cb174',
      relayState: 'connected', serving: waiting() }]);
    expect(getHomeServing('D08CB174')?.state).toBe('waiting');
  });
  it('falls back to the older fields when the server has none', () => {
    ingestHomesList([{ id: 'D08CB174',
      relayState: 'reconnecting' }]);
    expect(getHomeServing('D08CB174')?.state).toBe('reconnecting');
  });
  it('leaves a home alone on a bare answer', () => {
    ingestHomeServingPush({ homeId: 'D08CB174', serving: waiting() });
    ingestHomesList([{ id: 'D08CB174' }]);
    expect(getHomeServing('D08CB174')?.state).toBe('waiting');
  });
  it('is fed by the push', () => {
    ingestHomeServingPush({ homeId: 'D08CB174', serving: served() });
    expect(getHomeServing('D08CB174')).toEqual(served());
  });
  it('ignores a push that is not a fact', () => {
    ingestHomeServingPush({ homeId: 'D08CB174', serving: { state: 'green' } });
    ingestHomeServingPush({ serving: served() });
    expect(getHomeServing('D08CB174')).toBeNull();
  });
  it('notifies on change and only on change', () => {
    const seen: string[] = [];
    subscribeHomeServing((id, s) => seen.push(`${id}:${s?.state}`));
    ingestHomeServingPush({ homeId: 'D08CB174', serving: served() });
    ingestHomeServingPush({ homeId: 'D08CB174', serving: served() });
    ingestHomeServingPush({ homeId: 'D08CB174', serving: waiting() });
    expect(seen).toEqual(['D08CB174:served', 'D08CB174:waiting']);
  });
  it('seeds Community mode as served by this Mac, and nothing else ever writes it', () => {
    setThisDevice(ME);
    ingestHomesList([{ id: 'D08CB174' }], { community: true });
    expect(getHomeServing('D08CB174')).toMatchObject({ state: 'served', by: ME, kind: 'self_hosted' });
    expect(servedByThisDevice(effectiveServing('D08CB174'), ME)).toBe(true);
  });
});

describe('effectiveServing', () => {
  it('composes this device over the server', () => {
    setThisDevice(ME);
    ingestHomeServingPush({ homeId: 'D08CB174', serving: waiting() });
    expect(effectiveServing('D08CB174')?.state).toBe('waiting');
    setDeviceServing((id) => ({ active: id === 'D08CB174' }));
    expect(effectiveServing('D08CB174')).toMatchObject({ state: 'served', by: ME, kind: 'local' });
    expect(effectiveServing('OTHER')).toBeNull();
  });
});

describe('a refusal refetches, once, and changes nothing — invariant 5', () => {
  it('asks for a refetch when the store believed served', () => {
    const refetch = vi.fn();
    setRefetch(refetch);
    ingestHomeServingPush({ homeId: 'D08CB174', serving: served() });
    noteRefused('d08cb174');
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(refetch).toHaveBeenCalledWith('D08CB174');
    expect(getHomeServing('D08CB174')?.state).toBe('served');    // unchanged: a trigger, not a belief
  });
  it('asks only once until an answer lands', () => {
    const refetch = vi.fn();
    setRefetch(refetch);
    ingestHomeServingPush({ homeId: 'D08CB174', serving: served() });
    noteRefused('D08CB174');
    noteRefused('D08CB174');
    noteRefused('D08CB174');
    expect(refetch).toHaveBeenCalledTimes(1);
    ingestHomeServingPush({ homeId: 'D08CB174', serving: served() });   // the answer
    noteRefused('D08CB174');
    expect(refetch).toHaveBeenCalledTimes(2);
  });
  it('does nothing when the store already knew the home was not served', () => {
    const refetch = vi.fn();
    setRefetch(refetch);
    ingestHomeServingPush({ homeId: 'D08CB174', serving: waiting() });
    noteRefused('D08CB174');
    expect(refetch).not.toHaveBeenCalled();
  });
  it('does nothing for a home it has never heard of', () => {
    const refetch = vi.fn();
    setRefetch(refetch);
    noteRefused('D08CB174');
    expect(refetch).not.toHaveBeenCalled();
  });
});
