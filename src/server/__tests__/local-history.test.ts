/**
 * The CE history recorder against a REAL IndexedDB (fake-indexeddb).
 *
 * Covers the storage path end-to-end: opt-in gating, policy-driven recording,
 * lazy series creation, batch flushing, hourly/daily rollup materialisation,
 * watermark discipline (never prune what isn't rolled), retention, and the
 * cascade deletes the privacy story depends on.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// See automations-community-e2e.test.ts: openDB's success handler touches
// navigator.storage; Node < 21 has no global navigator.
vi.hoisted(() => {
  delete (globalThis as { navigator?: unknown }).navigator;
});

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';

// lib/config dereferences `window` at module load; there is none under node.
vi.mock('../../lib/config', () => ({ isCommunity: true }));

import * as db from '../local-db';
import {
  recordHistoryEvent,
  flushHistoryBuffer,
  runHistoryMaintenance,
  setHistoryHomeConfig,
  setHistorySeriesOverride,
  reloadHistoryConfig,
  resetHistoryRuntimeForTest,
} from '../local-history';
import { seriesKey } from '@/history/keys';
import { HOUR_MS, DAY_MS } from '@/history/rollup';

const HOME = 'HOME-AAAA';
const ACC = 'ACC-1111';

// A fixed "now" keeps every bucket boundary deterministic: 03:30 UTC.
const T0 = Math.floor(Date.parse('2026-08-10T00:00:00Z') / DAY_MS) * DAY_MS;
const NOW = T0 + 3 * HOUR_MS + 30 * 60_000;

async function resetDb(): Promise<void> {
  await db.closeDB();
  indexedDB = new IDBFactory();
  resetHistoryRuntimeForTest();
  await reloadHistoryConfig();
}

beforeEach(async () => {
  await resetDb();
});

describe('recording gate', () => {
  it('records nothing until the home opts in', async () => {
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20.5, 0, NOW);
    await flushHistoryBuffer();
    expect(await db.getHistorySeries()).toHaveLength(0);

    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20.5, 0, NOW);
    await flushHistoryBuffer();

    const series = await db.getHistorySeries(HOME);
    expect(series).toHaveLength(1);
    expect(series[0]).toMatchObject({
      id: seriesKey(HOME, ACC, 'current_temperature'),
      kind: 'numeric',
      unit: '°',
      homeId: HOME,
      accessoryId: ACC,
    });
  });

  it('applies the policy: dedupe, deadband, canonical keys', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });

    // `on` and `power_state` are the same series; repeats dedupe away.
    recordHistoryEvent(HOME, ACC, 'on', true, 0, NOW);
    recordHistoryEvent(HOME, ACC, 'power_state', true, 0, NOW + 1000);
    recordHistoryEvent(HOME, ACC, 'power_state', false, 0, NOW + 2000);
    await flushHistoryBuffer();

    const sid = seriesKey(HOME, ACC, 'power_state');
    const samples = await db.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER);
    expect(samples.map(s => s.v)).toEqual([1, 0]);
    expect(await db.getHistorySeries()).toHaveLength(1);
  });

  it('honours per-series overrides', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    await setHistorySeriesOverride(HOME, ACC, 'current_temperature', { enabled: false });

    recordHistoryEvent(HOME, ACC, 'current_temperature', 21, 0, NOW);
    await flushHistoryBuffer();
    const sid = seriesKey(HOME, ACC, 'current_temperature');
    expect(await db.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);

    // Overrides survive a cache reload (they live on the series row).
    await reloadHistoryConfig();
    recordHistoryEvent(HOME, ACC, 'current_temperature', 25, 0, NOW + 120_000);
    await flushHistoryBuffer();
    expect(await db.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
  });

  it('separates same-millisecond samples instead of overwriting', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    recordHistoryEvent(HOME, ACC, 'motion_detected', true, 0, NOW);
    recordHistoryEvent(HOME, ACC, 'motion_detected', false, 0, NOW);
    await flushHistoryBuffer();
    const sid = seriesKey(HOME, ACC, 'motion_detected');
    const samples = await db.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER);
    expect(samples.map(s => [s.ts, s.v])).toEqual([[NOW, 1], [NOW + 1, 0]]);
  });
});

describe('maintenance: rollups, watermarks, retention', () => {
  async function seedTempSamples(): Promise<string> {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    // Hour 0: 20°, stepping to 22° at 00:30. Hour 1: 24° at 01:00. Hour 2: silent.
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0);
    recordHistoryEvent(HOME, ACC, 'current_temperature', 22, 0, T0 + 30 * 60_000);
    recordHistoryEvent(HOME, ACC, 'current_temperature', 24, 0, T0 + HOUR_MS);
    await flushHistoryBuffer();
    return seriesKey(HOME, ACC, 'current_temperature');
  }

  it('materialises hourly rollups for closed hours and stays idempotent', async () => {
    const sid = await seedTempSamples();
    await runHistoryMaintenance(NOW);

    const hourly = await db.getHistoryRollups(sid, 'h', 0, Number.MAX_SAFE_INTEGER);
    // Hours 0 and 1 have samples; hour 2 is sparse (no row).
    expect(hourly.map(r => r.bucket)).toEqual([T0, T0 + HOUR_MS]);
    expect(hourly[0].vAvg).toBeCloseTo(21); // half 20°, half 22°
    expect(hourly[0].vMin).toBe(20);
    expect(hourly[0].vMax).toBe(22);
    expect(hourly[1].vAvg).toBeCloseTo(24);
    expect(hourly[1].vLast).toBe(24);

    // Second run: nothing new to roll, rows unchanged.
    await runHistoryMaintenance(NOW);
    const again = await db.getHistoryRollups(sid, 'h', 0, Number.MAX_SAFE_INTEGER);
    expect(again).toEqual(hourly);
  });

  it('derives daily rollups from hourly once the UTC day closes', async () => {
    const sid = await seedTempSamples();
    // Run maintenance the next day, so day T0 is closed.
    const nextDay = T0 + DAY_MS + HOUR_MS;
    await runHistoryMaintenance(nextDay);

    const daily = await db.getHistoryRollups(sid, 'd', 0, Number.MAX_SAFE_INTEGER);
    expect(daily).toHaveLength(1);
    expect(daily[0].bucket).toBe(T0);
    // 30 min @20°, 30 min @22°, 23 h @24° (LOCF through the silent hours).
    const expectedAvg = (0.5 * 20 + 0.5 * 22 + 23 * 24) / 24;
    expect(daily[0].vAvg).toBeCloseTo(expectedAvg, 5);
    expect(daily[0].vMin).toBe(20);
    expect(daily[0].vMax).toBe(24);
  });

  it('keeps raw samples indefinitely — rollups summarise, nothing prunes', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 0 });
    const sid = seriesKey(HOME, ACC, 'current_temperature');
    const old = NOW - 400 * DAY_MS; // over a year old
    recordHistoryEvent(HOME, ACC, 'current_temperature', 18, 0, old);
    recordHistoryEvent(HOME, ACC, 'current_temperature', 21, 0, NOW - 60_000);
    await flushHistoryBuffer();

    await runHistoryMaintenance(NOW);

    const samples = await db.getHistorySamples(sid, 0, Number.MAX_SAFE_INTEGER);
    expect(samples.map(s => s.v)).toEqual([18, 21]);
    // The year-old sample was still rolled up (watermark falls back to the
    // oldest sample), and remains in raw too.
    const hourly = await db.getHistoryRollups(sid, 'h', 0, Number.MAX_SAFE_INTEGER);
    expect(hourly[0].vLast).toBe(18);
  });
});

describe('cascade deletes', () => {
  it('removes a series with its samples and rollups', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0);
    recordHistoryEvent(HOME, ACC, 'relative_humidity', 50, 0, T0);
    await flushHistoryBuffer();
    await runHistoryMaintenance(NOW);

    const tempSid = seriesKey(HOME, ACC, 'current_temperature');
    await db.deleteHistorySeries(tempSid);

    expect(await db.getHistorySamples(tempSid, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    expect(await db.getHistoryRollups(tempSid, 'h', 0, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    // The other series is untouched.
    const humiditySid = seriesKey(HOME, ACC, 'relative_humidity');
    expect(await db.getHistorySamples(humiditySid, 0, Number.MAX_SAFE_INTEGER)).toHaveLength(1);
  });

  it('removes a whole home', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    await setHistoryHomeConfig('HOME-BBBB', { enabled: true, rawRetentionDays: 30 });
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0);
    recordHistoryEvent('HOME-BBBB', 'ACC-2222', 'current_temperature', 21, 0, T0);
    await flushHistoryBuffer();

    await db.deleteHistoryForHome(HOME);

    expect(await db.getHistorySeries(HOME)).toHaveLength(0);
    expect(await db.getHistorySeries('HOME-BBBB')).toHaveLength(1);
  });
});

describe('storage stats', () => {
  it('counts rows and finds the oldest sample', async () => {
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });
    recordHistoryEvent(HOME, ACC, 'current_temperature', 20, 0, T0);
    recordHistoryEvent(HOME, ACC, 'current_temperature', 21, 0, T0 + 120_000);
    await flushHistoryBuffer();

    const stats = await db.getHistoryStorageStats(HOME);
    expect(stats.seriesCount).toBe(1);
    expect(stats.sampleRows).toBe(2);
    expect(stats.oldestSampleTs).toBe(T0);
  });
});

describe('virtual accessory recording (community-automation tap)', () => {
  it('records profiled virtual characteristics and drops string-valued ones', async () => {
    const { VIRTUAL_CHARACTERISTIC } = await import('../../automation/types/automation');
    await setHistoryHomeConfig(HOME, { enabled: true, rawRetentionDays: 30 });

    // counter / input_number: numeric, minIntervalS 0 — every change records.
    recordHistoryEvent(HOME, 'VIRT-1', VIRTUAL_CHARACTERISTIC['counter'], 3, 0, NOW);
    recordHistoryEvent(HOME, 'VIRT-1', VIRTUAL_CHARACTERISTIC['counter'], 4, 0, NOW + 500);
    recordHistoryEvent(HOME, 'VIRT-2', VIRTUAL_CHARACTERISTIC['input_number'], 21.5, 0, NOW);
    // input_boolean rides power_state.
    recordHistoryEvent(HOME, 'VIRT-3', VIRTUAL_CHARACTERISTIC['input_boolean'], true, 0, NOW);
    // input_select → virtual_mode: no profile yet (string kind is P4), the
    // policy gate refuses — the map stays total, policy stays the arbiter.
    recordHistoryEvent(HOME, 'VIRT-4', VIRTUAL_CHARACTERISTIC['input_select'], 'Movie Night', 0, NOW);
    await flushHistoryBuffer();

    const series = await db.getHistorySeries(HOME);
    expect(series.map(s => s.characteristicType).sort()).toEqual(
      ['power_state', 'virtual_count', 'virtual_number'],
    );
    const count = series.find(s => s.characteristicType === 'virtual_count');
    const samples = await db.getHistorySamples(count!.id, 0, Number.MAX_SAFE_INTEGER);
    expect(samples.map(s => s.v)).toEqual([3, 4]);
  });
});
