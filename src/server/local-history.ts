/**
 * Community mode: characteristic history recorder.
 *
 * The CE half of the history feature — the cloud server's recorder.py is the
 * other half, and both defer every should-this-record decision to the shared
 * policy engine (src/history/policy.ts + profiles.json), so a CE home and a
 * cloud home fed the same events store the same samples.
 *
 * Recording is opt-in per home and OFF by default: history is a privacy
 * feature first. When it is on, everything stays in IndexedDB on this Mac —
 * nothing leaves the home.
 *
 * Two sources feed the recorder, together covering every change:
 *
 *   - HomeKit.onEvent — changes observed from the home (Apple Home, physical
 *     devices, other bridges). Same subscription local-webhooks.ts uses.
 *   - relay-write announcements (community-automation.ts's publisher) —
 *     writes this relay performed (UI, LAN clients, REST/MCP, automations),
 *     which HomeKit's observer never re-reports. Announced post-success, so
 *     they are confirmed values, src=0 like everything else in CE.
 *
 * A device that echoes a relay write anyway produces a duplicate event; the
 * policy's dedupe drops it. Samples buffer in memory and land in one
 * IndexedDB transaction every few seconds — never a write per event.
 */

import * as db from './local-db';
import { HomeKit } from '../native/homekit-bridge';
import { isCommunity } from '../lib/config';
import { evaluate, getProfile, type SeriesOverride, type SeriesRecordState } from '../history/policy';
import { seriesKey, canonicalHistoryType, parseSeriesKey } from '../history/keys';
import { rollupBuckets, mergeBuckets, HOUR_MS, DAY_MS } from '../history/rollup';

// --- Per-home configuration (settings store) ---

export interface HistoryHomeConfig {
  enabled: boolean;
  /** Days of raw samples to keep. 0 = rollups-only (raw pruned once rolled). */
  rawRetentionDays: number;
}

export const DEFAULT_RAW_RETENTION_DAYS = 30;
const HOME_CONFIG_KEY = 'history:homes';
const HOUR_WATERMARK_KEY = 'history:rollup:watermark:h';
const DAY_WATERMARK_KEY = 'history:rollup:watermark:d';
const CAP_BYTES_KEY = 'history:cap:bytes';

/** Soft ceiling on origin storage before the raw window shrinks. */
export const DEFAULT_CAP_BYTES = 500 * 1024 * 1024;

const FLUSH_INTERVAL_MS = 10_000;
const FLUSH_BATCH_LIMIT = 100;
const MAINTENANCE_INTERVAL_MS = 15 * 60_000;

// --- In-memory state ---

let homeConfigs = new Map<string, HistoryHomeConfig>();
let seriesOverrides = new Map<string, SeriesOverride>();
const seriesStates = new Map<string, SeriesRecordState>();
const knownSeries = new Set<string>();
const lastTsPerSeries = new Map<string, number>();

let pendingSamples: db.HistorySampleRow[] = [];
let pendingNewSeries = new Map<string, db.HistorySeriesRow>();

let unsubscribe: (() => void) | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let maintenanceTimer: ReturnType<typeof setInterval> | null = null;
let initialized = false;

// --- Configuration API (used by the local GraphQL resolver / settings UI) ---

export async function getHistoryHomeConfigs(): Promise<Record<string, HistoryHomeConfig>> {
  const raw = await db.getSetting(HOME_CONFIG_KEY);
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, HistoryHomeConfig>;
  } catch {
    return {};
  }
}

export function getHistoryHomeConfig(homeId: string): HistoryHomeConfig | undefined {
  return homeConfigs.get(homeId.toUpperCase());
}

export async function setHistoryHomeConfig(homeId: string, config: HistoryHomeConfig): Promise<void> {
  const configs = await getHistoryHomeConfigs();
  configs[homeId.toUpperCase()] = config;
  await db.setSetting(HOME_CONFIG_KEY, JSON.stringify(configs));
  homeConfigs = new Map(Object.entries(configs).map(([k, v]) => [k.toUpperCase(), v]));
}

/** Upsert a per-series override and refresh the recorder's cache. */
export async function setHistorySeriesOverride(
  homeId: string,
  accessoryId: string,
  characteristicType: string,
  override: SeriesOverride,
): Promise<db.HistorySeriesRow | null> {
  const canonical = canonicalHistoryType(characteristicType);
  const profile = getProfile(canonical);
  if (!profile) return null;
  const sid = seriesKey(homeId, accessoryId, canonical);
  const existing = await db.getHistorySeriesById(sid);
  const row: db.HistorySeriesRow = existing ?? {
    id: sid,
    homeId: homeId.toUpperCase(),
    accessoryId: accessoryId.toUpperCase(),
    characteristicType: canonical,
    kind: profile.kind,
    unit: profile.unit,
    createdAt: new Date().toISOString(),
  };
  row.enabled = override.enabled;
  row.minIntervalS = override.minIntervalS;
  row.deadband = override.deadband;
  await db.putHistorySeries(row);
  knownSeries.add(sid);
  seriesOverrides.set(sid, override);
  return row;
}

/** Reload config caches from storage (after external writes). */
export async function reloadHistoryConfig(): Promise<void> {
  const configs = await getHistoryHomeConfigs();
  homeConfigs = new Map(Object.entries(configs).map(([k, v]) => [k.toUpperCase(), v]));

  const rows = await db.getHistorySeries();
  const overrides = new Map<string, SeriesOverride>();
  knownSeries.clear();
  for (const row of rows) {
    knownSeries.add(row.id);
    if (row.enabled !== undefined || row.minIntervalS !== undefined || row.deadband !== undefined) {
      overrides.set(row.id, {
        enabled: row.enabled,
        minIntervalS: row.minIntervalS,
        deadband: row.deadband,
      });
    }
  }
  seriesOverrides = overrides;
}

// --- Recording ---

/**
 * The single entry point for a candidate sample, from either source.
 * Synchronous by design: it runs on the hot path of every characteristic
 * event the relay sees, so it must cost a map lookup and a comparison when
 * the answer is no.
 */
export function recordHistoryEvent(
  homeId: string | undefined | null,
  accessoryId: string | undefined,
  characteristicType: string | undefined,
  value: unknown,
  src = 0,
  tsMs = Date.now(),
): void {
  if (!homeId || !accessoryId || !characteristicType) return;

  // The config cache is the gate: empty until reloadHistoryConfig() has run,
  // and a home records nothing unless the user opted it in.
  const config = homeConfigs.get(homeId.toUpperCase());
  if (!config?.enabled) return;

  const sid = seriesKey(homeId, accessoryId, characteristicType);
  const decision = evaluate(
    characteristicType,
    seriesOverrides.get(sid),
    seriesStates.get(sid),
    value,
    tsMs,
  );
  if (!decision.record) return;

  seriesStates.set(sid, decision.state);

  // Same-millisecond events on one series would collide on the [sid, ts] key.
  const lastTs = lastTsPerSeries.get(sid) ?? 0;
  const ts = tsMs > lastTs ? tsMs : lastTs + 1;
  lastTsPerSeries.set(sid, ts);

  pendingSamples.push({ sid, ts, v: decision.value, src });

  if (!knownSeries.has(sid) && !pendingNewSeries.has(sid)) {
    const canonical = canonicalHistoryType(characteristicType);
    const profile = getProfile(canonical)!;
    pendingNewSeries.set(sid, {
      id: sid,
      homeId: homeId.toUpperCase(),
      accessoryId: accessoryId.toUpperCase(),
      characteristicType: canonical,
      kind: profile.kind,
      unit: profile.unit,
      createdAt: new Date(tsMs).toISOString(),
    });
  }

  if (pendingSamples.length >= FLUSH_BATCH_LIMIT) {
    void flushHistoryBuffer();
  }
}

export async function flushHistoryBuffer(): Promise<void> {
  if (pendingSamples.length === 0 && pendingNewSeries.size === 0) return;
  const samples = pendingSamples;
  const newSeries = pendingNewSeries;
  pendingSamples = [];
  pendingNewSeries = new Map();
  try {
    await db.putHistoryBatch(samples, [...newSeries.values()]);
    for (const sid of newSeries.keys()) knownSeries.add(sid);
  } catch (e) {
    // Storage failure loses this batch; recording continues. Never let
    // history writes throw into the event path that feeds them.
    console.warn(`[LocalHistory] Failed to flush ${samples.length} samples:`, e);
  }
}

// --- Rollup + retention maintenance ---

/**
 * Where the last maintenance pass got to. With no stored watermark (first run
 * ever, or a wiped settings store next to surviving samples) fall back to the
 * oldest raw sample so a backlog gets rolled rather than skipped — the relay
 * may have been closed mid-hour and reopened days later.
 */
async function getWatermark(key: string, alignMs: number, fallback: number): Promise<number> {
  const raw = await db.getSetting(key);
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  const stats = await db.getHistoryStorageStats();
  if (stats.oldestSampleTs !== null) {
    return Math.floor(stats.oldestSampleTs / alignMs) * alignMs;
  }
  return fallback;
}

/**
 * Materialise hourly rollups for every closed hour, daily rollups for every
 * closed UTC day, then prune raw samples past retention. Eager rollups keep
 * queries single-tier; pruning never outruns the hour watermark, so no
 * sample is deleted before it has been rolled.
 */
export async function runHistoryMaintenance(now = Date.now()): Promise<void> {
  await flushHistoryBuffer();

  const hourTarget = Math.floor(now / HOUR_MS) * HOUR_MS;
  const dayTarget = Math.floor(now / DAY_MS) * DAY_MS;
  const allSeries = await db.getHistorySeries();

  // Hourly: [watermark, start of current hour)
  const hourWatermark = await getWatermark(HOUR_WATERMARK_KEY, HOUR_MS, hourTarget - HOUR_MS);
  let hourlyClean = true;
  if (hourWatermark < hourTarget) {
    for (const series of allSeries) {
      try {
        const samples = await db.getHistorySamples(series.id, hourWatermark, hourTarget);
        if (samples.length === 0) continue;
        const carry = await db.getLastHistorySampleBefore(series.id, hourWatermark);
        const buckets = rollupBuckets(
          series.kind, samples.map(s => ({ ts: s.ts, v: s.v })),
          carry?.v ?? null, HOUR_MS, hourWatermark, hourTarget,
        );
        await db.putHistoryRollups(buckets.map(b => ({
          sid: series.id, tier: 'h' as const, bucket: b.bucket,
          vMin: b.vMin, vMax: b.vMax, vAvg: b.vAvg, vLast: b.vLast,
          count: b.count, stateMs: b.stateMs, transitions: b.transitions,
        })));
      } catch (e) {
        // Rollup puts are idempotent, so re-rolling this window next pass is
        // safe — but the watermark must not advance past unrolled samples:
        // pruning trusts it, and pruning is permanent.
        hourlyClean = false;
        console.warn(`[LocalHistory] Hourly rollup failed for ${series.id}:`, e);
      }
    }
    if (hourlyClean) await db.setSetting(HOUR_WATERMARK_KEY, String(hourTarget));
  }

  // Daily: derived from hourly rows, [watermark, start of current UTC day)
  const dayWatermark = await getWatermark(DAY_WATERMARK_KEY, DAY_MS, dayTarget - DAY_MS);
  if (dayWatermark < dayTarget) {
    for (const series of allSeries) {
      try {
        const hourly = await db.getHistoryRollups(series.id, 'h', dayWatermark, dayTarget);
        if (hourly.length === 0) continue;
        const carry = await db.getLastHistoryRollupBefore(series.id, 'h', dayWatermark);
        const days = mergeBuckets(
          series.kind, hourly, carry ?? null, HOUR_MS, DAY_MS, dayWatermark, dayTarget,
        );
        await db.putHistoryRollups(days.map(b => ({
          sid: series.id, tier: 'd' as const, bucket: b.bucket,
          vMin: b.vMin, vMax: b.vMax, vAvg: b.vAvg, vLast: b.vLast,
          count: b.count, stateMs: b.stateMs, transitions: b.transitions,
        })));
      } catch (e) {
        console.warn(`[LocalHistory] Daily rollup failed for ${series.id}:`, e);
      }
    }
    await db.setSetting(DAY_WATERMARK_KEY, String(dayTarget));
  }

  // Retention: per home, delete raw samples past the window — but never past
  // the hour watermark (rollups must have consumed them first).
  const rolledThrough = hourlyClean && hourWatermark < hourTarget ? hourTarget : hourWatermark;
  for (const series of allSeries) {
    const config = homeConfigs.get(series.homeId);
    if (!config?.enabled) continue;
    const retentionCutoff = config.rawRetentionDays > 0
      ? now - config.rawRetentionDays * DAY_MS
      : rolledThrough;
    const cutoff = Math.min(retentionCutoff, rolledThrough);
    try {
      await db.pruneHistorySamples(cutoff, series.id);
    } catch (e) {
      console.warn(`[LocalHistory] Prune failed for ${series.id}:`, e);
    }
  }

  await enforceStorageCap(rolledThrough);
}

/**
 * Emergency brake: if origin storage exceeds the cap, shrink the raw window
 * oldest-day-first (rollups are never touched — they are what "keep forever"
 * means). WKWebView origins share the app's container; a runaway history
 * store must not be the thing that fills the user's disk.
 */
async function enforceStorageCap(rolledThrough: number): Promise<void> {
  let capBytes = DEFAULT_CAP_BYTES;
  const configured = await db.getSetting(CAP_BYTES_KEY);
  if (configured && Number.isFinite(Number(configured))) capBytes = Number(configured);

  for (let i = 0; i < 10; i++) {
    let usage: number | undefined;
    try {
      if (typeof navigator === 'undefined') return;
      usage = (await navigator.storage?.estimate?.())?.usage;
    } catch {
      return;
    }
    if (usage === undefined || usage <= capBytes) return;

    const stats = await db.getHistoryStorageStats();
    if (stats.oldestSampleTs === null) return;
    const cutoff = Math.min(stats.oldestSampleTs + DAY_MS, rolledThrough);
    if (cutoff <= stats.oldestSampleTs) return;
    const deleted = await db.pruneHistorySamples(cutoff);
    console.warn(`[LocalHistory] Storage over cap (${Math.round(usage / 1e6)} MB) — pruned ${deleted} oldest samples`);
    if (deleted === 0) return;
  }
}

// --- Lifecycle ---

export function initLocalHistory(): void {
  if (!isCommunity) return;
  const w = window as Window & { isHomeKitRelayCapable?: boolean };
  if (!w.isHomeKitRelayCapable) return;
  if (initialized) return;

  console.log('[LocalHistory] Initializing history recorder');
  initialized = true;

  void reloadHistoryConfig().then(() => {
    unsubscribe = HomeKit.onEvent((event) => {
      if (event.type !== 'characteristic.updated') return;
      recordHistoryEvent(event.homeId, event.accessoryId, event.characteristicType, event.value, 0);
    });
  });

  flushTimer = setInterval(() => void flushHistoryBuffer(), FLUSH_INTERVAL_MS);
  maintenanceTimer = setInterval(() => void runHistoryMaintenance(), MAINTENANCE_INTERVAL_MS);
  // First maintenance pass shortly after startup — the relay may have been
  // off over a rollup boundary.
  setTimeout(() => void runHistoryMaintenance(), 60_000);
}

export function teardownLocalHistory(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  if (flushTimer) {
    clearInterval(flushTimer);
    flushTimer = null;
  }
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
  void flushHistoryBuffer();
  initialized = false;
  seriesStates.clear();
  lastTsPerSeries.clear();
}

/** Test seam. */
export function isHistoryInitialized(): boolean {
  return initialized;
}

/** Test seam: drop every piece of in-memory recorder state. */
export function resetHistoryRuntimeForTest(): void {
  seriesStates.clear();
  lastTsPerSeries.clear();
  knownSeries.clear();
  pendingSamples = [];
  pendingNewSeries = new Map();
  homeConfigs = new Map();
  seriesOverrides = new Map();
}

export { parseSeriesKey };
