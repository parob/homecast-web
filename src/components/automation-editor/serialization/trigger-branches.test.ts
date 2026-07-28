// Each trigger's chain must stay its own.
//
// An automation has one action list, but the canvas lets you draw a separate
// chain from each trigger. They used to be concatenated, losing which trigger
// owned which chain — so every trigger ran every action.
//
// Reported from production as "Notify Annex Lights still isn't working". The
// user had drawn the obvious thing: lights-on → notify "Annex Lights on",
// lights-off → notify "Annex Lights Off". Switching the lights on sent both
// notifications and ran both branches' device writes.

import { describe, it, expect } from 'vitest';
import { graphToAutomation } from './graphToAutomation';
import { automationToGraph } from './automationToGraph';
import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../constants';
import type { ChooseAction } from '@/automation/types/automation';

function makeNode(id: string, data: Partial<FlowNodeData> & { nodeType: string; category: FlowNodeData['category'] }): Node<FlowNodeData> {
  return {
    id,
    type: 'automationNode',
    position: { x: 0, y: 0 },
    data: { label: data.nodeType, icon: 'Zap', config: {}, isConfigured: true, enabled: true, ...data } as FlowNodeData,
  };
}

const edge = (source: string, target: string): Edge =>
  ({ id: `${source}-${target}`, source, target, type: 'controlFlow' });

/** The reported graph: an on-branch and an off-branch. */
function twoBranchGraph() {
  const nodes: Node<FlowNodeData>[] = [
    makeNode('t-on', { category: 'trigger', nodeType: 'device_changed',
      config: { serviceGroupId: 'group-1', characteristicType: 'power_state', to: 1 } }),
    makeNode('t-off', { category: 'trigger', nodeType: 'device_changed',
      config: { serviceGroupId: 'group-1', characteristicType: 'power_state', to: 0 } }),
    makeNode('n-on', { category: 'action', nodeType: 'notify',
      config: { message: 'Annex Lights on', title: 'Hello' } }),
    makeNode('n-off', { category: 'action', nodeType: 'notify',
      config: { message: 'Annex Lights Off', title: 'Annex Lights Off' } }),
  ];
  const edges = [edge('t-on', 'n-on'), edge('t-off', 'n-off')];
  return { nodes, edges };
}

describe('per-trigger branches', () => {
  it('does not run the off-branch when the on-trigger fires', () => {
    const { nodes, edges } = twoBranchGraph();

    const auto = graphToAutomation(nodes, edges, 'Notify Annex Lights', 'home-1');

    // Not two loose notifies at the top level — that is the bug.
    expect(auto.actions).toHaveLength(1);
    expect(auto.actions[0].type).toBe('choose');

    const choose = auto.actions[0] as ChooseAction;
    expect(choose.choices).toHaveLength(2);

    // Each arm is gated on its own trigger, and carries only its own actions.
    for (const [i, triggerId] of ['t-on', 't-off'].entries()) {
      const gate = choose.choices[i].conditions.conditions[0] as { type: string; triggerId: string };
      expect(gate.type).toBe('trigger');
      expect(gate.triggerId).toBe(triggerId);
      expect(choose.choices[i].actions).toHaveLength(1);
    }

    const messages = choose.choices.map((c) => (c.actions[0] as { message: string }).message);
    expect(messages).toEqual(['Annex Lights on', 'Annex Lights Off']);
  });

  it('keeps a single-trigger automation flat', () => {
    const nodes = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 } }),
      makeNode('a1', { category: 'action', nodeType: 'notify', config: { message: 'hi' } }),
    ];

    const auto = graphToAutomation(nodes, [edge('t1', 'a1')], 'One', 'home-1');

    expect(auto.actions).toHaveLength(1);
    expect(auto.actions[0].type).toBe('notify');
  });

  it('keeps several triggers flat when they all lead to the same chain', () => {
    // "Any of these events → do this" is the ordinary case and must not grow a
    // choose wrapper it does not need.
    const nodes = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 } }),
      makeNode('t2', { category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-2', characteristicType: 'power_state', to: 1 } }),
      makeNode('a1', { category: 'action', nodeType: 'notify', config: { message: 'hi' } }),
    ];

    const auto = graphToAutomation(nodes, [edge('t1', 'a1'), edge('t2', 'a1')], 'Shared', 'home-1');

    expect(auto.actions).toHaveLength(1);
    expect(auto.actions[0].type).toBe('notify');
  });

  it("does not let one branch's condition gate the other", () => {
    const { nodes, edges } = twoBranchGraph();
    nodes.push(makeNode('c1', { category: 'condition', nodeType: 'state',
      config: { accessoryId: 'acc-9', characteristicType: 'power_state', value: 1 } }));
    edges.push(edge('t-on', 'c1'));

    const auto = graphToAutomation(nodes, edges, 'Gated', 'home-1');

    // The condition belongs to the on-arm only, not to the automation as a whole.
    expect(auto.conditions.conditions).toHaveLength(0);
    const choose = auto.actions[0] as ChooseAction;
    expect(choose.choices[0].conditions.conditions).toHaveLength(2); // trigger gate + the condition
    expect(choose.choices[1].conditions.conditions).toHaveLength(1); // trigger gate only
  });

  it('survives a round-trip back to the canvas', () => {
    const { nodes, edges } = twoBranchGraph();

    const auto = graphToAutomation(nodes, edges, 'Notify Annex Lights', 'home-1');
    const graph = automationToGraph(auto);

    // Both triggers come back, and the user's own node layout is preserved via
    // uiState rather than being rebuilt from the flattened list.
    expect(graph.nodes.filter((n) => (n.data as FlowNodeData).category === 'trigger')).toHaveLength(2);
  });

  it('ignores a trigger wired to nothing', () => {
    const nodes = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 } }),
      makeNode('t2', { category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-2', characteristicType: 'power_state', to: 1 } }),
      makeNode('a1', { category: 'action', nodeType: 'notify', config: { message: 'hi' } }),
    ];

    // t2 leads nowhere — it should not produce an empty choose arm.
    const auto = graphToAutomation(nodes, [edge('t1', 'a1')], 'Dangling', 'home-1');

    expect(auto.triggers).toHaveLength(2);
    expect(auto.actions).toHaveLength(1);
    expect(auto.actions[0].type).toBe('notify');
  });
});
