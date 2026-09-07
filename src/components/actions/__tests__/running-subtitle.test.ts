import { describe, it, expect } from 'vitest';
import { runningSubtitle } from '../running-subtitle';

describe('runningSubtitle', () => {
  it('is the verb alone before anything is running', () => {
    expect(runningSubtitle('Turning on', null)).toBe('Turning on');
  });

  it('stays the verb alone for the first second', () => {
    // A press that answers immediately should not flash a counter on its way
    // past — the number is there to say "this is taking a while".
    expect(runningSubtitle('Turning on', 0)).toBe('Turning on');
    expect(runningSubtitle('Turning on', 0.9)).toBe('Turning on');
  });

  it('counts the seconds once the run is slow', () => {
    expect(runningSubtitle('Turning on', 1)).toBe('Turning on · 1s');
    expect(runningSubtitle('Turning on', 6)).toBe('Turning on · 6s');
    expect(runningSubtitle('Locking', 12)).toBe('Locking · 12s');
  });

  it('floors a part-second rather than showing a fraction', () => {
    expect(runningSubtitle('Turning off', 3.7)).toBe('Turning off · 3s');
  });

  it('stays inside the subtitle box the card actually gives it', () => {
    // The card is 197px; the subtitle keeps 89.5px with the toggle at an end
    // and 70.5px with it in the middle, which is what a half-changed home
    // shows. Measured at 10px, `Turning on · 6s` is 66.9px and fits both, where
    // `Turning on · 24 of 41` was 92.5px and fit neither. This is a guard on
    // the length, not the pixels: two digits of seconds is the longest this
    // ever gets, and it is still shorter than the count it replaced.
    expect(runningSubtitle('Turning on', 99).length)
      .toBeLessThan('Turning on · 24 of 41'.length);
  });
});
