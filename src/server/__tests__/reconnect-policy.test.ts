// The arithmetic behind a 103-second outage.
//
// A node drain took the pod out from under the relay's socket. Nothing failed:
// `1s × 1.5ⁿ` capped at 30s simply adds up to ~105s over ten attempts, and the
// replacement pod was ready long before the relay next looked. These tests pin
// the two properties that stop that happening again.

import { describe, it, expect } from 'vitest';
import {
  INITIAL_RECONNECT_DELAY,
  MAX_RECONNECT_DELAY,
  MAX_RELAY_RECONNECT_DELAY,
  nextReconnectDelay,
  resetsBackoff,
  jitter,
} from '../reconnect-policy';

/** Total time asleep across `attempts` retries, ignoring jitter. */
function outageSeconds(attempts: number, isRelay: boolean): number {
  let delay = INITIAL_RECONNECT_DELAY;
  let total = 0;
  for (let i = 0; i < attempts; i++) {
    total += delay;
    delay = nextReconnectDelay(delay, isRelay);
  }
  return total / 1000;
}

describe('backoff growth', () => {
  it('reproduces the outage that prompted this', () => {
    // The measured gap was 103s; ten browser-shaped attempts come to ~105s.
    expect(outageSeconds(10, false)).toBeGreaterThan(100);
  });

  it('keeps a relay reachable across the same ten attempts', () => {
    // Same failure, same number of attempts — the relay must not be the one
    // paying two minutes for it.
    expect(outageSeconds(10, true)).toBeLessThan(60);
  });

  it('caps a relay far below an ordinary client', () => {
    let delay = INITIAL_RECONNECT_DELAY;
    for (let i = 0; i < 40; i++) delay = nextReconnectDelay(delay, true);
    expect(delay).toBe(MAX_RELAY_RECONNECT_DELAY);
    expect(MAX_RELAY_RECONNECT_DELAY).toBeLessThan(MAX_RECONNECT_DELAY);
  });

  it('still backs off — this is not a retry storm', () => {
    // The point is a lower ceiling, not hammering a server that is down.
    expect(nextReconnectDelay(INITIAL_RECONNECT_DELAY, true))
      .toBeGreaterThan(INITIAL_RECONNECT_DELAY);
  });

  it('never exceeds its ceiling from any starting point', () => {
    expect(nextReconnectDelay(999_999, true)).toBe(MAX_RELAY_RECONNECT_DELAY);
    expect(nextReconnectDelay(999_999, false)).toBe(MAX_RECONNECT_DELAY);
  });
});

describe('resetsBackoff', () => {
  it('treats a draining server as an invitation to return', () => {
    // 1012 is what the pod sent during the drain we captured.
    expect(resetsBackoff(1012)).toBe(true);
    expect(resetsBackoff(1001)).toBe(true);
  });

  it('keeps backing off for everything else', () => {
    // A genuine failure still deserves patience.
    for (const code of [1006, 1011, 1008, 4001, 4002, 4003, undefined]) {
      expect(resetsBackoff(code)).toBe(false);
    }
  });
});

describe('jitter', () => {
  it('stays within ±20% and never goes negative', () => {
    for (const r of [0, 0.5, 1]) {
      const v = jitter(1000, () => r);
      expect(v).toBeGreaterThanOrEqual(800);
      expect(v).toBeLessThanOrEqual(1200);
    }
  });

  it('spreads a fleet rather than returning one value', () => {
    // Without this a whole fleet reconnects in lockstep after one restart.
    expect(jitter(1000, () => 0)).not.toBe(jitter(1000, () => 1));
  });
});
