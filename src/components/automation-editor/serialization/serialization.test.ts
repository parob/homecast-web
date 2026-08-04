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

// ============================================================
// Node types the engine has always executed but the palette never exposed.
// A node that serializes one way but not the other saves fine and then comes
// back blank, so each of these needs a round trip, not just one direction.
// ============================================================

describe('serialization: newly exposed node types', () => {
  function roundTrip(nodeType: string, config: Record<string, unknown>) {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_changed',
        config: { accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 } }),
      makeNode('n1', { category: config.category as FlowNodeData['category'] ?? 'action', nodeType, config }),
    ];
    const auto = graphToAutomation(nodes, [makeEdge('t1', 'n1')], 'Test', 'home-1');
    const graph = automationToGraph(auto);
    return { auto, graph };
  }

  it('round-trips a virtual accessory node, emitting the new type name', () => {
    const { auto, graph } = roundTrip('virtual', {
      helperId: 'guest_mode', operation: 'turn_on', category: 'action',
    });

    const action = auto.actions[0] as any;
    // New saves write 'virtual'; 'helper' is still read (see below).
    expect(action.type).toBe('virtual');
    expect(action.helperId).toBe('guest_mode');
    expect(action.operation).toBe('turn_on');

    const node = graph.nodes.find(n => n.data.nodeType === 'virtual')!;
    expect(node.data.config.helperId).toBe('guest_mode');
    expect(node.data.config.operation).toBe('turn_on');
  });

  it('still loads an automation stored with the old helper type', () => {
    // Stored data, not a rename: automations saved before this exist and must
    // keep working, mapping onto the new node type.
    const stored = {
      id: 'a1', name: 'Old', homeId: 'home-1', enabled: true, mode: 'single',
      triggers: [], conditions: { operator: 'and', conditions: [] },
      actions: [{ type: 'helper', id: 'n1', helperId: 'guest_mode', operation: 'turn_on' }],
    } as any;
    const graph = automationToGraph(stored);
    const node = graph.nodes.find(n => n.data.nodeType === 'virtual');
    expect(node, 'an old helper action should load as a virtual node').toBeTruthy();
    expect(node!.data.config.helperId).toBe('guest_mode');
  });

  it('round-trips a virtual timer start with a duration', () => {
    const { auto, graph } = roundTrip('helper', {
      helperId: 'bathroom_timer', operation: 'start', duration: { minutes: 5 }, category: 'action',
    });

    expect((auto.actions[0] as any).duration).toEqual({ minutes: 5 });
    const node = graph.nodes.find(n => n.data.nodeType === 'virtual')!;
    expect(node.data.config.duration).toEqual({ minutes: 5 });
  });

  it('round-trips a repeat node', () => {
    const { auto, graph } = roundTrip('repeat', { mode: 'count', count: 5, category: 'logic' });

    expect((auto.actions[0] as any).type).toBe('repeat');
    expect((auto.actions[0] as any).count).toBe(5);
    const node = graph.nodes.find(n => n.data.nodeType === 'repeat')!;
    expect(node.data.config.mode).toBe('count');
    expect(node.data.config.count).toBe(5);
  });

  it('round-trips a stop node', () => {
    const { auto, graph } = roundTrip('stop', { reason: 'Nothing to do', category: 'logic' });

    expect((auto.actions[0] as any).type).toBe('stop');
    const node = graph.nodes.find(n => n.data.nodeType === 'stop')!;
    expect(node.data.config.reason).toBe('Nothing to do');
  });

  it('round-trips a variables node', () => {
    const { auto, graph } = roundTrip('variables', { variables: { level: 42 }, category: 'logic' });

    expect((auto.actions[0] as any).type).toBe('variables');
    expect((auto.actions[0] as any).variables).toEqual({ level: 42 });
    const node = graph.nodes.find(n => n.data.nodeType === 'variables')!;
    expect(node.data.config.variables).toEqual({ level: 42 });
  });

  it('serializes choose and parallel nodes', () => {
    expect((roundTrip('choose', { category: 'logic' }).auto.actions[0] as any).type).toBe('choose');
    expect((roundTrip('parallel', { category: 'logic' }).auto.actions[0] as any).type).toBe('parallel');
  });
});

describe('serialization: trigger "for" duration', () => {
  function triggerRoundTrip(config: Record<string, unknown>) {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_changed', config }),
      makeNode('a1', { category: 'action', nodeType: 'set_device',
        config: { accessoryId: 'acc-2', characteristicType: 'power_state', value: true } }),
    ];
    const auto = graphToAutomation(nodes, [makeEdge('t1', 'a1')], 'Test', 'home-1');
    return { auto, graph: automationToGraph(auto) };
  }

  it('round-trips a duration on a state trigger', () => {
    const { auto, graph } = triggerRoundTrip({
      accessoryId: 'door-1', characteristicType: 'contact_state', to: true,
      forMinutes: 5,
    });

    expect((auto.triggers[0] as any).for).toEqual({ minutes: 5 });
    const node = graph.nodes.find(n => n.data.category === 'trigger')!;
    expect(node.data.config.forMinutes).toBe(5);
  });

  it('round-trips a duration on a numeric_state trigger', () => {
    const { auto, graph } = triggerRoundTrip({
      accessoryId: 'freezer', characteristicType: 'temperature', above: -10,
      forHours: 1, forMinutes: 30,
    });

    expect((auto.triggers[0] as any).type).toBe('numeric_state');
    expect((auto.triggers[0] as any).for).toEqual({ hours: 1, minutes: 30 });
    const node = graph.nodes.find(n => n.data.category === 'trigger')!;
    expect(node.data.config.forHours).toBe(1);
    expect(node.data.config.forMinutes).toBe(30);
  });

  it('omits the duration entirely when the fields are empty or zero', () => {
    const { auto } = triggerRoundTrip({
      accessoryId: 'door-1', characteristicType: 'contact_state', to: true,
      forHours: 0, forMinutes: 0, forSeconds: 0,
    });

    expect((auto.triggers[0] as any).for).toBeUndefined();
  });
});

describe('serialization: device_offline trigger', () => {
  it('round-trips through the engine type', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_offline',
        config: { accessoryId: 'freezer-1', availability: 'unavailable', forMinutes: 10 } }),
      makeNode('a1', { category: 'action', nodeType: 'notify', config: { message: 'Freezer offline' } }),
    ];
    const auto = graphToAutomation(nodes, [makeEdge('t1', 'a1')], 'Test', 'home-1');

    const t = auto.triggers[0] as any;
    expect(t.type).toBe('device_availability');
    expect(t.accessoryId).toBe('freezer-1');
    expect(t.to).toBe('unavailable');
    expect(t.for).toEqual({ minutes: 10 });

    const graph = automationToGraph(auto);
    const node = graph.nodes.find(n => n.data.category === 'trigger')!;
    expect(node.data.nodeType).toBe('device_offline');
    expect(node.data.config.accessoryId).toBe('freezer-1');
    expect(node.data.config.availability).toBe('unavailable');
    expect(node.data.config.forMinutes).toBe(10);
  });

  it('defaults to the unavailable edge', () => {
    const nodes: Node<FlowNodeData>[] = [
      makeNode('t1', { category: 'trigger', nodeType: 'device_offline', config: { accessoryId: 'x' } }),
      makeNode('a1', { category: 'action', nodeType: 'notify', config: { message: 'hi' } }),
    ];
    const auto = graphToAutomation(nodes, [makeEdge('t1', 'a1')], 'Test', 'home-1');

    expect((auto.triggers[0] as any).to).toBe('unavailable');
  });
});
