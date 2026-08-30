/**
 * A long write is not a bad connection.
 *
 * Taken from a real report (homecast-cloud#46): pressing "All lights" on a home
 * with 130 accessories sends one `characteristics.set`, the relay works through
 * it, and 14.5 seconds later it answers. The whole time the socket is healthy —
 * hundreds of `characteristic_update` broadcasts arrive as the bulbs move, the
 * 10s `automation.virtual_states` poll round-trips in 108-252ms — but the badge
 * reads "Slow" at 2.5s and "Your home is not responding" at 8s, because the
 * classifier times the user's own job against thresholds meant for latency.
 *
 * From the report's own log buffer:
 *
 *     characteristics.set        ← server (14558ms)
 *     automation.virtual_states  ← server (115ms)
 *     automation.virtual_states  ← server (108ms)
 *     automation.virtual_states  ← server (252ms)
 *
 * The fix is not a longer threshold — a big enough house would outgrow any
 * number. It is that housework is not a latency measurement, so it does not
 * feed the signal that measures latency.
 */
import { describe, it, expect } from 'vitest';
import {
  classifyQuality,
  oldestCountedInFlight,
  isHousework,
  type InFlightRequest,
} from '../connection-quality';

const NOW = 1_788_071_080_000;

/** The connection as the report actually found it: fast, busy, and fine. */
function healthy(pending: InFlightRequest[]) {
  return {
    socketState: 'connected' as const,
    socketStateSince: NOW - 300_000,
    // The virtual-states poll, which never stopped being quick.
    rttSamples: [115, 108, 252, 171],
    lastRttAt: NOW - 1_000,
    oldestInFlightSentAt: oldestCountedInFlight(pending),
    consecutiveFailures: 0,
  };
}

describe('connection quality while the relay is doing housework', () => {
  it('stays good through a 14.5s all-lights write', () => {
    // The single bulk request the report recorded, at the age the popover
    // reported it ("A request has been waiting 14s").
    const pending: InFlightRequest[] = [
      { action: 'characteristics.set', sentAt: NOW - 14_558 },
    ];

    expect(classifyQuality(healthy(pending), NOW)).toBe('good');
  });

  it('never passes through Slow on the way there either', () => {
    // The user saw both, in order: "we get this slow and then not responding".
    for (const age of [2_600, 5_000, 9_000, 14_558, 25_000]) {
      const pending: InFlightRequest[] = [
        { action: 'characteristics.set', sentAt: NOW - age },
      ];
      expect(classifyQuality(healthy(pending), NOW)).toBe('good');
    }
  });

  it('still reports an ordinary request that hangs, mid-housework', () => {
    // The half-open socket this signal exists for does not stop being detectable
    // because a write happens to be running. `automation.virtual_states` polls
    // every 10s throughout, so there is always ordinary traffic to judge by.
    const pending: InFlightRequest[] = [
      { action: 'characteristics.set', sentAt: NOW - 14_558 },
      { action: 'automation.virtual_states', sentAt: NOW - 9_000 },
    ];

    expect(classifyQuality(healthy(pending), NOW)).toBe('stalled');
  });

  it('reports a hung ordinary request even when housework is older', () => {
    const pending: InFlightRequest[] = [
      { action: 'characteristics.set', sentAt: NOW - 20_000 },
      { action: 'rooms.list', sentAt: NOW - 3_000 },
    ];

    expect(classifyQuality(healthy(pending), NOW)).toBe('slow');
  });

  it('leaves every other signal alone', () => {
    // Housework is excused from the in-flight clock, not from the connection.
    // Failures and socket state still speak.
    const pending: InFlightRequest[] = [
      { action: 'characteristics.set', sentAt: NOW - 14_558 },
    ];

    expect(classifyQuality({ ...healthy(pending), consecutiveFailures: 2 }, NOW)).toBe('stalled');
    expect(
      classifyQuality(
        { ...healthy(pending), socketState: 'reconnecting', socketStateSince: NOW - 10_000 },
        NOW,
      ),
    ).toBe('offline');
  });
});

describe('oldestCountedInFlight', () => {
  it('is null when only housework is outstanding', () => {
    expect(oldestCountedInFlight([
      { action: 'characteristics.set', sentAt: NOW - 14_558 },
      { action: 'scene.execute', sentAt: NOW - 6_000 },
    ])).toBeNull();
  });

  it('is null when nothing is outstanding', () => {
    expect(oldestCountedInFlight([])).toBeNull();
  });

  it('takes the oldest of the requests that do count', () => {
    expect(oldestCountedInFlight([
      { action: 'characteristics.set', sentAt: NOW - 20_000 },
      { action: 'rooms.list', sentAt: NOW - 3_000 },
      { action: 'accessories.list', sentAt: NOW - 5_000 },
    ])).toBe(NOW - 5_000);
  });
});

describe('isHousework', () => {
  it('covers every action whose length is set by the house, not the link', () => {
    for (const action of [
      'characteristics.set',
      'state.set',
      'serviceGroup.set',
      'scene.execute',
    ]) {
      expect(isHousework(action)).toBe(true);
    }
  });

  it('leaves ordinary requests to be timed', () => {
    for (const action of [
      'homes.list',
      'rooms.list',
      'accessories.list',
      'accessory.get',
      'characteristic.get',
      'automation.virtual_states',
      'ping',
    ]) {
      expect(isHousework(action)).toBe(false);
    }
  });
});
