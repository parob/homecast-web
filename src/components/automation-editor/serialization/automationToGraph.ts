// Automation Editor - Automation JSON to React Flow Graph
// Converts an Automation definition into nodes + edges for rendering
// Maps engine types → simplified editor types (device_changed, schedule, etc.)

import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData, NodeCategory } from '../constants';
import type {
  Automation,
  Trigger,
  Condition,
  ConditionBlock,
  Action,
} from '@/automation/types/automation';
import { isConditionBlock } from '@/automation/types/automation';
import { TRIGGER_NODES, ACTION_NODES, LOGIC_NODES, ALL_NODE_DEFINITIONS } from '../constants';

const VERTICAL_GAP = 80;
const HORIZONTAL_OFFSET = 300;

// ============================================================
// Engine type → Simplified editor type mapping
// ============================================================

function simplifyTriggerType(engineType: string): { nodeType: string; extraConfig: Record<string, unknown> } {
  switch (engineType) {
    case 'state':
      return { nodeType: 'device_changed', extraConfig: {} };
    case 'numeric_state':
      return { nodeType: 'device_changed', extraConfig: {} };
    case 'time':
      return { nodeType: 'schedule', extraConfig: { scheduleMode: 'time' } };
    case 'time_pattern':
      return { nodeType: 'schedule', extraConfig: { scheduleMode: 'interval' } };
    case 'sun':
      return { nodeType: 'schedule', extraConfig: { scheduleMode: 'sun' } };
    case 'webhook':
      return { nodeType: 'webhook', extraConfig: {} };
    default:
      // Unknown engine types pass through as-is
      return { nodeType: engineType, extraConfig: {} };
  }
}

function simplifyActionType(engineType: string): string {
  switch (engineType) {
    case 'set_characteristic': return 'set_device';
    case 'execute_scene': return 'run_scene';
    case 'fire_webhook': return 'http_request';
    case 'if_then_else': return 'if';
    case 'wait_for_trigger': return 'wait';
    case 'call_script': return 'sub_workflow';
    default: return engineType; // delay, notify, code, merge pass through
  }
}

// ============================================================
// Main conversion
// ============================================================

export function automationToGraph(automation: Automation): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const edges: Edge[] = [];
  let y = 50;

  // Add trigger nodes
  const triggerNodeIds: string[] = [];
  for (let i = 0; i < automation.triggers.length; i++) {
    const trigger = automation.triggers[i];
    const x = HORIZONTAL_OFFSET + i * 220;
    const node = triggerToNode(trigger, x, y);
    nodes.push(node);
    triggerNodeIds.push(node.id);
  }
  y += VERTICAL_GAP;

  // Add condition nodes
  let lastNodeIds = triggerNodeIds;
  if (automation.conditions.conditions.length > 0) {
    const conditionNodes = conditionBlockToNodes(automation.conditions, HORIZONTAL_OFFSET, y);
    nodes.push(...conditionNodes);

    for (const triggerId of lastNodeIds) {
      edges.push(createEdge(triggerId, conditionNodes[0].id));
    }

    lastNodeIds = conditionNodes.map((n) => n.id);
    y += conditionNodes.length * VERTICAL_GAP;
  }

  // Add action nodes
  for (const action of automation.actions) {
    const node = actionToNode(action, HORIZONTAL_OFFSET, y);
    nodes.push(node);

    for (const prevId of lastNodeIds) {
      edges.push(createEdge(prevId, node.id, 'pass'));
    }

    lastNodeIds = [node.id];
    y += VERTICAL_GAP;
  }

  return { nodes, edges };
}

// ============================================================
// Trigger → Node (engine → simplified)
// ============================================================

function triggerToNode(trigger: Trigger, x: number, y: number): Node<FlowNodeData> {
  const { nodeType, extraConfig } = simplifyTriggerType(trigger.type);
  const def = TRIGGER_NODES.find((d) => d.type === nodeType) ?? ALL_NODE_DEFINITIONS.find((d) => d.type === nodeType);
  const config = { ...extractTriggerConfig(trigger), ...extraConfig };
  const summary = buildTriggerSummary(trigger, nodeType);

  return {
    id: trigger.id,
    type: 'automationNode',
    position: { x, y },
    data: {
      category: 'trigger',
      nodeType,
      label: def?.label ?? nodeType,
      icon: def?.icon ?? 'Zap',
      config: { ...config, summary },
      subtitle: summary || undefined,
      isConfigured: true,
      enabled: trigger.enabled !== false,
    },
  };
}

function extractTriggerConfig(trigger: Trigger): Record<string, unknown> {
  switch (trigger.type) {
    case 'state': return {
      accessoryId: trigger.accessoryId,
      serviceGroupId: trigger.serviceGroupId,
      sourceMode: trigger.serviceGroupId ? 'group' : 'device',
      characteristicType: trigger.characteristicType,
      to: trigger.to,
      from: trigger.from,
    };
    case 'numeric_state': return {
      accessoryId: trigger.accessoryId,
      serviceGroupId: trigger.serviceGroupId,
      sourceMode: trigger.serviceGroupId ? 'group' : 'device',
      characteristicType: trigger.characteristicType,
      above: trigger.above,
      below: trigger.below,
    };
    case 'time': return { at: trigger.at, weekdays: trigger.weekdays };
    case 'time_pattern': return { hours: trigger.hours, minutes: trigger.minutes, seconds: trigger.seconds };
    case 'sun': return { event: trigger.event, offsetMinutes: trigger.offset?.minutes };
    case 'webhook': return { webhookId: trigger.webhookId };
    case 'event': return { eventType: trigger.eventType };
    case 'system': return { event: trigger.event };
    case 'template': return { expression: trigger.expression };
    default: return {};
  }
}

function buildTriggerSummary(trigger: Trigger, _nodeType: string): string {
  switch (trigger.type) {
    case 'state': {
      const id = trigger.serviceGroupId ?? trigger.accessoryId ?? '';
      const prefix = trigger.serviceGroupId ? 'Group ' : '';
      return `${prefix}${id.slice(0, 12)}… ${trigger.characteristicType}`;
    }
    case 'numeric_state': {
      const id = trigger.serviceGroupId ?? trigger.accessoryId ?? '';
      const prefix = trigger.serviceGroupId ? 'Group ' : '';
      const parts: string[] = [prefix + id.slice(0, 12) + '…'];
      if (trigger.above !== undefined) parts.push(`>${trigger.above}`);
      if (trigger.below !== undefined) parts.push(`<${trigger.below}`);
      return parts.join(' ');
    }
    case 'time': return `At ${trigger.at}`;
    case 'time_pattern': {
      const parts: string[] = [];
      if (trigger.hours) parts.push(`${trigger.hours}h`);
      if (trigger.minutes) parts.push(`${trigger.minutes}m`);
      return `Every ${parts.join(' ')}`;
    }
    case 'sun': return `At ${trigger.event}`;
    case 'template': return trigger.expression.slice(0, 30);
    default: return trigger.type;
  }
}

// ============================================================
// ConditionBlock → Nodes (conditions use engine types directly)
// ============================================================

function conditionBlockToNodes(block: ConditionBlock, x: number, startY: number): Node<FlowNodeData>[] {
  const nodes: Node<FlowNodeData>[] = [];
  let y = startY;

  for (const item of block.conditions) {
    if (isConditionBlock(item)) {
      nodes.push(...conditionBlockToNodes(item, x + 20, y));
      y += VERTICAL_GAP;
    } else {
      const def = ALL_NODE_DEFINITIONS.find((d) => d.type === item.type);
      const config = extractConditionConfig(item);
      nodes.push({
        id: item.id,
        type: 'automationNode',
        position: { x, y },
        data: {
          category: 'condition' as NodeCategory,
          nodeType: item.type,
          label: def?.label ?? item.type,
          icon: def?.icon ?? 'GitBranch',
          config: { ...config, summary: buildConditionSummary(item) },
          subtitle: buildConditionSummary(item) || undefined,
          isConfigured: true,
          enabled: item.enabled !== false,
        },
      });
      y += VERTICAL_GAP;
    }
  }

  return nodes;
}

function extractConditionConfig(condition: Condition): Record<string, unknown> {
  switch (condition.type) {
    case 'state': return { accessoryId: condition.accessoryId, characteristicType: condition.characteristicType, value: condition.value };
    case 'numeric_state': return { accessoryId: condition.accessoryId, characteristicType: condition.characteristicType, above: condition.above, below: condition.below };
    case 'time': return { after: condition.after, before: condition.before, weekdays: condition.weekdays };
    case 'template': return { expression: condition.expression };
    default: return {};
  }
}

function buildConditionSummary(condition: Condition): string {
  switch (condition.type) {
    case 'state': return `${condition.accessoryId.slice(0, 12)}… == ${condition.value}`;
    case 'time': return `${condition.after ?? ''} - ${condition.before ?? ''}`;
    case 'template': return condition.expression.slice(0, 30);
    default: return condition.type;
  }
}

// ============================================================
// Action → Node (engine → simplified)
// ============================================================

function actionToNode(action: Action, x: number, y: number): Node<FlowNodeData> {
  const nodeType = simplifyActionType(action.type);
  const isLogic = ['if', 'wait', 'if_then_else', 'choose', 'repeat', 'parallel', 'stop', 'wait_for_trigger'].includes(action.type);
  const category: NodeCategory = isLogic ? 'logic' : 'action';
  const defs = isLogic ? LOGIC_NODES : ACTION_NODES;
  const def = defs.find((d) => d.type === nodeType) ?? ALL_NODE_DEFINITIONS.find((d) => d.type === nodeType);
  const config = extractActionConfig(action);

  return {
    id: action.id,
    type: 'automationNode',
    position: { x, y },
    data: {
      category,
      nodeType,
      label: def?.label ?? nodeType,
      icon: def?.icon ?? 'Lightbulb',
      config: { ...config, summary: buildActionSummary(action) },
      subtitle: buildActionSummary(action) || undefined,
      isConfigured: true,
      enabled: action.enabled !== false,
    },
  };
}

function extractActionConfig(action: Action): Record<string, unknown> {
  switch (action.type) {
    case 'set_characteristic': return { accessoryId: action.accessoryId, characteristicType: action.characteristicType, value: action.value };
    case 'execute_scene': return { sceneId: action.sceneId };
    case 'delay': return { hours: action.duration.hours, minutes: action.duration.minutes, seconds: action.duration.seconds };
    case 'notify': return { message: action.message, title: action.title };
    case 'fire_event': return { eventType: action.eventType };
    case 'fire_webhook': return { url: action.url, method: action.method };
    case 'stop': return { reason: action.reason };
    case 'repeat': return { mode: action.mode, count: action.count };
    case 'wait_for_trigger': return { timeoutSeconds: action.timeout?.seconds, continueOnTimeout: action.continueOnTimeout };
    case 'if_then_else': return { expression: '' };
    case 'code': return { code: action.code, timeout: action.timeout };
    case 'merge': return { mergeMode: action.mode, combineKey: action.combineKey };
    case 'call_script': return { automationId: action.scriptId };
    default: return {};
  }
}

function buildActionSummary(action: Action): string {
  switch (action.type) {
    case 'set_characteristic': return `Set ${action.accessoryId.slice(0, 12)}… to ${action.value}`;
    case 'execute_scene': return `Run scene`;
    case 'delay': {
      const parts: string[] = [];
      if (action.duration.hours) parts.push(`${action.duration.hours}h`);
      if (action.duration.minutes) parts.push(`${action.duration.minutes}m`);
      if (action.duration.seconds) parts.push(`${action.duration.seconds}s`);
      return `Wait ${parts.join(' ')}`;
    }
    case 'notify': return action.message.slice(0, 30);
    case 'stop': return action.reason ?? 'Stop';
    case 'repeat': return action.mode === 'count' ? `Repeat ${action.count}x` : `Repeat ${action.mode}`;
    case 'fire_webhook': return `${action.method ?? 'POST'} ${action.url.slice(0, 25)}`;
    case 'wait_for_trigger': return `Timeout: ${action.timeout?.seconds ?? 30}s`;
    case 'code': return `${action.code.split('\n').length} lines`;
    case 'merge': return `${action.mode} (${action.inputIds.length} inputs)`;
    case 'call_script': return `Script ${action.scriptId.slice(0, 8)}`;
    default: return action.type;
  }
}

// ============================================================
// Edge factory
// ============================================================

function createEdge(source: string, target: string, sourceHandle?: string): Edge {
  return {
    id: `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ''}`,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    type: 'controlFlow',
  };
}
