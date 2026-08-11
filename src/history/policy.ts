// The recording policy for characteristic history.
//
// One question, answered identically everywhere: "a characteristic just
// reported this value — does history record it?" The Community relay asks it
// in TypeScript (local-history.ts); the cloud server asks it in Python
// (homecast/history/policy.py). Both read the same profiles.json and both are
// run against the shared fixtures in __tests__/policy-cases.json, so the two
// runtimes cannot drift apart — a CE home and a cloud home given the same
// event stream store the same samples.
//
// The policy is an allow-list: a characteristic with no profile is never
// recorded, which is what keeps names, firmware revisions and the Eve
// history-protocol blobs out of storage by construction. A HomeKit-sourced
// type needs its CharacteristicMapper.swift entry before a profile can ever
// see events (the swift-mapper-pin test enforces the pairing).
//
// Measured context (production, 2026-08): relays report ~300 updates per
// accessory per day, dominated by bridge polls re-reporting unchanged sensor
// values. Everything here exists to keep the recorded stream proportional to
// what actually changed.

import profilesJson from './profiles.json';
import { canonicalHistoryType } from './keys';

export type HistoryKind = 'numeric' | 'bool' | 'enum' | 'string';

export interface CharacteristicProfile {
  kind: HistoryKind;
  /** Recorded by default once the home opts in. `false` = per-series opt-in. */
  record: boolean;
  /** Minimum seconds between recorded samples. 0 = every change. */
  minIntervalS: number;
  /** Absolute change required to record a numeric value. */
  deadband?: number;
  /** Percent-of-last-value change required — for wide-dynamic-range sensors (lux). */
  deadbandPct?: number;
  /** Display unit hint, matching the CHAR_UNITS convention. */
  unit?: string;
}

/** User override stored per series; every field falls back to the profile. */
export interface SeriesOverride {
  enabled?: boolean;
  minIntervalS?: number;
  deadband?: number;
}

/** What the recorder remembers between events. Compare against what was
 * RECORDED, never what was merely seen — otherwise a value drifting in small
 * steps under the deadband is never captured at all. */
export interface SeriesRecordState {
  lastRecordedValue: number;
  lastRecordedTsMs: number;
  /** string kind: the recorded text (lastRecordedValue is the 0 sentinel). */
  lastRecordedText?: string;
}

export type DropReason =
  | 'no-profile'
  | 'disabled'
  | 'unparsable'
  | 'unchanged'
  | 'throttled'
  | 'deadband';

export type RecordDecision =
  | { record: true; value: number; valueText?: string; state: SeriesRecordState }
  | { record: false; reason: DropReason };

const PROFILES: Record<string, CharacteristicProfile> =
  (profilesJson as { profiles: Record<string, CharacteristicProfile> }).profiles;

/** The profile for a characteristic type of any provenance (alias-safe). */
export function getProfile(characteristicType: string): CharacteristicProfile | undefined {
  return PROFILES[canonicalHistoryType(characteristicType)];
}

/** Every profiled type, canonical form. */
export function profiledTypes(): string[] {
  return Object.keys(PROFILES);
}

/**
 * Values arrive in every encoding the stack has ever used: booleans, numbers,
 * and their JSON/string forms ("true", "21.5", 1). Collapse them onto the one
 * numeric axis history stores: bool → 0/1, enum → its HomeKit code, numeric →
 * float. Returns null when no numeric reading exists.
 */
/**
 * The string kind's normalizer: trim, refuse empties. Numbers and booleans
 * stringify — a mode select fed 3 stores "3", which is at least honest.
 */
export function normalizeText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return null;
  const text = String(raw).trim();
  return text === '' ? null : text;
}

export function normalizeValue(kind: HistoryKind, raw: unknown): number | null {
  let value = raw;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === 'true') value = true;
    else if (trimmed === 'false') value = false;
    else if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) value = parsed;
      else return null;
    } else return null;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return kind === 'bool' ? (value === 0 ? 0 : 1) : value;
  }
  return null;
}

/**
 * The decision. Pure: state in, state out, no clock — the caller owns time,
 * which is what makes the fixtures replayable in both runtimes.
 */
export function evaluate(
  characteristicType: string,
  override: SeriesOverride | undefined,
  state: SeriesRecordState | undefined,
  rawValue: unknown,
  tsMs: number,
): RecordDecision {
  const profile = getProfile(characteristicType);
  if (!profile) return { record: false, reason: 'no-profile' };

  const enabled = override?.enabled ?? profile.record;
  if (!enabled) return { record: false, reason: 'disabled' };

  // string kind: dedupe by text equality, throttle as usual, no deadband.
  // The numeric slot carries a 0 sentinel so storage stays one shape.
  if (profile.kind === 'string') {
    const text = normalizeText(rawValue);
    if (text === null) return { record: false, reason: 'unparsable' };
    if (state === undefined) {
      return {
        record: true, value: 0, valueText: text,
        state: { lastRecordedValue: 0, lastRecordedTsMs: tsMs, lastRecordedText: text },
      };
    }
    if (text === state.lastRecordedText) return { record: false, reason: 'unchanged' };
    const stringMinIntervalS = override?.minIntervalS ?? profile.minIntervalS;
    if (stringMinIntervalS > 0 && tsMs - state.lastRecordedTsMs < stringMinIntervalS * 1000) {
      return { record: false, reason: 'throttled' };
    }
    return {
      record: true, value: 0, valueText: text,
      state: { lastRecordedValue: 0, lastRecordedTsMs: tsMs, lastRecordedText: text },
    };
  }

  const value = normalizeValue(profile.kind, rawValue);
  if (value === null) return { record: false, reason: 'unparsable' };

  // First sight of a series always records: it is the LOCF seed every later
  // query leans on.
  if (state === undefined) {
    return { record: true, value, state: { lastRecordedValue: value, lastRecordedTsMs: tsMs } };
  }

  if (value === state.lastRecordedValue) return { record: false, reason: 'unchanged' };

  const minIntervalS = override?.minIntervalS ?? profile.minIntervalS;
  if (minIntervalS > 0 && tsMs - state.lastRecordedTsMs < minIntervalS * 1000) {
    return { record: false, reason: 'throttled' };
  }

  if (profile.kind === 'numeric') {
    const absBand = override?.deadband ?? profile.deadband ?? 0;
    const pctBand = profile.deadbandPct
      ? (profile.deadbandPct / 100) * Math.abs(state.lastRecordedValue)
      : 0;
    const effectiveBand = Math.max(absBand, pctBand);
    if (Math.abs(value - state.lastRecordedValue) < effectiveBand) {
      return { record: false, reason: 'deadband' };
    }
  }

  return { record: true, value, state: { lastRecordedValue: value, lastRecordedTsMs: tsMs } };
}
