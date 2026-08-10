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
import { handleGetHistory, handleREST } from '../local-rest';
import { handleGraphQL } from '../local-graphql';
import {
  recordHistoryEvent,
  flushHistoryBuffer,
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
    expect(lines[0]).toBe('timestamp,accessory_id,characteristic,value,source');
    expect(lines).toHaveLength(4); // header + 3 samples
    expect(lines[1]).toContain('current_temperature');
    expect(lines[1]).toContain(',20,0');
  });

  it('filters by characteristic', async () => {
    const res = (await handleGraphQL({
      operationName: 'ExportHistory',
      variables: { homeId: HOME, characteristicType: 'power_state' },
    })) as { data: { exportHistory: string } };
    expect(res.data.exportHistory.split('\n')).toHaveLength(1); // header only
  });
});
