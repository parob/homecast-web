import { describe, it, expect } from 'vitest';
import {
  connectionPresentation, formatRtt, warnsUser, RECONNECTED_PRESENTATION,
} from '../connection-presentation';
import type { ConnectionQuality } from '@/server/connection-quality';

const ALL: ConnectionQuality[] = ['good', 'unknown', 'connecting', 'slow', 'stalled', 'offline'];

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

  it('moves only where something is happening or wrong', () => {
    const pulsing = ALL.filter(q => connectionPresentation(q).pulse);
    expect(pulsing).toEqual(['connecting', 'stalled']);
  });

  it('keeps "Connecting…" neutral rather than alarming', () => {
    // Carries the old toast's wording, and its stance: that toast was
    // deliberately not a warning, because a drop is nearly always transient
    // and alarm colours asked the user to act on something they cannot.
    const c = connectionPresentation('connecting');
    expect(c.label).toBe('Connecting…');
    expect(c.dotClass).not.toMatch(/amber|red/);
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

describe('warnsUser', () => {
  it('is exactly the set of states that show the user a label', () => {
    // The old toast confirmed a recovery only if it had shown the warning.
    // Deriving this from the label rather than a second list is what stops the
    // two drifting apart.
    for (const q of ALL) {
      expect(warnsUser(q)).toBe(connectionPresentation(q).label !== null);
    }
    expect(warnsUser('connecting')).toBe(true);
    expect(warnsUser('offline')).toBe(true);
    expect(warnsUser('good')).toBe(false);
    expect(warnsUser('unknown')).toBe(false);
  });
});

describe('RECONNECTED_PRESENTATION', () => {
  it('says it plainly and does not draw attention to itself', () => {
    expect(RECONNECTED_PRESENTATION.label).toBe('Reconnected');
    expect(RECONNECTED_PRESENTATION.pulse).toBe(false);
  });
});
