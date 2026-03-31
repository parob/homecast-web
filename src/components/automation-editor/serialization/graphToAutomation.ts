// Automation Editor - Graph to Automation JSON
// Converts a React Flow graph (nodes + edges) into the Automation type
// Handles mapping from simplified editor types to engine types

import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../constants';
import type {
  Automation,
  Trigger,
  ConditionBlock,
  Action,
  StateTrigger,
  NumericStateTrigger,
  TimeTrigger,
  TimePatternTrigger,
  SunTrigger,
  WebhookTrigger,
  EventTrigger,
  SystemTrigger,
  TemplateTrigger,
  StateCondition,
  NumericStateCondition,
  TimeCondition,
  SunCondition,
  TemplateCondition,
  SetCharacteristicAction,
  ExecuteSceneAction,
  DelayAction,
  NotifyAction,
  FireEventAction,
  FireWebhookAction,
  VariablesAction,
  StopAction,
  IfThenElseAction,
  RepeatAction,
  ParallelAction,
  WaitForTriggerAction,
} from '@/automation/types/automation';
import { createEmptyConditionBlock } from '@/automation/types/automation';

/**
 * Convert a React Flow graph into an Automation definition.
 * Maps simplified editor types (device_changed, schedule, etc.) to engine types.
 */
export function graphToAutomation(
  nodes: Node<FlowNodeData>[],
  edges: Edge[],
  name: string,
  homeId: string,
  existingId?: string,
): Automation {
  const triggerNodes = nodes.filter((n) => (n.data as FlowNodeData).category === 'trigger');
  const triggers: Trigger[] = triggerNodes.map((n) => nodeToTrigger(n));

  const conditions: ConditionBlock = createEmptyConditionBlock();
  const actions: Action[] = [];

  for (const triggerNode of triggerNodes) {
    const downstream = getDownstreamNodes(triggerNode.id, nodes, edges);
    for (const node of downstream) {
      const data = node.data as FlowNodeData;
      if (data.category === 'condition') {
        const condition = nodeToCondition(node);
        if (condition) conditions.conditions.push(condition);
      } else if (data.category === 'action' || data.category === 'logic') {
        const action = nodeToAction(node, nodes, edges);
        if (action) actions.push(action);
      }
    }
  }

  return {
    id: existingId ?? crypto.randomUUID(),
    name,
    homeId,
    enabled: true,
    mode: 'single',
    triggers,
    conditions,
    actions,
    metadata: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      triggerCount: 0,
    },
  };
}

function getDownstreamNodes(
  sourceId: string,
  allNodes: Node<FlowNodeData>[],
  allEdges: Edge[],
): Node<FlowNodeData>[] {
  const result: Node<FlowNodeData>[] = [];
  const visited = new Set<string>();
  const queue = [sourceId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId)) continue;
    visited.add(currentId);

    const outEdges = allEdges.filter((e) => e.source === currentId);
    for (const edge of outEdges) {
      const targetNode = allNodes.find((n) => n.id === edge.target);
      if (targetNode && !visited.has(targetNode.id)) {
        result.push(targetNode);
        queue.push(targetNode.id);
      }
    }
  }

  return result;
}

// ============================================================
// Node → Trigger (simplified → engine)
// ============================================================

function nodeToTrigger(node: Node<FlowNodeData>): Trigger {
  const data = node.data as FlowNodeData;
  const config = data.config;

  switch (data.nodeType) {
    // Simplified: device_changed → state or numeric_state
    case 'device_changed': {
      const hasThresholds = config.above !== undefined || config.below !== undefined;
      if (hasThresholds) {
        return {
          type: 'numeric_state',
          id: node.id,
          accessoryId: (config.accessoryId as string) ?? '',
          characteristicType: (config.characteristicType as string) ?? '',
          above: config.above as number | undefined,
          below: config.below as number | undefined,
        } satisfies NumericStateTrigger;
      }
      return {
        type: 'state',
        id: node.id,
        accessoryId: (config.accessoryId as string) ?? '',
        characteristicType: (config.characteristicType as string) ?? '',
        to: config.to || undefined,
        from: config.from || undefined,
      } satisfies StateTrigger;
    }

    // Simplified: schedule → time, time_pattern, or sun
    case 'schedule': {
      const mode = (config.scheduleMode as string) ?? 'time';
      if (mode === 'interval') {
        return {
          type: 'time_pattern',
          id: node.id,
          hours: config.hours as string | undefined,
          minutes: config.minutes as string | undefined,
          seconds: config.seconds as string | undefined,
        } satisfies TimePatternTrigger;
      }
      if (mode === 'sun') {
        return {
          type: 'sun',
          id: node.id,
          event: (config.event as 'sunrise' | 'sunset') ?? 'sunset',
          offset: (config.offsetMinutes as number) ? { minutes: config.offsetMinutes as number } : undefined,
        } satisfies SunTrigger;
      }
      return {
        type: 'time',
        id: node.id,
        at: (config.at as string) ?? '00:00',
        weekdays: config.weekdays as number[] | undefined,
      } satisfies TimeTrigger;
    }

    // Direct 1:1 mappings
    case 'webhook':
      return {
        type: 'webhook',
        id: node.id,
        webhookId: (config.webhookId as string) ?? '',
      } satisfies WebhookTrigger;

    // Legacy engine types (for loading existing automations)
    case 'state':
      return {
        type: 'state',
        id: node.id,
        accessoryId: (config.accessoryId as string) ?? '',
        characteristicType: (config.characteristicType as string) ?? '',
        to: config.to || undefined,
        from: config.from || undefined,
      } satisfies StateTrigger;

    case 'numeric_state':
      return {
        type: 'numeric_state',
        id: node.id,
        accessoryId: (config.accessoryId as string) ?? '',
        characteristicType: (config.characteristicType as string) ?? '',
        above: config.above as number | undefined,
        below: config.below as number | undefined,
      } satisfies NumericStateTrigger;

    case 'time':
      return {
        type: 'time',
        id: node.id,
        at: (config.at as string) ?? '00:00',
        weekdays: config.weekdays as number[] | undefined,
      } satisfies TimeTrigger;

    case 'time_pattern':
      return {
        type: 'time_pattern',
        id: node.id,
        hours: config.hours as string | undefined,
        minutes: config.minutes as string | undefined,
        seconds: config.seconds as string | undefined,
      } satisfies TimePatternTrigger;

    case 'sun':
      return {
        type: 'sun',
        id: node.id,
        event: (config.event as 'sunrise' | 'sunset') ?? 'sunset',
        offset: (config.offsetMinutes as number) ? { minutes: config.offsetMinutes as number } : undefined,
      } satisfies SunTrigger;

    case 'event':
      return { type: 'event', id: node.id, eventType: (config.eventType as string) ?? '' } satisfies EventTrigger;

    case 'system':
      return { type: 'system', id: node.id, event: (config.event as 'relay_connected' | 'relay_disconnected') ?? 'relay_connected' } satisfies SystemTrigger;

    case 'template':
      return { type: 'template', id: node.id, expression: (config.expression as string) ?? '' } satisfies TemplateTrigger;

    default:
      return { type: 'event', id: node.id, eventType: '__unknown__' };
  }
}

// ============================================================
// Node → Condition (unchanged — conditions use engine types directly)
// ============================================================

function nodeToCondition(node: Node<FlowNodeData>): StateCondition | NumericStateCondition | TimeCondition | SunCondition | TemplateCondition | null {
  const data = node.data as FlowNodeData;
  const config = data.config;

  switch (data.nodeType) {
    case 'state':
      return { type: 'state', id: node.id, accessoryId: (config.accessoryId as string) ?? '', characteristicType: (config.characteristicType as string) ?? '', value: config.value };
    case 'numeric_state':
      return { type: 'numeric_state', id: node.id, accessoryId: (config.accessoryId as string) ?? '', characteristicType: (config.characteristicType as string) ?? '', above: config.above as number | undefined, below: config.below as number | undefined };
    case 'time':
      return { type: 'time', id: node.id, after: config.after as string | undefined, before: config.before as string | undefined, weekdays: config.weekdays as number[] | undefined };
    case 'sun':
      return { type: 'sun', id: node.id };
    case 'template':
      return { type: 'template', id: node.id, expression: (config.expression as string) ?? '' };
    default:
      return null;
  }
}

// ============================================================
// Node → Action (simplified → engine)
// ============================================================

function nodeToAction(
  node: Node<FlowNodeData>,
  _allNodes: Node<FlowNodeData>[],
  _allEdges: Edge[],
): Action | null {
  const data = node.data as FlowNodeData;
  const config = data.config;

  switch (data.nodeType) {
    // Simplified types → engine types
    case 'set_device':
    case 'set_characteristic':
      return {
        type: 'set_characteristic',
        id: node.id,
        accessoryId: (config.accessoryId as string) ?? '',
        characteristicType: (config.characteristicType as string) ?? '',
        value: config.value,
      } satisfies SetCharacteristicAction;

    case 'run_scene':
    case 'execute_scene':
      return {
        type: 'execute_scene',
        id: node.id,
        sceneId: (config.sceneId as string) ?? '',
      } satisfies ExecuteSceneAction;

    case 'delay':
      return {
        type: 'delay',
        id: node.id,
        duration: {
          hours: config.hours as number | undefined,
          minutes: config.minutes as number | undefined,
          seconds: config.seconds as number | undefined,
        },
      } satisfies DelayAction;

    case 'notify':
      return {
        type: 'notify',
        id: node.id,
        message: (config.message as string) ?? '',
        title: config.title as string | undefined,
      } satisfies NotifyAction;

    case 'http_request':
    case 'fire_webhook':
      return {
        type: 'fire_webhook',
        id: node.id,
        url: (config.url as string) ?? '',
        method: config.method as 'GET' | 'POST' | 'PUT' | 'DELETE' | undefined,
      } satisfies FireWebhookAction;

    case 'if':
    case 'if_then_else':
      return {
        type: 'if_then_else',
        id: node.id,
        condition: createEmptyConditionBlock(),
        then: [],
        else: [],
      } satisfies IfThenElseAction;

    case 'wait':
    case 'wait_for_trigger':
      return {
        type: 'wait_for_trigger',
        id: node.id,
        triggers: [],
        timeout: (config.timeoutSeconds as number) ? { seconds: config.timeoutSeconds as number } : undefined,
        continueOnTimeout: (config.continueOnTimeout as boolean) ?? true,
      } satisfies WaitForTriggerAction;

    // Legacy engine types (direct passthrough)
    case 'fire_event':
      return { type: 'fire_event', id: node.id, eventType: (config.eventType as string) ?? '' } satisfies FireEventAction;
    case 'variables':
      return { type: 'variables', id: node.id, variables: (config.variables as Record<string, unknown>) ?? {} } satisfies VariablesAction;
    case 'stop':
      return { type: 'stop', id: node.id, reason: config.reason as string | undefined } satisfies StopAction;
    case 'repeat':
      return { type: 'repeat', id: node.id, mode: (config.mode as 'count' | 'while' | 'until' | 'for_each') ?? 'count', count: config.count as number | undefined, sequence: [] } satisfies RepeatAction;
    case 'parallel':
      return { type: 'parallel', id: node.id, branches: [] } satisfies ParallelAction;

    default:
      return null;
  }
}
