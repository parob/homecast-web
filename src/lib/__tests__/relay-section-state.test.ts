// The Relay Status section, as a fold over the serving facts. The table at
// the bottom is the section's rows of invariant 4 (homecast-cloud#102).

import { describe, expect, it } from 'vitest';
import { relaySectionState, type RelaySectionInput } from '../relay-section-state';
import type { HomeServing } from '@/server/home-serving';

const ME = 'mac_d6de42ce';
const MINI = 'mac_8ca2d5a2';
const CLOUD = 'mac_managed01';
const NOW = Date.parse('2026-09-08T11:33:02Z');

const served = (by: string | null, kind: HomeServing['kind'] = 'self_hosted'): HomeServing =>
  ({ state: 'served', by, kind, since: null, graceEndsAt: null });
const not = (state: 'waiting' | 'reconnecting' | 'offline', graceEndsAt: string | null = null): HomeServing =>
  ({ state, by: null, kind: null, since: null, graceEndsAt });

const GEORGE = { id: 'A1', name: 'George Street', isCloudManaged: true };
const COUNTY = { id: 'B2', name: 'County Hall', isCloudManaged: true };
const COTTAGE = { id: 'C3', name: 'Cottage', isCloudManaged: false };

function at(over: Partial<RelaySectionInput> & { facts?: Record<string, HomeServing | null> } = {}) {
  const { facts = {}, ...rest } = over;
  return relaySectionState({
    connectionState: 'connected',
    community: false,
    homes: [GEORGE, COTTAGE],
    serving: (id) => facts[id] ?? null,
    thisDevice: ME,
    now: NOW,
    ...rest,
  });
}

describe('relaySectionState', () => {
  it('is always active in Community mode, whatever the socket says', () => {
    expect(at({ community: true, connectionState: 'disconnected' }).state).toBe('connected_active');
  });

  it('reports the socket first when it is not connected', () => {
    for (const s of ['connecting', 'reconnecting', 'disconnected'] as const) {
      expect(at({ connectionState: s }).state).toBe(s);
    }
  });

  it('is active when this Mac serves its own home', () => {
    expect(at({ facts: { C3: served(ME) } }).state).toBe('connected_active');
  });

  it('is standby, with the takeover on offer, when another Mac serves the own homes', () => {
    const v = at({ facts: { C3: served(MINI) } });
    expect(v.state).toBe('connected_standby');
    expect(v.homeNames).toEqual(['Cottage']);
  });

  it('is cloud standby while the cloud relay serves the cloud-managed home', () => {
    expect(at({ homes: [GEORGE], facts: { A1: served(CLOUD, 'cloud') } }).state).toBe('connected_cloud_standby');
  });

  it('is cloud standby on an older server that has no fact to give', () => {
    expect(at({ homes: [GEORGE] }).state).toBe('connected_cloud_standby');
  });

  it('counts down the takeover during the grace', () => {
    const v = at({ homes: [GEORGE, COUNTY], facts: { A1: not('waiting', '2026-09-08T11:36:02Z'), B2: served(CLOUD, 'cloud') } });
    expect(v.state).toBe('connected_cloud_waiting');
    expect(v.homeNames).toEqual(['George Street']);
    expect(v.takeover).toBe('in 3 min');
  });

  it('counts down to the earliest grace when several are waiting', () => {
    const v = at({ homes: [GEORGE, COUNTY], facts: { A1: not('waiting', '2026-09-08T11:36:02Z'), B2: not('waiting', '2026-09-08T11:33:40Z') } });
    expect(v.takeover).toBe('in 38s');
    expect(v.homeNames).toEqual(['George Street', 'County Hall']);
  });

  it('says standby active once this Mac holds a cloud-managed home', () => {
    const v = at({ homes: [GEORGE, COUNTY], facts: { A1: served(ME), B2: not('waiting', '2026-09-08T11:36:02Z') } });
    expect(v.state).toBe('connected_cloud_serving');
    expect(v.homeNames).toEqual(['George Street']);
  });

  it('says so when the cloud relay is gone and this Mac is not in line', () => {
    const v = at({ homes: [GEORGE], facts: { A1: not('offline') } });
    expect(v.state).toBe('connected_cloud_offline');
    expect(v.homeNames).toEqual(['George Street']);
  });

  it('lets a self-hosted standby outrank a healthy cloud standby', () => {
    // This Mac should be serving Cottage and is not — that is the thing to
    // say, whatever the cloud relay is doing for George Street.
    const v = at({ facts: { A1: served(CLOUD, 'cloud'), C3: served(MINI) } });
    expect(v.state).toBe('connected_standby');
  });

  it('is active when this Mac serves any own home, even with a cloud home on standby', () => {
    expect(at({ facts: { A1: served(CLOUD, 'cloud'), C3: served(ME) } }).state).toBe('connected_active');
  });

  it('is active when it knows nothing at all', () => {
    expect(at({ homes: [] }).state).toBe('connected_active');
  });
});

// The section's rows of invariant 4: one cloud-managed home, every state the
// server can report, and whether it is this Mac.
describe('one cloud-managed home, by server state (invariant 4)', () => {
  const rows: Array<[string, HomeServing | null, string]> = [
    ['served by the cloud relay', served(CLOUD, 'cloud'), 'connected_cloud_standby'],
    ['served by this Mac',        served(ME),             'connected_cloud_serving'],
    ['waiting',                   not('waiting', '2026-09-08T11:36:02Z'), 'connected_cloud_waiting'],
    ['reconnecting',              not('reconnecting'),    'connected_cloud_offline'],
    ['offline',                   not('offline'),         'connected_cloud_offline'],
    ['unknown',                   null,                   'connected_cloud_standby'],
  ];
  it.each(rows)('%s → %s', (_name, fact, state) => {
    expect(at({ homes: [GEORGE], facts: { A1: fact } }).state).toBe(state);
  });
});
