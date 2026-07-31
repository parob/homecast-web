// @vitest-environment jsdom
//
// Execution history panel: the list renders old-shape traces (recorded before
// trigger steps / durations / container tags existed) without crashing, and
// surfaces the new capture — humanized trigger summaries, Test badges,
// blocked-run chips, status filters, and step nesting from parentNodeId tags.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';

import {
  ExecutionHistoryInline,
  buildStepTree,
  humanizeStepSummary,
  type TraceEntitySource,
} from '../panels/ExecutionHistoryPanel';
import { GET_EXECUTION_HISTORY } from '@/lib/graphql/queries';

const AUTOMATION_ID = 'auto-1';

const ENTITIES: TraceEntitySource = {
  accessories: [{ id: 'ACC-LIGHT', name: 'Reading Lamp' }, { id: 'ACC-SENSOR', name: 'Hall Motion' }],
  serviceGroups: [{ id: 'GRP-1', name: 'Downstairs Lights' }],
  scenes: [{ id: 'SCENE-1', name: 'Movie Night' }],
};

/** A trace exactly as the engine recorded it before the capture upgrades. */
const OLD_TRACE = {
  id: 'trace-old',
  automationId: AUTOMATION_ID,
  automationName: 'Old automation',
  startedAt: '2026-07-30T10:00:00.000Z',
  finishedAt: '2026-07-30T10:00:01.500Z',
  status: 'success',
  triggerData: { triggerId: 't1', triggerType: 'state', characteristicType: 'motion_detected', timestamp: 1 },
  steps: [
    {
      index: 0, type: 'condition', nodeId: 'conditions', nodeType: 'condition_block',
      nodeSummary: 'Evaluate conditions', startedAt: '2026-07-30T10:00:00.000Z', result: 'passed',
    },
    {
      index: 1, type: 'action', nodeId: 'a1', nodeType: 'set_characteristic',
      nodeSummary: 'Set ACC-LIGHT power_state', startedAt: '2026-07-30T10:00:00.100Z',
      result: 'executed', input: { accessoryId: 'ACC-LIGHT', characteristicType: 'power_state', value: true },
    },
  ],
  variables: {},
};

const NEW_TRACE = {
  id: 'trace-new',
  automationId: AUTOMATION_ID,
  automationName: 'New automation',
  startedAt: '2026-07-30T11:00:00.000Z',
  finishedAt: '2026-07-30T11:00:00.400Z',
  status: 'stopped',
  blockedReason: 'rate_limit',
  triggerData: { triggerId: 't1', triggerType: 'state', accessoryId: 'ACC-SENSOR', characteristicType: 'motion_detected', fromValue: 0, toValue: 1, timestamp: 2 },
  steps: [
    {
      index: 0, type: 'trigger', nodeId: 't1', nodeType: 'state',
      nodeSummary: 'Device changed: motion_detected 0 → 1',
      input: { accessoryId: 'ACC-SENSOR', characteristicType: 'motion_detected', fromValue: 0, toValue: 1 },
      startedAt: '2026-07-30T11:00:00.000Z', result: 'passed', durationMs: 0,
    },
  ],
  variables: {},
};

const TEST_TRACE = {
  ...OLD_TRACE,
  id: 'trace-test',
  status: 'error',
  error: 'device offline',
  triggerData: { triggerId: '__manual__', triggerType: 'event', eventType: 'manual_trigger', timestamp: 3 },
};

function entityRow(trace: any) {
  return {
    __typename: 'StoredEntityInfo',
    id: `row-${trace.id}`,
    entityId: trace.id,
    dataJson: JSON.stringify(trace),
    updatedAt: trace.startedAt,
  };
}

const mocks = [
  {
    request: { query: GET_EXECUTION_HISTORY, variables: { automationId: AUTOMATION_ID, limit: 50 } },
    result: { data: { hcExecutionTraces: [entityRow(NEW_TRACE), entityRow(TEST_TRACE), entityRow(OLD_TRACE)] } },
    maxUsageCount: Number.POSITIVE_INFINITY,
  },
];

function renderPanel(props: Partial<Parameters<typeof ExecutionHistoryInline>[0]> = {}) {
  return render(
    <MockedProvider mocks={mocks}>
      <ExecutionHistoryInline automationId={AUTOMATION_ID} entitySource={ENTITIES} {...props} />
    </MockedProvider>,
  );
}

afterEach(() => cleanup());

describe('ExecutionHistoryInline', () => {
  it('renders old-shape traces without crashing and keeps their status', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Success')).toBeTruthy());
  });

  it('humanizes the trigger summary from the trigger step', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText(/Hall Motion/)).toBeTruthy());
    expect(screen.getByText(/Hall Motion/).textContent).toContain('→');
  });

  it('labels blocked runs and test runs', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Rate limited')).toBeTruthy());
    expect(screen.getByText('Test')).toBeTruthy();
  });

  it('filters by status', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByText('Success')).toBeTruthy());

    fireEvent.click(screen.getByText('Errors'));
    expect(screen.queryByText('Success')).toBeNull();
    expect(screen.getByText('Error')).toBeTruthy();

    fireEvent.click(screen.getByText('All'));
    expect(screen.getByText('Success')).toBeTruthy();
  });

  it('hands the parsed trace to onSelectTrace when a row is tapped', async () => {
    const onSelectTrace = vi.fn();
    renderPanel({ onSelectTrace });
    await waitFor(() => expect(screen.getByText('Success')).toBeTruthy());

    fireEvent.click(screen.getByText('Success'));
    expect(onSelectTrace).toHaveBeenCalledWith(expect.objectContaining({ id: 'trace-old' }));
  });
});

describe('buildStepTree', () => {
  it('leaves untagged (old) steps flat', () => {
    const tree = buildStepTree(OLD_TRACE.steps);
    expect(tree).toHaveLength(2);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  it('nests steps under their container via parentNodeId', () => {
    const steps = [
      { index: 0, nodeId: 'ch1', nodeType: 'choose' },
      { index: 1, nodeId: 'a1', nodeType: 'set_characteristic', parentNodeId: 'ch1', branch: 'then' },
      { index: 2, nodeId: 'a2', nodeType: 'notify' },
    ];
    const tree = buildStepTree(steps);
    expect(tree.map((n) => n.step.nodeId)).toEqual(['ch1', 'a2']);
    expect(tree[0].children[0].step.nodeId).toBe('a1');
  });

  it('attaches children to the most recent run of a repeated container', () => {
    const steps = [
      { index: 0, nodeId: 'r1', nodeType: 'repeat' },
      { index: 1, nodeId: 'inner', parentNodeId: 'r1', iteration: 0 },
      { index: 2, nodeId: 'inner', parentNodeId: 'r1', iteration: 1 },
    ];
    const tree = buildStepTree(steps);
    expect(tree).toHaveLength(1);
    expect(tree[0].children).toHaveLength(2);
  });
});

describe('humanizeStepSummary', () => {
  it('resolves device names for set_characteristic steps', () => {
    const text = humanizeStepSummary(OLD_TRACE.steps[1], ENTITIES);
    expect(text).toContain('Reading Lamp');
    expect(text).not.toContain('ACC-LIGHT');
  });

  it('falls back to the recorded summary when nothing resolves', () => {
    const step = { type: 'action', nodeType: 'delay', nodeSummary: 'Wait 5s' };
    expect(humanizeStepSummary(step, ENTITIES)).toBe('Wait 5s');
  });

  it('names scenes', () => {
    const step = { type: 'action', nodeType: 'execute_scene', nodeSummary: 'Execute scene SCENE-1', input: { sceneId: 'SCENE-1' } };
    expect(humanizeStepSummary(step, ENTITIES)).toBe('Scene: Movie Night');
  });
});
