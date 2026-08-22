// The two cases that carry this design are `half-open` and `slider drag`.
//
// Half-open is why the classifier leads with in-flight age: on a socket whose
// peer has gone, nothing completes, so a metric built from completions stays
// silent — and silence reads as healthy. That is the bug, restated.
//
// Slider drag is the trap that ate the first pending-ring design: a dragged
// slider commits on a 250ms leading-edge throttle, and anything that reacts to
// the gaps between those commits misbehaves. Here the risk is flapping.

import { describe, it, expect } from 'vitest';
import {
  classifyQuality,
  medianRtt,
  pushRtt,
  applyHysteresis,
  initialHysteresis,
  isDegraded,
  RTT_WINDOW,
  SLOW_RTT_MS,
  STALLED_RTT_MS,
  SAMPLE_MAX_AGE_MS,
  RECOVERY_HOLD_MS,
  type QualityInputs,
} from '../connection-quality';

const NOW = 1_000_000;

function inputs(over: Partial<QualityInputs> = {}): QualityInputs {
  return {
    socketConnected: true,
    rttSamples: [40, 45, 50],
    lastRttAt: NOW - 1_000,
    oldestInFlightSentAt: null,
    consecutiveFailures: 0,
    ...over,
  };
}

describe('medianRtt', () => {
  it('is null with no samples', () => {
    expect(medianRtt([])).toBeNull();
  });

  it('ignores the single unlucky sample a mean would not', () => {
    // One 9s outlier among fast requests must not read as a bad connection.
    expect(medianRtt([40, 45, 50, 55, 9000])).toBe(50);
  });

  it('averages the middle pair when the window is even', () => {
    expect(medianRtt([10, 20, 30, 40])).toBe(25);
  });

  it('reads only the most recent window', () => {
    const old = new Array(20).fill(5000);
    expect(medianRtt([...old, 10, 10, 10, 10, 10])).toBe(10);
  });
});

describe('pushRtt', () => {
  it('keeps the window bounded so recovery shows quickly', () => {
    let s: number[] = [];
    for (let i = 0; i < 50; i++) s = pushRtt(s, i);
    expect(s).toHaveLength(RTT_WINDOW);
    expect(s[s.length - 1]).toBe(49);
  });
});

describe('classifyQuality', () => {
  it('reports good on a healthy link', () => {
    expect(classifyQuality(inputs(), NOW)).toBe('good');
  });

  it('offline beats every other signal', () => {
    const q = classifyQuality(
      inputs({ socketConnected: false, rttSamples: [10], oldestInFlightSentAt: NOW - 20_000 }),
      NOW,
    );
    expect(q).toBe('offline');
  });

  // ── the case this ordering exists for ────────────────────────────────────
  it('half-open: calls it stalled even though every completed request was fast', () => {
    // TCP is up, the peer is gone. The record of completed requests is
    // flawless — all of it from before the peer disappeared — and no new
    // request will ever complete. Only the in-flight age knows.
    const halfOpen = inputs({
      rttSamples: [40, 42, 38, 41, 39],
      lastRttAt: NOW - 70_000,          // still "fresh" by SAMPLE_MAX_AGE_MS
      oldestInFlightSentAt: NOW - 12_000,
    });
    expect(medianRtt(halfOpen.rttSamples)).toBeLessThan(SLOW_RTT_MS); // completions look great
    expect(classifyQuality(halfOpen, NOW)).toBe('stalled');
  });

  it('half-open: a completions-only view would have said good — proving the ordering matters', () => {
    const sameButNothingInFlight = inputs({
      rttSamples: [40, 42, 38, 41, 39],
      lastRttAt: NOW - 70_000,
      oldestInFlightSentAt: null,
    });
    expect(classifyQuality(sameButNothingInFlight, NOW)).toBe('good');
  });

  it('escalates with how long a request has been outstanding', () => {
    expect(classifyQuality(inputs({ oldestInFlightSentAt: NOW - 500 }), NOW)).toBe('good');
    expect(classifyQuality(inputs({ oldestInFlightSentAt: NOW - 3_000 }), NOW)).toBe('slow');
    expect(classifyQuality(inputs({ oldestInFlightSentAt: NOW - 9_000 }), NOW)).toBe('stalled');
  });

  it('treats repeated failures as a condition, not bad luck', () => {
    expect(classifyQuality(inputs({ consecutiveFailures: 1 }), NOW)).toBe('good');
    expect(classifyQuality(inputs({ consecutiveFailures: 2 }), NOW)).toBe('stalled');
  });

  it('grades a working-but-slow link off the median round trip', () => {
    expect(classifyQuality(inputs({ rttSamples: [SLOW_RTT_MS + 1] }), NOW)).toBe('slow');
    expect(classifyQuality(inputs({ rttSamples: [STALLED_RTT_MS + 1] }), NOW)).toBe('stalled');
  });

  // ── the hidden-tab case ──────────────────────────────────────────────────
  it('says unknown rather than a confident stale good when samples have expired', () => {
    // The heartbeat is suspended while a tab is hidden, so on resume the last
    // sample can be minutes old. Rendering "42ms" from it would be the very
    // bug this indicator exists to fix.
    const resumed = inputs({ lastRttAt: NOW - (SAMPLE_MAX_AGE_MS + 1) });
    expect(classifyQuality(resumed, NOW)).toBe('unknown');
  });

  it('says unknown before anything has ever been measured', () => {
    expect(classifyQuality(inputs({ rttSamples: [], lastRttAt: 0 }), NOW)).toBe('unknown');
  });

  it('still trusts in-flight evidence when the samples have expired', () => {
    const q = classifyQuality(
      inputs({ lastRttAt: 0, rttSamples: [], oldestInFlightSentAt: NOW - 9_000 }),
      NOW,
    );
    expect(q).toBe('stalled');
  });

  it('never reads a clock skew as a negative age', () => {
    expect(classifyQuality(inputs({ oldestInFlightSentAt: NOW + 5_000 }), NOW)).toBe('good');
  });
});

// ── the trap that ate the first pending-ring design ────────────────────────
describe('a dragged slider does not flap', () => {
  it('stays good across a two-second drag on a healthy link', () => {
    // VerticalSlider commits on a 250ms leading-edge throttle and a local write
    // settles in tens of ms, so at any instant there is either one very young
    // request in flight or none at all. Neither may register as degraded.
    let state = initialHysteresis('good');
    let samples: number[] = [50, 50, 50];

    for (let t = 0; t <= 2_000; t += 50) {
      const now = NOW + t;
      // A commit every 250ms, each settling 60ms later.
      const sinceCommit = t % 250;
      const inFlight = sinceCommit < 60 ? now - sinceCommit : null;
      if (sinceCommit === 0 && t > 0) samples = pushRtt(samples, 60);

      const raw = classifyQuality(
        inputs({ rttSamples: samples, lastRttAt: now, oldestInFlightSentAt: inFlight }),
        now,
      );
      expect(raw).toBe('good');
      state = applyHysteresis(state, raw, now);
      expect(state.shown).toBe('good');
    }
  });
});

describe('applyHysteresis', () => {
  it('degrades immediately — being told late is the whole complaint', () => {
    const s = applyHysteresis(initialHysteresis('good'), 'stalled', NOW);
    expect(s.shown).toBe('stalled');
  });

  it('does not recover until it has held', () => {
    let s = initialHysteresis('stalled');
    s = applyHysteresis(s, 'good', NOW);
    expect(s.shown).toBe('stalled');

    s = applyHysteresis(s, 'good', NOW + RECOVERY_HOLD_MS - 1);
    expect(s.shown).toBe('stalled');

    s = applyHysteresis(s, 'good', NOW + RECOVERY_HOLD_MS);
    expect(s.shown).toBe('good');
  });

  it('restarts the hold if it degrades again mid-recovery', () => {
    let s = initialHysteresis('stalled');
    s = applyHysteresis(s, 'good', NOW);
    s = applyHysteresis(s, 'stalled', NOW + 1_000);
    expect(s.shown).toBe('stalled');
    expect(s.improvingSince).toBeNull();

    // The clock restarts from here, not from the first attempt.
    s = applyHysteresis(s, 'good', NOW + 1_500);
    s = applyHysteresis(s, 'good', NOW + 1_500 + RECOVERY_HOLD_MS - 1);
    expect(s.shown).toBe('stalled');
    s = applyHysteresis(s, 'good', NOW + 1_500 + RECOVERY_HOLD_MS);
    expect(s.shown).toBe('good');
  });

  it('will not flap between good and slow on alternating samples', () => {
    let s = initialHysteresis('good');
    for (let i = 0; i < 10; i++) {
      const now = NOW + i * 200;
      s = applyHysteresis(s, i % 2 === 0 ? 'slow' : 'good', now);
    }
    // It went bad on the first tick and never got a clear 3s run to come back.
    expect(s.shown).toBe('slow');
  });

  it('adopts a real measurement over unknown immediately', () => {
    // A tab returning from the background goes good -> unknown (a severity
    // increase, so instant) and must come back as soon as one pong lands.
    // Making it wait out the recovery hold would park every resume on
    // "checking" for three seconds — the same jitter, relocated.
    let s = initialHysteresis('good');
    s = applyHysteresis(s, 'unknown', NOW);
    expect(s.shown).toBe('unknown');
    s = applyHysteresis(s, 'good', NOW + 40);
    expect(s.shown).toBe('good');
  });

  it('does not let unknown become a shortcut out of a degraded state', () => {
    // offline -> unknown -> good must still serve the full hold: the exemption
    // is about leaving `unknown`, not about passing through it.
    let s = initialHysteresis('offline');
    s = applyHysteresis(s, 'unknown', NOW);
    expect(s.shown).toBe('offline');
    s = applyHysteresis(s, 'good', NOW + 100);
    expect(s.shown).toBe('offline');
    s = applyHysteresis(s, 'good', NOW + RECOVERY_HOLD_MS);
    expect(s.shown).toBe('good');
  });

  it('settles a resumed tab through the hold rather than flashing', () => {
    let s = initialHysteresis('offline');
    s = applyHysteresis(s, 'unknown', NOW);
    expect(s.shown).toBe('offline');
    s = applyHysteresis(s, 'unknown', NOW + RECOVERY_HOLD_MS);
    expect(s.shown).toBe('unknown');
  });
});

describe('isDegraded', () => {
  it('does not treat unknown as a failure', () => {
    // `unknown` means the evidence expired, which happens routinely whenever a
    // tab is backgrounded. Styling it as a fault would cry wolf every resume.
    expect(isDegraded('unknown')).toBe(false);
    expect(isDegraded('good')).toBe(false);
    expect(isDegraded('slow')).toBe(true);
    expect(isDegraded('stalled')).toBe(true);
    expect(isDegraded('offline')).toBe(true);
  });
});
