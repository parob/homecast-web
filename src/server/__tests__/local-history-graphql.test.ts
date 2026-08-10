/**
 * The history GraphQL operations end-to-end through handleGraphQL — the same
 * entry point the in-process Apollo link and the LAN HTTP front-end use.
 * These shapes are the CE/cloud parity contract: the cloud server must answer
 * the same documents with the same shapes (its pytest suite mirrors this).
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.hoisted(() => {
  delete (globalThis as { navigator?: unknown }).navigator;
});

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

vi.mock('../../lib/config', () => ({ isCommunity: true }));
// The GraphQL module pulls the relay handler for unrelated cases; the history
// ops never touch HomeKit.
vi.mock('@/relay/local-handler', () => ({ executeHomeKitAction: vi.fn() }));
vi.mock('../connection', () => ({ communityRequest: vi.fn(), serverConnection: { emitBroadcast: vi.fn() } }));

import * as db from '../local-db';
import { handleGraphQL } from '../local-graphql';
import {
  recordHistoryEvent,
  flushHistoryBuffer,
  runHistoryMaintenance,
  reloadHistoryConfig,
  resetHistoryRuntimeForTest,
} from '../local-history';
import { DAY_MS, HOUR_MS } from '@/history/rollup';

const HOME = 'HOME-AAAA';
const ACC = 'ACC-1111';
const T0 = Math.floor(Date.parse('2026-08-10T00:00:00Z') / DAY_MS) * DAY_MS;

async function gql(operationName: string, variables: Record<string, unknown>) {
  const res = (await handleGraphQL({ operationName, variables })) as {
    data: Record<string, unknown> | null;
    errors?: Array<{ message: string }>;
  };
  expect(res.errors).toBeUndefined();
  return res.data!;
}

beforeEach(async () => {
  await db.closeDB();
  indexedDB = new IDBFactory();
  resetHistoryRuntimeForTest();
  await reloadHistoryConfig();
});

describe('history GraphQL operations', () => {
  it('opt-in → record → series listing → chart query → purge', async () => {
    // OFF by default: recording before opt-in stores nothing.
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0);
    await flushHistoryBuffer();

    await gql('SetHomeHistoryEnabled', { homeId: HOME, enabled: true });
    await reloadHistoryConfig();

    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0 + 60_000);
    recordHistoryEvent(HOME, ACC, 'current_temperature', 21, 0, T0 + 180_000);
    recordHistoryEvent(HOME, ACC, 'power_state', true, 0, T0 + 60_000);
    await flushHistoryBuffer();

    const series = await gql('GetHistorySeries', { homeId: HOME });
    const list = series.historySeries as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    const temp = list.find(s => s.characteristicType === 'current_temperature')!;
    expect(temp).toMatchObject({ kind: 'numeric', unit: '°', enabled: true, sampleCount: 2 });
    expect(temp.firstTs).toBe(T0 + 60_000);

    const history = await gql('GetHistory', {
      homeId: HOME,
      series: [
        { accessoryId: ACC, characteristicType: 'current_temperature' },
        { accessoryId: ACC, characteristicType: 'power_state' },
      ],
      fromTs: T0,
      toTs: T0 + HOUR_MS,
      maxPoints: 500,
    });
    const [tempData, powerData] = history.history as Array<Record<string, any>>;
    expect(tempData.resolution).toBe('raw');
    expect(tempData.points.map((p: any) => p.avg)).toEqual([20, 21]);
    expect(powerData.states.map((s: any) => s.value)).toEqual([1]);

    const stats = await gql('GetHistoryStorageStats', { homeId: HOME });
    expect(stats.historyStorageStats).toMatchObject({ enabled: true, seriesCount: 2, sampleRows: 3 });

    await gql('PurgeHistory', { homeId: HOME });
    const after = await gql('GetHistoryStorageStats', { homeId: HOME });
    expect(after.historyStorageStats).toMatchObject({ seriesCount: 0, sampleRows: 0 });
  });

  it('per-series config disables recording and survives reload', async () => {
    await gql('SetHomeHistoryEnabled', { homeId: HOME, enabled: true });
    await reloadHistoryConfig();

    await gql('SetHistorySeriesConfig', {
      homeId: HOME, accessoryId: ACC, characteristicType: 'current_temperature', enabled: false,
    });

    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0);
    await flushHistoryBuffer();

    const series = await gql('GetHistorySeries', { homeId: HOME });
    const temp = (series.historySeries as Array<Record<string, unknown>>)
      .find(s => s.characteristicType === 'current_temperature')!;
    expect(temp.enabled).toBe(false);
    expect(temp.sampleCount).toBe(0);
  });

  it('rejects unrecordable characteristics and oversized requests', async () => {
    const bad = (await handleGraphQL({
      operationName: 'SetHistorySeriesConfig',
      variables: { homeId: HOME, accessoryId: ACC, characteristicType: 'firmware_revision', enabled: true },
    })) as { errors?: Array<{ message: string }> };
    expect(bad.errors?.[0].message).toMatch(/not recordable/);

    const tooMany = (await handleGraphQL({
      operationName: 'GetHistory',
      variables: {
        homeId: HOME,
        series: Array.from({ length: 7 }, (_, i) => ({ accessoryId: `A${i}`, characteristicType: 'power_state' })),
        fromTs: T0, toTs: T0 + HOUR_MS,
      },
    })) as { errors?: Array<{ message: string }> };
    expect(tooMany.errors?.[0].message).toMatch(/1-6 series/);
  });

  it('serves rolled tiers through the wire shape', async () => {
    await gql('SetHomeHistoryEnabled', { homeId: HOME, enabled: true });
    await reloadHistoryConfig();

    for (let h = 0; h < 72; h++) {
      recordHistoryEvent(HOME, ACC, 'power_state', h % 2 === 0, 0, T0 + h * HOUR_MS);
    }
    await flushHistoryBuffer();
    const now = T0 + 72 * HOUR_MS;
    await runHistoryMaintenance(now);

    const history = await gql('GetHistory', {
      homeId: HOME,
      series: [{ accessoryId: ACC, characteristicType: 'power_state' }],
      fromTs: T0, toTs: now, maxPoints: 60,
    });
    const [data] = history.history as Array<Record<string, any>>;
    expect(data.resolution).toBe('hourly');
    expect(data.stateBuckets.length).toBeGreaterThan(0);
    const parsed = JSON.parse(data.stateBuckets[0].stateMsJson) as Record<string, number>;
    expect(Object.keys(parsed).length).toBeGreaterThan(0);
  });
});
