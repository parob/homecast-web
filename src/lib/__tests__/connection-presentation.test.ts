import { describe, it, expect } from 'vitest';
import { connectionPresentation, formatRtt } from '../connection-presentation';
import type { ConnectionQuality } from '@/server/connection-quality';

const ALL: ConnectionQuality[] = ['good', 'unknown', 'slow', 'stalled', 'offline'];

describe('connectionPresentation', () => {
  it('gives the healthy state nothing to notice', () => {
    // The indicator is always present, so the good state has to cost nothing
    // to ignore — otherwise it becomes the noise it exists to cut through.
    const good = connectionPresentation('good');
    expect(good.label).toBeNull();
    expect(good.pulse).toBe(false);
  });

  it('does not dress unknown as a fault', () => {
    // A backgrounded tab suspends the heartbeat, so `unknown` happens on every
    // resume. Painting it amber would cry wolf every single time.
    const unknown = connectionPresentation('unknown');
    expect(unknown.label).toBeNull();
    expect(unknown.pulse).toBe(false);
    expect(unknown.dotClass).not.toMatch(/amber|red/);
  });

  it('labels every state that is actually wrong', () => {
    for (const q of ['slow', 'stalled', 'offline'] as const) {
      expect(connectionPresentation(q).label).toBeTruthy();
    }
  });

  it('moves only for a state that is actively wrong', () => {
    const pulsing = ALL.filter(q => connectionPresentation(q).pulse);
    expect(pulsing).toEqual(['stalled']);
  });

  it('always has something for a screen reader, even with no visible label', () => {
    for (const q of ALL) {
      const p = connectionPresentation(q);
      expect(p.srLabel.length).toBeGreaterThan(0);
      expect(p.headline.length).toBeGreaterThan(0);
    }
  });

  it('falls back rather than rendering blank on an unrecognised state', () => {
    expect(connectionPresentation('nonsense' as ConnectionQuality).srLabel)
      .toBe(connectionPresentation('unknown').srLabel);
  });
});

describe('formatRtt', () => {
  it('is null when nothing has been measured', () => {
    // So the caller says "Checking…" instead of a confident "0ms".
    expect(formatRtt(null)).toBeNull();
    expect(formatRtt(undefined)).toBeNull();
    expect(formatRtt(NaN)).toBeNull();
    expect(formatRtt(-1)).toBeNull();
  });

  it('reads in ms below a second and in seconds above', () => {
    expect(formatRtt(0)).toBe('0ms');
    expect(formatRtt(42.4)).toBe('42ms');
    expect(formatRtt(999)).toBe('999ms');
    expect(formatRtt(1000)).toBe('1.0s');
    expect(formatRtt(4200)).toBe('4.2s');
  });
});
