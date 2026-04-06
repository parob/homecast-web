// Tests for automation serialization — graph ↔ automation round-trips

import { describe, it, expect } from 'vitest';
import { graphToAutomation } from './graphToAutomation';
import { automationToGraph } from './automationToGraph';
import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../constants';
import type { Automation } from '@/automation/types/automation';

function makeNode(id: string, data: Partial<FlowNodeData> & { nodeType: string; category: FlowNodeData['category'] }): Node<FlowNodeData> {
  return {
    id,
    type: 'automationNode',
    position: { x: 0, y: 0 },
    data: {
      label: data.label ?? data.nodeType,
      icon: 'Zap',
      config: {},
      isConfigured: true,
      enabled: true,
      ...data,
    } as FlowNodeData,
  };
}

function makeEdge(source: string, target: string, sourceHandle?: string): Edge {
  return { id: `${source}-${target}`, source, target, sourceHandle, type: 'controlFlow' };
}

describe('serialization: graphToAutomation', () => {
  it('serializes device_changed trigger (individual accessory)', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', {
        category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 },
      }),
      makeNode('a1', {
        category: 'action', nodeType: 'set_device',
        config: { accessoryId: 'acc-2', characteristicType: 'brightness', value: 80 },
      }),
    ];
    const edges = [makeEdge('t1', 'a1')];

    const auto = graphToAutomation(nodes, edges, 'Test', 'home-1');
    expect(auto.triggers).toHaveLength(1);
    expect(auto.triggers[0].type).toBe('state');
    if (auto.triggers[0].type === 'state') {
      expect(auto.triggers[0].accessoryId).toBe('acc-1');
      expect(auto.triggers[0].to).toBe(1);
    }
    expect(auto.actions).toHaveLength(1);
    expect(auto.actions[0].type).toBe('set_characteristic');
  });

  it('serializes device_changed trigger (service group)', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', {
        category: 'trigger', nodeType: 'device_changed',
        config: { serviceGroupId: 'group-1', characteristicType: 'power_state', sourceMode: 'group' },
      }),
      makeNode('a1', {
        category: 'action', nodeType: 'delay',
        config: { seconds: 5 },
      }),
    ];
    const edges = [makeEdge('t1', 'a1')];

    const auto = graphToAutomation(nodes, edges, 'Group Test', 'home-1');
    expect(auto.triggers[0].type).toBe('state');
    if (auto.triggers[0].type === 'state') {
      expect(auto.triggers[0].serviceGroupId).toBe('group-1');
      expect(auto.triggers[0].accessoryId).toBeUndefined();
    }
  });

  it('serializes code node', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'webhook', config: { webhookId: 'wh-1' } }),
      makeNode('c1', {
        category: 'action', nodeType: 'code',
        config: { code: 'return { x: 1 };', timeout: 3000 },
      }),
    ];
    const edges = [makeEdge('t1', 'c1')];

    const auto = graphToAutomation(nodes, edges, 'Code Test', 'home-1');
    expect(auto.actions).toHaveLength(1);
    expect(auto.actions[0].type).toBe('code');
    if (auto.actions[0].type === 'code') {
      expect(auto.actions[0].code).toBe('return { x: 1 };');
      expect(auto.actions[0].timeout).toBe(3000);
    }
  });

  it('serializes merge node with inputIds from edges', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'schedule', config: { at: '07:00', scheduleMode: 'time' } }),
      makeNode('a1', { category: 'action', nodeType: 'set_device', config: { accessoryId: 'a', characteristicType: 'x', value: 1 } }),
      makeNode('a2', { category: 'action', nodeType: 'set_device', config: { accessoryId: 'b', characteristicType: 'x', value: 1 } }),
      makeNode('m1', { category: 'logic', nodeType: 'merge', config: { mergeMode: 'append' } }),
    ];
    const edges = [
      makeEdge('t1', 'a1'),
      makeEdge('t1', 'a2'),
      makeEdge('a1', 'm1'),
      makeEdge('a2', 'm1'),
    ];

    const auto = graphToAutomation(nodes, edges, 'Merge Test', 'home-1');
    const mergeAction = auto.actions.find(a => a.type === 'merge');
    expect(mergeAction).toBeDefined();
    if (mergeAction?.type === 'merge') {
      expect(mergeAction.mode).toBe('append');
      expect(mergeAction.inputIds).toContain('a1');
      expect(mergeAction.inputIds).toContain('a2');
    }
  });

  it('serializes sub_workflow node as call_script', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'schedule', config: { at: '08:00', scheduleMode: 'time' } }),
      makeNode('sw1', { category: 'logic', nodeType: 'sub_workflow', config: { automationId: 'other-auto-123' } }),
    ];
    const edges = [makeEdge('t1', 'sw1')];

    const auto = graphToAutomation(nodes, edges, 'Sub Test', 'home-1');
    const script = auto.actions.find(a => a.type === 'call_script');
    expect(script).toBeDefined();
    if (script?.type === 'call_script') {
      expect(script.scriptId).toBe('other-auto-123');
    }
  });

  it('serializes numeric thresholds', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', {
        category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'sensor-1', characteristicType: 'temperature', above: 30, below: 50 },
      }),
      makeNode('a1', { category: 'action', nodeType: 'notify', config: { message: 'Hot!' } }),
    ];
    const edges = [makeEdge('t1', 'a1')];

    const auto = graphToAutomation(nodes, edges, 'Threshold', 'home-1');
    expect(auto.triggers[0].type).toBe('numeric_state');
    if (auto.triggers[0].type === 'numeric_state') {
      expect(auto.triggers[0].above).toBe(30);
      expect(auto.triggers[0].below).toBe(50);
    }
  });

  it('preserves error handling config', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'schedule', config: { at: '09:00', scheduleMode: 'time' } }),
      makeNode('a1', {
        category: 'action', nodeType: 'http_request',
        config: { url: 'https://example.com', method: 'GET' },
      }),
    ];
    const edges = [makeEdge('t1', 'a1')];

    const auto = graphToAutomation(nodes, edges, 'Error Test', 'home-1');
    expect(auto.actions[0].type).toBe('fire_webhook');
  });
});

describe('serialization: automationToGraph', () => {
  it('deserializes state trigger back to device_changed node', () => {
    const auto: Automation = {
      id: 'auto-1', name: 'Test', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [{ type: 'state', id: 'trigger-1', accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 }],
      conditions: { operator: 'and', conditions: [] },
      actions: [],
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    };

    const { nodes } = automationToGraph(auto);
    const triggerNode = nodes.find(n => (n.data as FlowNodeData).category === 'trigger');
    expect(triggerNode).toBeDefined();
    expect((triggerNode!.data as FlowNodeData).nodeType).toBe('device_changed');
    expect((triggerNode!.data as FlowNodeData).config.accessoryId).toBe('acc-1');
    expect((triggerNode!.data as FlowNodeData).config.sourceMode).toBe('device');
  });

  it('deserializes service group trigger with sourceMode=group', () => {
    const auto: Automation = {
      id: 'auto-1', name: 'Test', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [{ type: 'state', id: 'trigger-1', serviceGroupId: 'group-1', characteristicType: 'power_state' }],
      conditions: { operator: 'and', conditions: [] },
      actions: [],
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    };

    const { nodes } = automationToGraph(auto);
    const triggerNode = nodes.find(n => (n.data as FlowNodeData).category === 'trigger');
    const config = (triggerNode!.data as FlowNodeData).config;
    expect(config.serviceGroupId).toBe('group-1');
    expect(config.sourceMode).toBe('group');
  });

  it('deserializes code action', () => {
    const auto: Automation = {
      id: 'auto-1', name: 'Test', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [{ type: 'event', id: 't1', eventType: 'test' }],
      conditions: { operator: 'and', conditions: [] },
      actions: [{ type: 'code', id: 'code-1', code: 'return 42;', timeout: 3000 }],
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    };

    const { nodes } = automationToGraph(auto);
    const codeNode = nodes.find(n => (n.data as FlowNodeData).nodeType === 'code');
    expect(codeNode).toBeDefined();
    expect((codeNode!.data as FlowNodeData).config.code).toBe('return 42;');
    expect((codeNode!.data as FlowNodeData).config.timeout).toBe(3000);
  });

  it('deserializes call_script as sub_workflow', () => {
    const auto: Automation = {
      id: 'auto-1', name: 'Test', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [{ type: 'event', id: 't1', eventType: 'test' }],
      conditions: { operator: 'and', conditions: [] },
      actions: [{ type: 'call_script', id: 'sw-1', scriptId: 'other-auto' }],
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    };

    const { nodes } = automationToGraph(auto);
    const subNode = nodes.find(n => (n.data as FlowNodeData).nodeType === 'sub_workflow');
    expect(subNode).toBeDefined();
    expect((subNode!.data as FlowNodeData).config.automationId).toBe('other-auto');
  });

  it('creates edges between trigger and action nodes', () => {
    const auto: Automation = {
      id: 'auto-1', name: 'Test', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [{ type: 'event', id: 't1', eventType: 'test' }],
      conditions: { operator: 'and', conditions: [] },
      actions: [
        { type: 'delay', id: 'a1', duration: { seconds: 5 } },
        { type: 'notify', id: 'a2', message: 'done' },
      ],
      metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    };

    const { nodes, edges } = automationToGraph(auto);
    expect(nodes.length).toBeGreaterThanOrEqual(3);
    expect(edges.length).toBeGreaterThanOrEqual(2); // t1→a1, a1→a2
  });
});

describe('serialization: round-trip', () => {
  it('preserves automation structure through graph→auto→graph', () => {
    // Start with nodes/edges
    const originalNodes: Node<FlowNodeData>[] = [
      makeNode('t1', {
        category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'light-1', characteristicType: 'power_state' },
      }),
      makeNode('a1', {
        category: 'action', nodeType: 'set_device',
        config: { accessoryId: 'light-2', characteristicType: 'brightness', value: 50 },
      }),
    ];
    const originalEdges = [makeEdge('t1', 'a1')];

    // Graph → Automation
    const auto = graphToAutomation(originalNodes, originalEdges, 'Round Trip', 'home-1');
    expect(auto.triggers.length).toBe(1);
    expect(auto.actions.length).toBe(1);

    // Automation → Graph
    const { nodes: newNodes } = automationToGraph(auto);
    const triggerNode = newNodes.find(n => (n.data as FlowNodeData).category === 'trigger');
    const actionNode = newNodes.find(n => (n.data as FlowNodeData).category === 'action');

    expect(triggerNode).toBeDefined();
    expect(actionNode).toBeDefined();
    expect((triggerNode!.data as FlowNodeData).config.accessoryId).toBe('light-1');
    expect((actionNode!.data as FlowNodeData).config.accessoryId).toBe('light-2');
  });
});
