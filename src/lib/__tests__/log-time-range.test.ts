import { describe, expect, it } from 'vitest';
import {
  MAX_LOOKBACK_SECONDS,
  rangeAround,
  rangeFromDrag,
  rangeFromParams,
  rangeLabel,
  rangeToParams,
  resolveRange,
  zoomOut,
} from '../log-time-range';

const NOW = Date.parse('2026-08-19T12:00:00.000Z');

describe('resolveRange', () => {
  it('resolves a relative range against now', () => {
    const r = resolveRange({ kind: 'relative', seconds: 3600 }, NOW);
    expect(r.endMs).toBe(NOW);
    expect(r.startMs).toBe(NOW - 3_600_000);
    expect(r.startIso).toBe('2026-08-19T11:00:00.000Z');
  });

  it('clamps a relative range to the bucket retention', () => {
    // The _Default bucket keeps 30 days; a wider query can only scan more
    // partitions for rows that cannot exist.
    const r = resolveRange({ kind: 'relative', seconds: MAX_LOOKBACK_SECONDS * 10 }, NOW);
    expect(r.startMs).toBe(NOW - MAX_LOOKBACK_SECONDS * 1000);
  });

  it('normalises a reversed absolute range', () => {
    const r = resolveRange({ kind: 'absolute', startMs: NOW, endMs: NOW - 1000 });
    expect(r.startMs).toBe(NOW - 1000);
    expect(r.endMs).toBe(NOW);
  });
});

describe('rangeFromDrag', () => {
  it('builds an absolute range from a drag', () => {
    expect(rangeFromDrag(NOW, NOW + 60_000)).toEqual({
      kind: 'absolute', startMs: NOW, endMs: NOW + 60_000,
    });
  });

  it('normalises a right-to-left drag', () => {
    expect(rangeFromDrag(NOW + 60_000, NOW)?.startMs).toBe(NOW);
  });

  it('rejects a selection too narrow to be deliberate', () => {
    // Without this, an ordinary click on the chart becomes a zero-width range
    // and the page empties for no visible reason.
    expect(rangeFromDrag(NOW, NOW)).toBeNull();
    expect(rangeFromDrag(NOW, NOW + 10)).toBeNull();
  });
});

describe('zoomOut', () => {
  it('doubles a relative range', () => {
    expect(zoomOut({ kind: 'relative', seconds: 3600 })).toEqual({
      kind: 'relative', seconds: 7200,
    });
  });

  it('never zooms past retention', () => {
    expect(zoomOut({ kind: 'relative', seconds: MAX_LOOKBACK_SECONDS })).toEqual({
      kind: 'relative', seconds: MAX_LOOKBACK_SECONDS,
    });
  });

  it('widens an absolute range around its midpoint', () => {
    const out = zoomOut({ kind: 'absolute', startMs: NOW, endMs: NOW + 1000 }, 2, NOW);
    expect(out).toEqual({ kind: 'absolute', startMs: NOW - 500, endMs: NOW + 1500 });
  });
});

describe('rangeAround', () => {
  it('centres a window on a timestamp', () => {
    expect(rangeAround(NOW, 60_000)).toEqual({
      kind: 'absolute', startMs: NOW - 30_000, endMs: NOW + 30_000,
    });
  });
});

describe('URL round trip', () => {
  it('keeps a relative range relative so shared links stay live', () => {
    const params = rangeToParams({ kind: 'relative', seconds: 3600 });
    expect(params).toEqual({ range: '3600s' });
    expect(rangeFromParams(new URLSearchParams(params))).toEqual({
      kind: 'relative', seconds: 3600,
    });
  });

  it('pins an absolute range so a shared link shows what the sender saw', () => {
    const range = { kind: 'absolute' as const, startMs: NOW, endMs: NOW + 1000 };
    expect(rangeFromParams(new URLSearchParams(rangeToParams(range)))).toEqual(range);
  });

  it('prefers an absolute range when both are present', () => {
    const params = new URLSearchParams({ range: '3600s', from: String(NOW), to: String(NOW + 1) });
    expect(rangeFromParams(params)?.kind).toBe('absolute');
  });

  it('returns null for missing or malformed params', () => {
    expect(rangeFromParams(new URLSearchParams())).toBeNull();
    expect(rangeFromParams(new URLSearchParams({ range: 'soon' }))).toBeNull();
    expect(rangeFromParams(new URLSearchParams({ from: 'x', to: 'y' }))).toBeNull();
  });
});

describe('rangeLabel', () => {
  it('names a preset', () => {
    expect(rangeLabel({ kind: 'relative', seconds: 3600 })).toBe('Last 1h');
  });

  it('describes a non-preset relative range', () => {
    expect(rangeLabel({ kind: 'relative', seconds: 90 })).toBe('Last 2m');
  });
});
