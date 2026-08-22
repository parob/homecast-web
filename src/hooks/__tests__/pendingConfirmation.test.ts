import { describe, it, expect } from 'vitest';
import { confirmsPending, ignoreWindowMs } from '../pendingConfirmation';

describe('recognising our own write coming back', () => {
  it('accepts a position a bridge has rounded to its own step', () => {
    // Write 37 to a motor with 5% steps and it reports 35, for ever. Under an
    // exact match that never counted as confirmation, so the pending entry sat
    // there blocking readings until it expired — and the bar jumped seconds
    // after the user had stopped touching it, with nothing to explain why.
    expect(confirmsPending('target_position', 35, 37)).toBe(true);
    expect(confirmsPending('current_position', 99, 100)).toBe(true);
  });

  it('still calls a genuinely different position different', () => {
    expect(confirmsPending('target_position', 60, 37)).toBe(false);
    expect(confirmsPending('target_position', 0, 100)).toBe(false);
  });

  it('reads numbers that arrive as strings', () => {
    expect(confirmsPending('target_position', '36', 37)).toBe(true);
    expect(confirmsPending('target_position', '5', 37)).toBe(false);
  });

  it('gives no slack to anything that is not a position', () => {
    // A mode or a temperature that is nearly right is simply wrong.
    expect(confirmsPending('heating_cooling_target', 2, 1)).toBe(false);
    expect(confirmsPending('brightness', 49, 50)).toBe(false);
    expect(confirmsPending('power_state', true, true)).toBe(true);
    expect(confirmsPending('power_state', false, true)).toBe(false);
  });

  it('falls back to an exact comparison when a position is not numeric', () => {
    expect(confirmsPending('target_position', null, null)).toBe(true);
    expect(confirmsPending('target_position', null, 40)).toBe(false);
  });
});

describe('how long a stale reading is ignored', () => {
  it('covers the whole of a covering journey, not the first five seconds', () => {
    // A blind can be half a minute in transit, and for all of it the bridge
    // keeps republishing the target it had before.
    expect(ignoreWindowMs('target_position')).toBe(30000);
    expect(ignoreWindowMs('target_vertical_tilt')).toBe(30000);
  });

  it('leaves every other characteristic on the default', () => {
    expect(ignoreWindowMs('power_state')).toBe(5000);
    expect(ignoreWindowMs('brightness')).toBe(5000);
  });
});
