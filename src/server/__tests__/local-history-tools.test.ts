/**
 * The agent/automation surfaces over history: the get_history helper (MCP
 * tool + GET /rest/history) and the ExportHistory CSV. Relay actions are
 * mocked; the history store is real (fake-indexeddb).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.hoisted(() => {
  delete (globalThis as { navigator?: unknown }).navigator;
});

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../../lib/config', () => ({ isCommunity: true }));
vi.mock('../connection', () => ({ communityRequest: vi.fn(), serverConnection: { emitBroadcast: vi.fn() } }));
vi.mock('@/relay/local-handler', () => ({
  executeHomeKitAction: vi.fn(async (action: string) => {
    if (action === 'homes.list') {
      return { homes: [{ id: 'HOME-AAAA', name: 'Beach House' }] };
    }
    if (action === 'accessories.list') {
      return {
        accessories: [{
          id: 'ACC-1111',
          name: 'Living Room Sensor',
          roomName: 'Living Room',
          services: [{
            serviceType: 'temperature_sensor',
            characteristics: [
              { characteristicType: 'current_temperature', value: 21, isWritable: false },
            ],
          }],
        }],
      };
    }
    return {};
  }),
  ErrorCode: {},
}));

import * as db from '../local-db';
import { handleGetHistory, handleQueryHistory, handleREST } from '../local-rest';
import { handleGraphQL } from '../local-graphql';
import {
  recordHistoryEvent,
  flushHistoryBuffer,
  runHistoryMaintenance,
  setHistoryHomeConfig,
  reloadHistoryConfig,
  resetHistoryRuntimeForTest,
} from '../local-history';

const HOME = 'HOME-AAAA';
const ACC = 'ACC-1111';

beforeEach(async () => {
  await db.closeDB();
  indexedDB = new IDBFactory();
  resetHistoryRuntimeForTest();
  await reloadHistoryConfig();
  await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });

  const now = Date.now();
  recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, now - 3 * 3_600_000);
  recordHistoryEvent(HOME, ACC, 'current_temperature', 22, 0, now - 2 * 3_600_000);
  recordHistoryEvent(HOME, ACC, 'current_temperature', 21, 0, now - 3_600_000);
  await flushHistoryBuffer();
});

describe('get_history (MCP/REST helper)', () => {
  it('finds the accessory by name and returns compact series', async () => {
    const result = await handleGetHistory({ accessory: 'living room', hours: 6 });
    expect(result.error).toBeUndefined();
    expect(result.accessory.name).toBe('Living Room Sensor');
    const temp = result.series.find((s: any) => s.characteristic === 'current_temperature');
    expect(temp.values).toHaveLength(3);
    expect(temp.summary).toMatchObject({ min: 20, max: 22, latest: 21 });
    expect(result._meta.message).toContain('recorded history');
  });

  it('explains itself when nothing matches', async () => {
    const result = await handleGetHistory({ accessory: 'nonexistent thing' });
    expect(result.error).toContain('No accessory matches');
  });

  it('serves over REST at /rest/history', async () => {
    const result = await handleREST({
      method: 'GET',
      path: '/rest/history?accessory=living&hours=6',
    } as any) as any;
    expect(result.accessory.id).toBe(ACC);
  });
});

describe('ExportHistory', () => {
  it('produces CSV with one row per raw sample', async () => {
    const res = (await handleGraphQL({
      operationName: 'ExportHistory',
      variables: { homeId: HOME },
    })) as { data: { exportHistory: string } };
    const lines = res.data.exportHistory.split('\n');
    expect(lines[0]).toBe('timestamp,accessory_id,characteristic,value,value_text,source');
    expect(lines).toHaveLength(4); // header + 3 samples
    expect(lines[1]).toContain('current_temperature');
    expect(lines[1]).toContain(',20,,0'); // empty value_text column for numeric kinds
  });

  it('filters by characteristic', async () => {
    const res = (await handleGraphQL({
      operationName: 'ExportHistory',
      variables: { homeId: HOME, characteristicType: 'power_state' },
    })) as { data: { exportHistory: string } };
    expect(res.data.exportHistory.split('\n')).toHaveLength(1); // header only
  });
});

describe('query_history (MCP bulk access)', () => {
  it('returns multiple series with filters over a date range', async () => {
    const now = Date.now();
    recordHistoryEvent(HOME, ACC, 'relative_humidity', 50, 0, now - 2 * 3_600_000);
    recordHistoryEvent(HOME, ACC, 'relative_humidity', 55, 0, now - 3_600_000);
    await flushHistoryBuffer();

    const all = await handleQueryHistory({
      start: new Date(now - 6 * 3_600_000).toISOString(),
      end: new Date(now).toISOString(),
    });
    expect(all.error).toBeUndefined();
    expect(all.series.length).toBe(2); // temperature (from beforeEach) + humidity
    expect(all._meta.series_matched).toBe(2);

    const filtered = await handleQueryHistory({
      characteristics: ['relative_humidity'],
      start: new Date(now - 6 * 3_600_000).toISOString(),
      end: new Date(now).toISOString(),
      resolution: 'raw',
    });
    expect(filtered.series).toHaveLength(1);
    expect(filtered.series[0].characteristic).toBe('relative_humidity');
    expect(filtered.series[0].values.map((v: any) => v[1])).toEqual([50, 55]);
    expect(filtered.series[0].room).toBe('Living Room');
  });

  it('serves explicit hourly resolution from rollups with full detail', async () => {
    const dayStart = Math.floor((Date.now() - 86_400_000) / 3_600_000) * 3_600_000;
    for (let h = 0; h < 6; h++) {
      recordHistoryEvent(HOME, ACC, 'power_state', h % 2 === 0, 0, dayStart + h * 3_600_000);
    }
    await flushHistoryBuffer();
    await runHistoryMaintenance(Date.now());

    const result = await handleQueryHistory({
      characteristics: ['power_state'],
      start: new Date(dayStart).toISOString(),
      end: new Date().toISOString(),
      resolution: 'hourly',
    });
    expect(result.series).toHaveLength(1);
    const buckets = result.series[0].buckets;
    expect(buckets.length).toBeGreaterThan(0);
    // [time, transitions, msInEachState]
    expect(typeof buckets[0][0]).toBe('string');
    expect(typeof buckets[0][1]).toBe('number');
    expect(typeof buckets[0][2]).toBe('object');
  });

  it('paginates large raw pulls via continue_from', async () => {
    const base = Date.now() - 3_600_000;
    for (let i = 0; i < 30; i++) {
      recordHistoryEvent(HOME, ACC, 'relative_humidity', 40 + (i % 20), 0, base + i * 90_000);
    }
    await flushHistoryBuffer();

    const first = await handleQueryHistory({
      characteristics: ['relative_humidity'],
      start: new Date(base - 1000).toISOString(),
      end: new Date().toISOString(),
      resolution: 'raw',
      max_points_per_series: 10,
    });
    const s1 = first.series[0];
    expect(s1.values).toHaveLength(10);
    expect(s1.continue_from).toBeDefined();
    expect(first._meta.truncated?.length).toBe(1);

    const second = await handleQueryHistory({
      characteristics: ['relative_humidity'],
      start: s1.continue_from,
      end: new Date().toISOString(),
      resolution: 'raw',
      max_points_per_series: 2000,
    });
    // No overlap, remainder returned.
    expect(second.series[0].values.length).toBeGreaterThan(0);
    expect(Date.parse(second.series[0].values[0][0])).toBeGreaterThan(Date.parse(s1.values[9][0]));
  });

  it('explains the opt-in when nothing is recorded', async () => {
    await db.closeDB();
    indexedDB = new IDBFactory();
    resetHistoryRuntimeForTest();
    await reloadHistoryConfig();
    const result = await handleQueryHistory({});
    expect(result.series).toEqual([]);
    expect(result._meta.message).toContain('opt-in');
  });
});
