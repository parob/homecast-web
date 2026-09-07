import { describe, expect, it } from 'vitest';
import { describeProbeReason, describeStatus } from '../uptime-copy';

describe('describeProbeReason', () => {
  it('turns every server code into a sentence, never the code itself', () => {
    const codes = [
      'probe_timeout (consecutive=1)',
      'probe_timeout (consecutive=3)',
      'no_probe_target',
      'accessory_error: unreachable',
      'accessory_error: read_error',
      'accessory_error: homekit_error',
      'probe_error: ValueError',
      'probe_error: TimeoutError',
    ];
    for (const code of codes) {
      const text = describeProbeReason(code);
      expect(text).toMatch(/^[A-Z].*\.$/);
      expect(text).not.toContain('_');
      expect(text).not.toContain('Error');
    }
  });

  it('says what the owner can act on', () => {
    expect(describeProbeReason('accessory_error: unreachable')).toContain('unreachable');
    expect(describeProbeReason('probe_timeout (consecutive=2)')).toContain('in time');
    expect(describeProbeReason('no_probe_target')).toContain('No accessory');
  });

  it('has an answer for nothing and for codes it has never seen', () => {
    expect(describeProbeReason(null)).toBe('The last check did not read a value.');
    expect(describeProbeReason(undefined)).toBe('The last check did not read a value.');
    expect(describeProbeReason('something_new')).toBe('The last check did not read a value.');
  });
});

describe('describeStatus', () => {
  it('names each status the server can report', () => {
    for (const status of ['verified', 'connected', 'degraded', 'offline']) {
      const { label, explanation } = describeStatus(status);
      expect(label.length).toBeGreaterThan(0);
      expect(explanation).toMatch(/\.$/);
    }
    expect(describeStatus('offline').label).toBe('Offline');
    expect(describeStatus('nonsense').label).toBe('Unknown');
  });

  it('does not blame the relay for a check that did not verify', () => {
    expect(describeStatus('connected').explanation).toContain('reachable');
    expect(describeStatus('connected').explanation).not.toContain('not fully verified');
  });
});
