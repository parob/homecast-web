/**
 * Conditions evaluated mid-run can read what earlier nodes produced.
 *
 * The editor's IF (Expression mode) offers upstream outputs as
 * `nodes['<id>'].data.<field>`, and actions have always resolved that. The
 * condition evaluator did not: it built its expression context without `nodes`,
 * and member access is null-safe, so `nodes['code1'].data.rain` read as
 * undefined — no error, nothing in the trace — and the IF quietly took its
 * else branch every time.
 *
 * Built from an editor graph, so the test follows the path a user's automation
 * actually takes: Schedule → Code → IF → Set Device.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { AutomationEngine } from '../engine/AutomationEngine';
import type { Action, Automation } from '../types/automation';
import type { ExecutionTrace } from '../types/execution';
import { graphToAutomation } from '@/components/automation-editor/serialization/graphToAutomation';
import type { FlowNodeData } from '@/components/automation-editor/constants';

let engine: AutomationEngine;
let bridge: {
  setCharacteristic: ReturnType<typeof vi.fn>;
  setServiceGroup: ReturnType<typeof vi.fn>;
  executeScene: ReturnType<typeof vi.fn>;
};
let traces: ExecutionTrace[];

/** Sandbox that runs code inline — Workers don't exist in the node test env. */
const inlineCodeSandbox = {
  async run(code: string, input: unknown) {
    // eslint-disable-next-line no-new-func
    const fn = new Function('input', code);
    return fn(input);
  },
  terminate() {},
};

function node(id: string, category: FlowNodeData['category'], nodeType: string, config: Record<string, unknown> = {}): Node<FlowNodeData> {
  return {
    id,
    type: 'automationNode',
    position: { x: 0, y: 0 },
    data: { category, nodeType, label: nodeType, icon: 'Zap', config, isConfigured: true, enabled: true },
  };
}

function edge(source: string, target: string, sourceHandle?: string): Edge {
  return { id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ''}`, source, target, sourceHandle, type: 'controlFlow' };
}

const setLight = (id: string, value: unknown): Action => ({
  id, type: 'set_characteristic', accessoryId: 'light-1', characteristicType: 'power_state', value,
});

beforeEach(() => {
  bridge = {
    setCharacteristic: vi.fn(async () => {}),
    setServiceGroup: vi.fn(async () => {}),
    executeScene: vi.fn(async () => {}),
  };
  traces = [];
  engine = new AutomationEngine({
    bridge,
    onTraceComplete: (t) => { traces.push(t); },
    onNotify: async () => {},
    codeSandbox: inlineCodeSandbox,
  });
  engine.initialize(() => () => {});
});

afterEach(() => {
  engine.teardown();
});

describe('an IF after a Code node', () => {
  function rainAutomation(rain: boolean): Automation {
    const nodes = [
      node('t1', 'trigger', 'schedule', { scheduleMode: 'time', at: '07:00' }),
      node('code1', 'action', 'code', { code: `return { rain: ${rain} };` }),
      node('if1', 'logic', 'if', { conditionMode: 'expression', expression: "nodes['code1'].data.rain" }),
      node('a-then', 'action', 'set_device', { accessoryId: 'light-1', characteristicType: 'power_state', value: 'then' }),
      node('a-else', 'action', 'set_device', { accessoryId: 'light-1', characteristicType: 'power_state', value: 'else' }),
    ];
    const edges = [
      edge('t1', 'code1'),
      edge('code1', 'if1'),
      edge('if1', 'a-then', 'true'),
      edge('if1', 'a-else', 'false'),
    ];
    return { ...graphToAutomation(nodes, edges, 'Rain check', 'home-1'), id: 'auto-1' };
  }

  it("takes the then branch when the Code node's output says so", async () => {
    engine.loadAutomations([rainAutomation(true)]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(1);
    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'then', 'home-1');
  });

  it('takes the else branch when it says otherwise', async () => {
    engine.loadAutomations([rainAutomation(false)]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'else', 'home-1');
  });

  it("records the value it read, so the trace shows why", async () => {
    engine.loadAutomations([rainAutomation(true)]);

    await engine.manualTrigger('auto-1');

    const ifStep = traces[0].steps.find((s) => s.nodeId === 'if1');
    const condition = ifStep?.input?.condition as { children: { actual: unknown }[] };
    expect(condition.children[0].actual).toBe(true);
  });
});

describe('other mid-run conditions', () => {
  function base(actions: Action[]): Automation {
    return {
      id: 'auto-1', name: 'Test', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [], conditions: { operator: 'and', conditions: [] }, actions,
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    };
  }
  const codeSaysRain: Action = { id: 'code1', type: 'code', code: 'return { rain: true };' };
  const rainTemplate = { operator: 'and' as const, conditions: [{ id: 'c1', type: 'template' as const, expression: "nodes['code1'].data.rain" }] };

  it('choose matches a branch on an earlier node output', async () => {
    engine.loadAutomations([base([
      codeSaysRain,
      { id: 'ch1', type: 'choose', choices: [{ conditions: rainTemplate, actions: [setLight('a1', 'matched')] }], default: [setLight('a2', 'default')] },
    ])]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledWith('light-1', 'power_state', 'matched', 'home-1');
  });

  it("repeat until stops on a node output the loop's own step updates", async () => {
    // Each pass, the Code node counts up; the loop ends when it reaches 3.
    engine.loadAutomations([base([{
      id: 'r1', type: 'repeat', mode: 'until',
      untilCondition: { operator: 'and', conditions: [{ id: 'c1', type: 'template', expression: "nodes['count1'].data.n >= 3" }] },
      sequence: [
        { id: 'count1', type: 'code', code: "return { n: (input.nodes['count1']?.data?.n ?? 0) + 1 };" },
        setLight('a1', true),
      ],
    }])]);

    await engine.manualTrigger('auto-1');

    expect(bridge.setCharacteristic).toHaveBeenCalledTimes(3);
  });
});
