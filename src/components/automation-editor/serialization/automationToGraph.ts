// Automation Editor - Automation JSON to React Flow Graph
// Converts an Automation definition into nodes + edges for rendering
// Maps engine types → simplified editor types (device_changed, schedule, etc.)

import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData, NodeCategory } from '../constants';
import { resolveEntityName, characteristicLabel, characteristicValueLabel, type EntityNameSource } from '../entity-labels';
import type {
  Automation,
  Trigger,
  Condition,
  ConditionBlock,
  Action,
} from '@/automation/types/automation';
import { isConditionBlock } from '@/automation/types/automation';
import { CHOOSE_BY_TRIGGER_PREFIX } from './graphToAutomation';
import { TRIGGER_NODES, ACTION_NODES, LOGIC_NODES, ANNOTATION_NODES, ALL_NODE_DEFINITIONS, isNodeConfigured } from '../constants';

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
    case 'device_availability':
      return { nodeType: 'device_offline', extraConfig: {} };
    default:
      // Unknown engine types pass through as-is
      return { nodeType: engineType, extraConfig: {} };
  }
}

function simplifyActionType(engineType: string): string {
  switch (engineType) {
    case 'set_characteristic': return 'set_device';
    case 'set_service_group': return 'set_device';
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

export function automationToGraph(
  automation: Automation,
  names?: EntityNameSource,
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes: Node<FlowNodeData>[] = [];
  const autoEdges: Edge[] = [];
  let y = 50;

  // Add trigger nodes
  const triggerNodeIds: string[] = [];
  for (let i = 0; i < automation.triggers.length; i++) {
    const trigger = automation.triggers[i];
    const x = HORIZONTAL_OFFSET + i * 220;
    const node = triggerToNode(trigger, x, y, names);
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
      autoEdges.push(createEdge(triggerId, conditionNodes[0].id));
    }

    lastNodeIds = conditionNodes.map((n) => n.id);
    y += conditionNodes.length * VERTICAL_GAP;
  }

  // Add action nodes
  const { actions: topLevelActions, conditions: branchConditions } = expandTriggerBranches(automation.actions);
  if (branchConditions.length > 0) {
    const extra = conditionBlockToNodes(
      { operator: 'and', conditions: branchConditions }, HORIZONTAL_OFFSET, y,
    );
    nodes.push(...extra);
    y += extra.length * VERTICAL_GAP;
  }
  for (const action of topLevelActions) {
    const node = actionToNode(action, HORIZONTAL_OFFSET, y, names);
    nodes.push(node);

    for (const prevId of lastNodeIds) {
      autoEdges.push(createEdge(prevId, node.id, 'pass'));
    }

    lastNodeIds = [node.id];
    y += VERTICAL_GAP;
  }

  // Restore sticky notes from saved UI state
  const stickyNotes = automation.uiState?.stickyNotes ?? [];
  for (const note of stickyNotes) {
    nodes.push(stickyNoteToNode(note));
  }

  // Override positions from saved UI state (if any)
  const savedPositions = automation.uiState?.nodePositions;
  if (savedPositions) {
    for (const n of nodes) {
      const pos = savedPositions[n.id];
      if (pos) n.position = { x: pos.x, y: pos.y };
    }
  }

  // Prefer saved edges over auto-generated ones
  const savedEdges = automation.uiState?.edges;
  const edges: Edge[] = savedEdges && savedEdges.length > 0
    ? savedEdges.map((e) => createEdge(e.source, e.target, e.sourceHandle ?? undefined, e.id))
    : autoEdges;

  return { nodes, edges };
}

function stickyNoteToNode(note: {
  id: string;
  position: { x: number; y: number };
  text: string;
  width?: number;
  height?: number;
}): Node<FlowNodeData> {
  const def = ANNOTATION_NODES.find((d) => d.type === 'sticky_note');
  return {
    id: note.id,
    type: 'stickyNote',
    position: note.position,
    width: note.width,
    height: note.height,
    data: {
      category: 'annotation',
      nodeType: 'sticky_note',
      label: def?.label ?? 'Sticky Note',
      icon: def?.icon ?? 'StickyNote',
      config: { text: note.text },
      isConfigured: true,
      enabled: true,
    },
  };
}

// ============================================================
// Trigger → Node (engine → simplified)
// ============================================================

function triggerToNode(trigger: Trigger, x: number, y: number, names?: EntityNameSource): Node<FlowNodeData> {
  const { nodeType, extraConfig } = simplifyTriggerType(trigger.type);
  const def = TRIGGER_NODES.find((d) => d.type === nodeType) ?? ALL_NODE_DEFINITIONS.find((d) => d.type === nodeType);
  const config = { ...extractTriggerConfig(trigger), ...extraConfig };
  const summary = buildTriggerSummary(trigger, nodeType, names);

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
      isConfigured: isNodeConfigured(nodeType, 'trigger', config),
      enabled: trigger.enabled !== false,
    },
  };
}

/** Spread a trigger's "for" duration back into flat config fields for the form. */
function forConfig(duration?: { hours?: number; minutes?: number; seconds?: number }) {
  if (!duration) return {};
  return {
    forHours: duration.hours,
    forMinutes: duration.minutes,
    forSeconds: duration.seconds,
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
      // Derive filterMode from saved trigger data
      filterMode: trigger.to != null ? 'value' : 'any',
      ...forConfig(trigger.for),
    };
    case 'numeric_state': return {
      accessoryId: trigger.accessoryId,
      serviceGroupId: trigger.serviceGroupId,
      sourceMode: trigger.serviceGroupId ? 'group' : 'device',
      characteristicType: trigger.characteristicType,
      above: trigger.above,
      below: trigger.below,
      // Derive filterMode from saved trigger data
      filterMode: (trigger.above != null && trigger.below != null) ? 'range' : trigger.above != null ? 'above' : trigger.below != null ? 'below' : 'any',
      ...forConfig(trigger.for),
    };
    case 'device_availability': return {
      accessoryId: trigger.accessoryId,
      availability: trigger.to,
      ...forConfig(trigger.for),
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

function buildTriggerSummary(trigger: Trigger, _nodeType: string, names?: EntityNameSource): string {
  switch (trigger.type) {
    case 'state': {
      const entity = resolveEntityName(names, {
        accessoryId: trigger.accessoryId,
        serviceGroupId: trigger.serviceGroupId,
      });
      const char = characteristicLabel(trigger.characteristicType);
      // Include the target value, and read it the way a person would ("On",
      // not 1). The edit-time summary already showed a value; omitting it here
      // meant the same node relabelled itself the moment you opened it.
      const to = characteristicValueLabel(trigger.characteristicType, trigger.to);
      const head = char ? `${entity} / ${char}` : entity;
      return to ? `${head} → ${to}` : head;
    }
    case 'numeric_state': {
      const parts: string[] = [resolveEntityName(names, {
        accessoryId: trigger.accessoryId,
        serviceGroupId: trigger.serviceGroupId,
      })];
      const char = characteristicLabel(trigger.characteristicType);
      if (char) parts.push(`/ ${char}`);
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

/**
 * Undo the per-trigger `choose` that graphToAutomation adds.
 *
 * That wrapper is a transport detail: an automation has one action list, so
 * separate per-trigger chains have to be folded into one, and `choose` gated on
 * a `trigger` condition is how. It must not survive back onto the canvas.
 * Without this the editor drew a "Choose (2 branches)" node nobody added, on top
 * of the triggers, and every real action node vanished — they were nested
 * inside it. The user's own layout and wiring come back from `uiState`, so all
 * that is needed here is that each action node exists under its original id.
 *
 * Only unwraps the synthesised one, identified by its id prefix. A `choose` the
 * user dragged in from the palette has a random uuid and is left alone.
 */
function expandTriggerBranches(actions: Action[]): { actions: Action[]; conditions: Condition[] } {
  const only = actions.length === 1 ? actions[0] : undefined;
  if (!only || only.type !== 'choose' || !only.id.startsWith(CHOOSE_BY_TRIGGER_PREFIX)) {
    return { actions, conditions: [] };
  }

  const expanded: Action[] = [];
  const conditions: Condition[] = [];
  for (const choice of only.choices) {
    expanded.push(...choice.actions);
    for (const c of choice.conditions.conditions) {
      // Drop the synthetic gate; keep conditions the user actually drew. Their
      // per-branch wiring is restored from uiState's edges, and re-saving
      // re-derives the branches from the graph.
      if (!isConditionBlock(c) && c.type === 'trigger' && c.id.startsWith('trigger-is-')) continue;
      conditions.push(c as Condition);
    }
  }
  return { actions: expanded, conditions };
}

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

function actionToNode(action: Action, x: number, y: number, names?: EntityNameSource): Node<FlowNodeData> {
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
      subtitle: buildActionSummary(action, names) || undefined,
      // Recomputed, not assumed. Marking everything configured on the way back
      // in hid incomplete actions — a Set Device saved with no value reopened
      // looking fine and kept failing.
      isConfigured: isNodeConfigured(nodeType, category, config),
      enabled: action.enabled !== false,
    },
  };
}

function extractActionConfig(action: Action): Record<string, unknown> {
  switch (action.type) {
    case 'set_characteristic': return { accessoryId: action.accessoryId, characteristicType: action.characteristicType, value: action.value };
    case 'set_service_group': return { serviceGroupId: action.groupId, characteristicType: action.characteristicType, value: action.value };
    case 'execute_scene': return { sceneId: action.sceneId };
    case 'delay': return { hours: action.duration.hours, minutes: action.duration.minutes, seconds: action.duration.seconds };
    case 'notify': return { message: action.message, title: action.title, actions: action.data?.actions };
    case 'fire_event': return { eventType: action.eventType };
    case 'fire_webhook': return { url: action.url, method: action.method };
    case 'stop': return { reason: action.reason };
    case 'repeat': return { mode: action.mode, count: action.count };
    case 'wait_for_trigger': return { timeoutSeconds: action.timeout?.seconds, continueOnTimeout: action.continueOnTimeout };
    case 'if_then_else': return { expression: '' };
    case 'code': return { code: action.code, timeout: action.timeout };
    case 'merge': return { mergeMode: action.mode, combineKey: action.combineKey };
    case 'call_script': return { automationId: action.scriptId };
    case 'helper': return {
      helperId: action.helperId,
      operation: action.operation,
      value: action.value,
      duration: action.duration,
      step: action.step,
    };
    case 'variables': return { variables: action.variables };
    default: return {};
  }
}

function buildActionSummary(action: Action, names?: EntityNameSource): string {
  switch (action.type) {
    case 'set_characteristic':
      return `Set ${resolveEntityName(names, { accessoryId: action.accessoryId })} to ${characteristicValueLabel(action.characteristicType, action.value)}`;
    case 'set_service_group':
      return `Set ${resolveEntityName(names, { serviceGroupId: action.groupId })} to ${characteristicValueLabel(action.characteristicType, action.value)}`;
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
    case 'helper': return `${action.operation.replace(/_/g, ' ')} ${action.helperId}`;
    case 'variables': return Object.keys(action.variables).join(', ');
    case 'choose': return `${action.choices.length} branches`;
    case 'parallel': return `${action.branches.length} branches`;
    default: return action.type;
  }
}

// ============================================================
// Edge factory
// ============================================================

function createEdge(source: string, target: string, sourceHandle?: string, id?: string): Edge {
  return {
    id: id ?? `${source}-${target}${sourceHandle ? `-${sourceHandle}` : ''}`,
    source,
    target,
    sourceHandle: sourceHandle ?? undefined,
    type: 'controlFlow',
  };
}
