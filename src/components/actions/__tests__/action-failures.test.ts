import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  closeActionFailures, getActionFailures, openActionFailures,
  resolveActionFailures, subscribeActionFailures,
  type ActionFailure, type ActionFailureReport,
} from '../action-failures';
import type { HomeActionWrite } from '../catalog';

const write = (accessoryId: string): HomeActionWrite => ({
  accessoryId,
  characteristicType: 'power_state',
  reportedCharacteristicType: 'power_state',
  value: true,
  previousValue: false,
});

const failure = (accessoryId: string, name: string): ActionFailure => ({
  accessoryId, name, reason: 'Didn’t respond in time.', write: write(accessoryId),
});

const report = (failures: ActionFailure[]): ActionFailureReport => ({
  id: 'lights:1', actionLabel: 'All lights', at: 0, failures, retry: () => {},
});

beforeEach(() => { closeActionFailures(); });

describe('the action failure store', () => {
  it('holds the run being looked at, and lets go on close', () => {
    openActionFailures(report([failure('a', 'Hall Lamp')]));
    expect(getActionFailures()?.failures).toHaveLength(1);
    closeActionFailures();
    expect(getActionFailures()).toBeNull();
  });

  it('replaces rather than stacks, so the sheet never describes a superseded run', () => {
    openActionFailures(report([failure('a', 'Hall Lamp')]));
    openActionFailures({ ...report([failure('b', 'Porch Light')]), id: 'lights:2' });
    expect(getActionFailures()?.id).toBe('lights:2');
    expect(getActionFailures()?.failures.map(f => f.accessoryId)).toEqual(['b']);
  });

  it('notifies subscribers, and stops once they unsubscribe', () => {
    const seen = vi.fn();
    const off = subscribeActionFailures(seen);
    openActionFailures(report([failure('a', 'Hall Lamp')]));
    expect(seen).toHaveBeenCalledTimes(1);
    off();
    closeActionFailures();
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('drops the rows a retry fixed and keeps the rest', () => {
    openActionFailures(report([failure('a', 'Hall Lamp'), failure('b', 'Porch Light')]));
    resolveActionFailures(['a']);
    expect(getActionFailures()?.failures.map(f => f.accessoryId)).toEqual(['b']);
  });

  it('closes itself when the retry fixed everything', () => {
    // The answer to "did that work" is the sheet going away, rather than an
    // empty list sitting there.
    openActionFailures(report([failure('a', 'Hall Lamp'), failure('b', 'Porch Light')]));
    resolveActionFailures(['a', 'b']);
    expect(getActionFailures()).toBeNull();
  });

  it('says nothing when a resolve changes nothing', () => {
    const seen = vi.fn();
    openActionFailures(report([failure('a', 'Hall Lamp')]));
    subscribeActionFailures(seen);
    resolveActionFailures(['someone-else']);
    expect(seen).not.toHaveBeenCalled();
    expect(getActionFailures()?.failures).toHaveLength(1);
  });

  it('is safe to resolve or close with nothing open', () => {
    expect(() => resolveActionFailures(['a'])).not.toThrow();
    expect(() => closeActionFailures()).not.toThrow();
    expect(getActionFailures()).toBeNull();
  });
});
