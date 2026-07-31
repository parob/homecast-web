// mapTraceToNodeStates: trace steps → per-canvas-node execution state for the
// run-view overlay. Canvas ids equal engine trigger/action ids; engine-internal
// step ids (condition block, blocked markers, multi-trigger wrappers) must not
// leak onto the canvas.

import { describe, it, expect } from 'vitest';
import { mapTraceToNodeStates } from '../run-view';
import type { TraceStep } from '@/automation/types/execution';

function step(partial: Partial<TraceStep>): TraceStep {
  return {
    index: 0, type: 'action', nodeId: 'n', nodeType: 'set_characteristic',
    nodeSummary: '', startedAt: '2026-07-30T10:00:00.000Z', result: 'executed',
    ...partial,
  };
}

describe('mapTraceToNodeStates', () => {
  it('maps results onto canvas nodes and leaves unexecuted nodes absent', () => {
    const states = mapTraceToNodeStates(
      [
        step({ nodeId: 't1', type: 'trigger', result: 'passed', durationMs: 0 }),
        step({ nodeId: 'a1', result: 'executed', durationMs: 120 }),
        step({ nodeId: 'a2', result: 'error', error: 'device offline' }),
      ],
      ['t1', 'a1', 'a2', 'a3'],
    );

    expect(states.get('t1')?.executionState).toBe('completed');
    expect(states.get('a1')).toMatchObject({ executionState: 'completed', executionTime: 120 });
    expect(states.get('a2')).toMatchObject({ executionState: 'failed', executionError: 'device offline' });
    expect(states.has('a3')).toBe(false); // caller dims as skipped
  });

  it('skips engine-internal and synthetic multi-trigger step ids', () => {
    const states = mapTraceToNodeStates(
      [
        step({ nodeId: 'conditions', type: 'condition', result: 'failed' }),
        step({ nodeId: '__blocked__', result: 'skipped' }),
        step({ nodeId: 'choose-by-trigger-x', result: 'executed' }),
        step({ nodeId: 'trigger-is-t1', result: 'executed' }),
      ],
      ['conditions', '__blocked__', 'choose-by-trigger-x', 'trigger-is-t1'],
    );

    expect(states.size).toBe(0);
  });

  it('lets the final retry attempt decide the node state and sums durations', () => {
    const states = mapTraceToNodeStates(
      [
        step({ nodeId: 'a1', result: 'error', error: 'flaky', durationMs: 50 }),
        step({ nodeId: 'a1', result: 'executed', attempt: 2, durationMs: 70 }),
      ],
      ['a1'],
    );

    expect(states.get('a1')?.executionState).toBe('completed');
    expect(states.get('a1')?.executionTime).toBe(120);
  });

  it('pins a node with an in-flight step to running', () => {
    const states = mapTraceToNodeStates(
      [
        step({ nodeId: 'a1', result: 'running' }),
        step({ nodeId: 'a1', result: 'executed' }),
      ],
      ['a1'],
    );

    expect(states.get('a1')?.executionState).toBe('running');
  });

  it('falls back to timestamps for durations on old traces', () => {
    const states = mapTraceToNodeStates(
      [step({ nodeId: 'a1', startedAt: '2026-07-30T10:00:00.000Z', finishedAt: '2026-07-30T10:00:00.250Z' })],
      ['a1'],
    );

    expect(states.get('a1')?.executionTime).toBe(250);
  });
});
