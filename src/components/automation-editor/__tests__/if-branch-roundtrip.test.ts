/**
 * The IF node has to actually branch.
 *
 * Until 2026-08, `graphToAutomation` serialized every IF with an empty
 * condition and empty then/else, and flattened both visual branches into the
 * root action list — the condition you typed was discarded and both branches
 * always ran (full-review finding B1). These tests pin the repaired
 * serializer: condition rows → engine conditions, True/False subtrees →
 * then/else, and a lossless round trip back into the editor.
 */

import { describe, it, expect } from 'vitest';
import type { Node, Edge } from '@xyflow/react';
import { graphToAutomation } from '../serialization/graphToAutomation';
import { automationToGraph } from '../serialization/automationToGraph';
import {
  ifConfigToConditionBlock, conditionBlockToIfConfig, rowsToConditionBlock, summarizeIfConfig,
} from '../serialization/if-condition';
import type { FlowNodeData } from '../constants';
import type { Automation, IfThenElseAction, ConditionBlock } from '@/automation/types/automation';

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

const TRIGGER = node('t1', 'trigger', 'device_changed', { accessoryId: 'sensor-1', characteristicType: 'motion_detected', filterMode: 'any' });

const IF_CONFIG = {
  conditionMode: 'simple',
  conditionLogic: 'and',
  conditions: [{ accessoryId: 'lamp-1', characteristicType: 'power_state', operator: 'eq', value: 1 }],
};

function findIf(auto: Automation): IfThenElseAction {
  const found = auto.actions.find((a) => a.type === 'if_then_else');
  expect(found).toBeTruthy();
  return found as IfThenElseAction;
}

describe('IF branch serialization', () => {
  it('captures True/False subtrees as then/else instead of flattening', () => {
    const nodes = [
      TRIGGER,
      node('if1', 'logic', 'if', IF_CONFIG),
      node('a-then', 'action', 'notify', { message: 'on' }),
      node('a-else', 'action', 'notify', { message: 'off' }),
    ];
    const edges = [
      edge('t1', 'if1'),
      edge('if1', 'a-then', 'true'),
      edge('if1', 'a-else', 'false'),
    ];

    const auto = graphToAutomation(nodes, edges, 'Test', 'home-1');
    const ifAction = findIf(auto);

    expect(ifAction.then.map((a) => a.id)).toEqual(['a-then']);
    expect(ifAction.else.map((a) => a.id)).toEqual(['a-else']);
    // Nothing from the branches leaks into the root list.
    expect(auto.actions.map((a) => a.id)).toEqual(['if1']);
  });

  it('serializes condition rows into engine state conditions', () => {
    const nodes = [TRIGGER, node('if1', 'logic', 'if', IF_CONFIG)];
    const auto = graphToAutomation(nodes, [edge('t1', 'if1')], 'Test', 'home-1');
    const condition = findIf(auto).condition;

    expect(condition.operator).toBe('and');
    expect(condition.conditions).toHaveLength(1);
    expect(condition.conditions[0]).toMatchObject({
      type: 'state', accessoryId: 'lamp-1', characteristicType: 'power_state', value: 1,
    });
  });

  it('keeps the expression as a template condition in expression mode', () => {
    const nodes = [TRIGGER, node('if1', 'logic', 'if', { conditionMode: 'expression', expression: "states('x','power_state') == 1" })];
    const auto = graphToAutomation(nodes, [edge('t1', 'if1')], 'Test', 'home-1');
    const condition = findIf(auto).condition;

    expect(condition.conditions[0]).toMatchObject({ type: 'template', expression: "states('x','power_state') == 1" });
  });

  it('nests IFs recursively', () => {
    const nodes = [
      TRIGGER,
      node('if1', 'logic', 'if', IF_CONFIG),
      node('if2', 'logic', 'if', { conditionMode: 'expression', expression: 'now().hour > 20' }),
      node('deep', 'action', 'notify', { message: 'late and on' }),
    ];
    const edges = [
      edge('t1', 'if1'),
      edge('if1', 'if2', 'true'),
      edge('if2', 'deep', 'true'),
    ];

    const auto = graphToAutomation(nodes, edges, 'Test', 'home-1');
    const outer = findIf(auto);
    const inner = outer.then[0] as IfThenElseAction;

    expect(inner.type).toBe('if_then_else');
    expect(inner.then.map((a) => a.id)).toEqual(['deep']);
    expect(auto.actions).toHaveLength(1);
  });

  it('puts a join node wired from both branches into both, so it runs once either way', () => {
    const nodes = [
      TRIGGER,
      node('if1', 'logic', 'if', IF_CONFIG),
      node('a-then', 'action', 'notify', { message: 'on' }),
      node('join', 'action', 'notify', { message: 'always after' }),
    ];
    const edges = [
      edge('t1', 'if1'),
      edge('if1', 'a-then', 'true'),
      edge('a-then', 'join'),
      edge('if1', 'join', 'false'),
    ];

    const auto = graphToAutomation(nodes, edges, 'Test', 'home-1');
    const ifAction = findIf(auto);

    expect(ifAction.then.map((a) => a.id)).toEqual(['a-then', 'join']);
    expect(ifAction.else.map((a) => a.id)).toEqual(['join']);
    expect(auto.actions.map((a) => a.id)).toEqual(['if1']);
  });

  it('round-trips: nested branches come back as nodes and re-save identically', () => {
    const nodes = [
      TRIGGER,
      node('if1', 'logic', 'if', IF_CONFIG),
      node('a-then', 'action', 'notify', { message: 'on' }),
      node('a-else', 'action', 'notify', { message: 'off' }),
    ];
    const edges = [
      edge('t1', 'if1'),
      edge('if1', 'a-then', 'true'),
      edge('if1', 'a-else', 'false'),
    ];

    const saved = graphToAutomation(nodes, edges, 'Test', 'home-1');
    const { nodes: reloaded, edges: reloadedEdges } = automationToGraph(saved);

    // All four nodes reappear.
    expect(reloaded.map((n) => n.id).sort()).toEqual(['a-else', 'a-then', 'if1', 't1']);

    const resaved = graphToAutomation(reloaded, reloadedEdges, 'Test', 'home-1', saved.id);
    const ifAction = findIf(resaved);
    expect(ifAction.then.map((a) => a.id)).toEqual(['a-then']);
    expect(ifAction.else.map((a) => a.id)).toEqual(['a-else']);
    expect(ifAction.condition).toEqual(findIf(saved).condition);
  });

  it('reconstructs branch edges for automations written without uiState (MCP)', () => {
    const saved = graphToAutomation(
      [
        TRIGGER,
        node('if1', 'logic', 'if', IF_CONFIG),
        node('a-then', 'action', 'notify', { message: 'on' }),
      ],
      [edge('t1', 'if1'), edge('if1', 'a-then', 'true')],
      'Test', 'home-1',
    );
    delete (saved as { uiState?: unknown }).uiState;

    const { edges: reloadedEdges } = automationToGraph(saved);
    expect(reloadedEdges.some((e) => e.source === 'if1' && e.target === 'a-then' && e.sourceHandle === 'true')).toBe(true);
  });
});

describe('if-condition config conversion', () => {
  it('maps operators: eq, neq (NOT-wrapped), above, below', () => {
    const block = rowsToConditionBlock([
      { accessoryId: 'a', characteristicType: 'power_state', operator: 'eq', value: 1 },
      { accessoryId: 'a', characteristicType: 'power_state', operator: 'neq', value: 0 },
      { accessoryId: 'b', characteristicType: 'temperature', operator: 'above', threshold: 21 },
      { accessoryId: 'b', characteristicType: 'temperature', operator: 'below', threshold: 28 },
    ], 'and', 'if1');

    expect(block.conditions[0]).toMatchObject({ type: 'state', value: 1 });
    expect(block.conditions[1]).toMatchObject({ operator: 'not' });
    expect(block.conditions[2]).toMatchObject({ type: 'numeric_state', above: 21 });
    expect(block.conditions[3]).toMatchObject({ type: 'numeric_state', below: 28 });

    // And back again, losslessly.
    const config = conditionBlockToIfConfig(block);
    expect(config.conditionMode).toBe('simple');
    expect(config.conditions).toHaveLength(4);
    expect(config.conditions![1]).toMatchObject({ operator: 'neq', value: 0 });
    expect(config.conditions![2]).toMatchObject({ operator: 'above', threshold: 21 });
  });

  it('drops incomplete rows instead of saving broken conditions', () => {
    const block = ifConfigToConditionBlock({
      conditionMode: 'simple',
      conditions: [
        { accessoryId: '', characteristicType: 'power_state', operator: 'eq', value: 1 },
        { accessoryId: 'a', characteristicType: 'power_state', operator: 'eq', value: undefined },
      ],
    }, 'if1');
    expect(block.conditions).toHaveLength(0);
  });

  it('carries an unrepresentable block through untouched (custom mode)', () => {
    const exotic: ConditionBlock = {
      operator: 'or',
      conditions: [
        { type: 'time', id: 'c1', after: '22:00' },
        { type: 'sun', id: 'c2', after: 'sunset' },
      ],
    };
    const config = conditionBlockToIfConfig(exotic);
    expect(config.conditionMode).toBe('custom');

    const back = ifConfigToConditionBlock(config, 'if1');
    expect(back).toEqual(exotic);
  });

  it('treats a legacy expression-only config as expression mode', () => {
    const block = ifConfigToConditionBlock({ expression: 'trigger.to_value == 1' }, 'if1');
    expect(block.conditions[0]).toMatchObject({ type: 'template', expression: 'trigger.to_value == 1' });
  });

  it('summarizes rows with device names, not UUIDs', () => {
    const summary = summarizeIfConfig(
      {
        conditionMode: 'simple',
        conditions: [
          { accessoryId: 'lamp-1', characteristicType: 'power_state', operator: 'eq', value: 1 },
          { accessoryId: 'door-1', characteristicType: 'contact_state', operator: 'eq', value: 0 },
        ],
      },
      { accessories: [{ id: 'lamp-1', name: 'Reading Lamp' }, { id: 'door-1', name: 'Front Door' }] },
    );
    expect(summary).toContain('Reading Lamp');
    expect(summary).not.toContain('lamp-1');
    expect(summary).toContain('+1 more');
  });
});
