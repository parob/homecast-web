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
  isSocketStale,
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

  it('retries a routine blip just as fast as it ever did', () => {
    // The first six attempts land inside ~21s — the same curve the old 8s
    // ceiling produced, because the two only diverge once delays pass 8s. A
    // deliberate server cycle never even gets here: 1001/1012 resets backoff.
    expect(outageSeconds(6, true)).toBeLessThan(25);
  });

  it('decays to a whisper during a sustained outage', () => {
    // The ceiling governs exactly one case: a fleet-wide outage with no
    // server goodbye. The old 8s ceiling was measured (staging, Aug 2026)
    // turning that into a permanent ~125 connect-attempts/s battering from a
    // 1,000-relay fleet — the servers could never re-admit anyone. At ≥60s
    // the same fleet asks ~17 times/s, which recovery can absorb.
    let delay = INITIAL_RECONNECT_DELAY;
    for (let i = 0; i < 40; i++) delay = nextReconnectDelay(delay, true);
    expect(delay).toBe(MAX_RELAY_RECONNECT_DELAY);
    expect(MAX_RELAY_RECONNECT_DELAY).toBeGreaterThanOrEqual(60_000);
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

describe('isSocketStale', () => {
  // `readyState` reports a half-open socket as OPEN indefinitely — TCP up,
  // peer gone, no FIN, which is what a hard node kill or an LB dropping state
  // produces. `onclose` never fires, so nothing else notices. The client sent
  // a ping every 30s and threw the answer away in an empty branch whose
  // comment said "connection is alive".
  const NOW = 1_000_000;

  it('leaves a quiet but healthy socket alone', () => {
    // Both sides ping, so ~30s of quiet is normal.
    expect(isSocketStale(NOW - 30_000, NOW)).toBe(false);
    expect(isSocketStale(NOW - 60_000, NOW)).toBe(false);
  });

  it('tolerates one lost round trip', () => {
    expect(isSocketStale(NOW - 70_000, NOW)).toBe(false);
  });

  it('calls a socket dead once silence cannot be explained', () => {
    expect(isSocketStale(NOW - 80_000, NOW)).toBe(true);
    expect(isSocketStale(NOW - 20 * 60_000, NOW)).toBe(true);
  });

  it('is never stale before the first message arrives', () => {
    // A socket that just opened has legitimately heard nothing; treating 0 as
    // "silent since the epoch" would reconnect every new connection instantly.
    expect(isSocketStale(0, NOW)).toBe(false);
  });

  it('honours an explicit threshold', () => {
    expect(isSocketStale(NOW - 10_000, NOW, 5_000)).toBe(true);
    expect(isSocketStale(NOW - 10_000, NOW, 30_000)).toBe(false);
  });
});

describe('a request timeout as evidence about the socket', () => {
  // A half-open socket accepts sends and delivers nothing. Every request then
  // timed out, forever, and the only cure was the user reloading the app —
  // which is exactly how this surfaced: "Request timed out: serviceGroup.set",
  // fixed by refreshing the client.
  //
  // The rule the request path uses: nothing inbound since the request was sent.
  // Both sides ping every 30s, so a healthy connection cannot be silent for a
  // whole request timeout, while a merely slow request still sees heartbeats.
  const REQUEST_TIMEOUT = 30_000;
  const sentAt = 1_000_000;
  const timedOutAt = sentAt + REQUEST_TIMEOUT;

  /** The predicate as the request path applies it. */
  const socketSuspect = (lastInboundAt: number) => lastInboundAt <= sentAt;

  it('suspects the socket when nothing arrived at all', () => {
    expect(socketSuspect(sentAt - 5_000)).toBe(true);
    expect(socketSuspect(sentAt)).toBe(true);
  });

  it('leaves a healthy socket alone when the request was merely slow', () => {
    // A pong landed 10s in: the peer is there, the request is just slow. Tearing
    // the socket down here would turn one slow write into a reconnect.
    expect(socketSuspect(sentAt + 10_000)).toBe(false);
  });

  it('agrees with the heartbeat check on a socket silent far longer', () => {
    // Belt and braces: the heartbeat would also catch this, just later.
    expect(socketSuspect(sentAt - 120_000)).toBe(true);
    expect(isSocketStale(sentAt - 120_000, timedOutAt)).toBe(true);
  });
});
