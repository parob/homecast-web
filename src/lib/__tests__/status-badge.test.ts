// The case this whole merge exists for is the first test below: Local Mode
// active while the connection is offline. Those two co-occur *by design* —
// Local Mode engages because the cloud is unreachable — and the app used to
// render them as a red pill and a green pill sitting on the same row
// contradicting each other.

import { describe, it, expect } from 'vitest';
import { statusPresentation, type StatusInputs } from '../status-badge';
import { connectionPresentation, RECONNECTED_PRESENTATION } from '../connection-presentation';
import type { ConnectionQuality } from '@/server/connection-quality';

function inputs(over: Partial<StatusInputs> = {}): StatusInputs {
  return {
    quality: 'good',
    reconnected: false,
    localMode: { active: false, unmapped: false },
    relayStatus: null,
    ...over,
  };
}

describe('statusPresentation', () => {
  it('says Local Mode, not Offline, when both are true', () => {
    // The reason the merge was worth doing. "Offline" is not wrong, it is just
    // the less useful half of the truth: the home is working.
    const p = statusPresentation(inputs({
      quality: 'offline',
      localMode: { active: true, unmapped: false },
    }));
    expect(p.label).toBe('Local Mode');
    expect(p.dotClass).toContain('green');
  });

  it('does not paint a working home red', () => {
    const p = statusPresentation(inputs({
      quality: 'offline',
      localMode: { active: true, unmapped: false },
    }));
    expect(p.dotClass).not.toContain('red');
  });

  it('flags an unmapped Local Mode on the dot', () => {
    // The home works, but under Apple Home's names rather than the user's own.
    const p = statusPresentation(inputs({ localMode: { active: true, unmapped: true } }));
    expect(p.dotClass).toContain('amber');
    expect(p.label).toBe('Local Mode');
  });

  it('reports connection trouble when Local Mode has not taken over', () => {
    for (const q of ['offline', 'stalled', 'slow', 'connecting'] as const) {
      const p = statusPresentation(inputs({ quality: q }));
      expect(p).toEqual(connectionPresentation(q));
    }
  });

  it('stays a quiet dot when everything is fine', () => {
    const p = statusPresentation(inputs());
    expect(p.label).toBeNull();
    expect(p.pulse).toBe(false);
  });

  it('stays quiet on an active relay with a healthy connection', () => {
    // The standing "Relay" word is gone by design: when all is well the bubble
    // says nothing, and the popover still reports Active Relay.
    const p = statusPresentation(inputs({ relayStatus: true }));
    expect(p.label).toBeNull();
  });

  it('says Standby when another device is relaying', () => {
    const p = statusPresentation(inputs({ relayStatus: false }));
    expect(p.label).toBe('Standby');
  });

  it('lets connection trouble outrank standby', () => {
    // When you cannot reach anything, why beats who.
    const p = statusPresentation(inputs({ quality: 'offline', relayStatus: false }));
    expect(p.label).toBe('Offline');
  });

  it('confirms a recovery once nothing louder is happening', () => {
    const p = statusPresentation(inputs({ reconnected: true }));
    expect(p).toEqual(RECONNECTED_PRESENTATION);
  });

  it('does not confirm a recovery while still in trouble', () => {
    // "Reconnected" next to a broken connection would be a lie.
    const p = statusPresentation(inputs({ reconnected: true, quality: 'stalled' }));
    expect(p.label).toBe('Not responding');
  });

  it('does not confirm a recovery while Local Mode is carrying the home', () => {
    const p = statusPresentation(inputs({
      reconnected: true,
      localMode: { active: true, unmapped: false },
    }));
    expect(p.label).toBe('Local Mode');
  });

  it('always has something for a screen reader', () => {
    const qualities: ConnectionQuality[] = ['good', 'unknown', 'connecting', 'slow', 'stalled', 'offline'];
    for (const q of qualities) {
      for (const active of [false, true]) {
        for (const relayStatus of [null, true, false]) {
          const p = statusPresentation(inputs({
            quality: q,
            localMode: { active, unmapped: false },
            relayStatus,
          }));
          expect(p.srLabel.length).toBeGreaterThan(0);
          expect(p.headline.length).toBeGreaterThan(0);
        }
      }
    }
  });
});
