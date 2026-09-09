/**
 * homecast-cloud#99: the client already knows the relay is gone.
 *
 * A phone sat for 61 seconds with a perfect socket to the cloud, three writes
 * refused with NO_DEVICE, and a cached home still claiming its relay was fine.
 * Local Mode never engaged and the status dot stayed on quiet emerald, because
 * between them they had nothing to react to. These tests are that missing
 * evidence, and what the two policies now do with it.
 */

import { describe, it, expect } from 'vitest';
import {
  EMPTY_REACHABILITY, noteRefused, noteServed, unreachableHomeIds,
} from '../relay-reachability';

describe('relay reachability', () => {
  it('marks a home the cloud has refused', () => {
    const m = noteRefused(EMPTY_REACHABILITY, 'd08cb174', 1_000);
    expect([...unreachableHomeIds(m)]).toEqual(['D08CB174']);
  });

  it('clears the mark once a request for that home is answered', () => {
    let m = noteRefused(EMPTY_REACHABILITY, 'D08CB174', 1_000);
    m = noteServed(m, 'D08CB174', 2_000);
    expect(unreachableHomeIds(m).size).toBe(0);
  });

  it('re-marks when a later request is refused again', () => {
    let m = noteServed(EMPTY_REACHABILITY, 'D08CB174', 1_000);
    m = noteRefused(m, 'D08CB174', 2_000);
    expect(unreachableHomeIds(m).has('D08CB174')).toBe(true);
  });

  it('does not expire on its own', () => {
    // Deliberate: once Local Mode is serving, nothing asks the cloud about
    // this home, so no fresh refusal arrives to renew the mark. An expiry
    // would disengage Local Mode, collect a refusal, and re-engage — a flap
    // manufactured by the mechanism meant to prevent one.
    const m = noteRefused(EMPTY_REACHABILITY, 'D08CB174', 0);
    expect(unreachableHomeIds(m).has('D08CB174')).toBe(true);
  });

  it('keeps homes apart', () => {
    const m = noteRefused(EMPTY_REACHABILITY, 'A', 1_000);
    expect(unreachableHomeIds(m).has('B')).toBe(false);
  });
});

// Local Mode used to be tested here against this module's refusals as an
// input. It no longer reads them: the policy reads the server's serving fact
// per home (`server/home-serving.ts`), and a refusal is a refetch trigger
// rather than a belief. The #99 cases — the takeover grace, a relay the server
// expects back — are in local-mode.test.ts as facts, which is what they were.
