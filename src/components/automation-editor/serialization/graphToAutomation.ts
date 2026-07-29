// Automation Editor - Graph to Automation JSON
// Converts a React Flow graph (nodes + edges) into the Automation type
// Handles mapping from simplified editor types to engine types

import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../constants';
import { isValidNotificationIcon, isNotificationIconColor } from '../notificationIcons';
import type {
  Automation,
  AutomationUIState,
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
  SetServiceGroupAction,
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
  CodeAction,
  MergeAction,
  HelperAction,
  ChooseAction,
  Duration,
  DeviceAvailabilityTrigger,
  CallScriptAction,
} from '@/automation/types/automation';
import { createEmptyConditionBlock } from '@/automation/types/automation';
import { CHOOSE_BY_TRIGGER_PREFIX, TRIGGER_GATE_PREFIX } from '@/automation/trigger-branches';

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

  // What each trigger actually leads to, kept apart per trigger.
  const branches = triggerNodes.map((triggerNode) => {
    const branchConditions: ConditionBlock = createEmptyConditionBlock();
    const branchActions: Action[] = [];

    for (const node of getDownstreamNodes(triggerNode.id, nodes, edges)) {
      const data = node.data as FlowNodeData;
      if (data.category === 'condition') {
        const condition = nodeToCondition(node);
        if (condition) branchConditions.conditions.push(condition);
      } else if (data.category === 'action' || data.category === 'logic') {
        const action = nodeToAction(node, nodes, edges);
        if (action) branchActions.push(action);
      }
    }

    return { triggerId: triggerNode.id, conditions: branchConditions, actions: branchActions };
  });

  const { conditions, actions } = combineBranches(branches);

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
    uiState: buildUIState(nodes, edges),
  };
}

function buildUIState(nodes: Node<FlowNodeData>[], edges: Edge[]): AutomationUIState {
  const nodePositions: Record<string, { x: number; y: number }> = {};
  for (const n of nodes) {
    nodePositions[n.id] = { x: n.position.x, y: n.position.y };
  }

  const savedEdges = edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle ?? null,
    targetHandle: e.targetHandle ?? null,
  }));

  const stickyNotes = nodes
    .filter((n) => n.type === 'stickyNote')
    .map((n) => ({
      id: n.id,
      position: { x: n.position.x, y: n.position.y },
      text: ((n.data as FlowNodeData).config.text as string) ?? '',
      width: typeof n.width === 'number' ? n.width : undefined,
      height: typeof n.height === 'number' ? n.height : undefined,
    }));

  return { nodePositions, edges: savedEdges, stickyNotes };
}

interface TriggerBranch {
  triggerId: string;
  conditions: ConditionBlock;
  actions: Action[];
}

/** Stable key for "these two branches do the same thing". */
function branchShape(branch: TriggerBranch): string {
  return JSON.stringify([branch.conditions, branch.actions]);
}

/**
 * Fold each trigger's branch into the automation's single action list.
 *
 * An automation has one action list, but the canvas lets you draw a separate
 * chain from each trigger — "lights on → notify 'on'", "lights off → notify
 * 'off'". Those used to be concatenated, losing which trigger owned which
 * chain, so *every* trigger ran *every* action: switching the lights on sent
 * both notifications and ran both branches' device writes. Conditions were
 * merged into one AND block the same way, so a condition drawn on one branch
 * silently gated the others.
 *
 * When the branches differ they become a `choose`, one arm per trigger, gated
 * on a `trigger` condition — which is exactly what the engine's TriggerCondition
 * is for. Arms are mutually exclusive, and `choose` runs the first match, so
 * exactly one arm runs. A single trigger, or several triggers that all lead to
 * the same chain, still serialize flat: no need to wrap the common case.
 */
function combineBranches(branches: TriggerBranch[]): { conditions: ConditionBlock; actions: Action[] } {
  const withWork = branches.filter((b) => b.actions.length > 0 || b.conditions.conditions.length > 0);

  if (withWork.length === 0) return { conditions: createEmptyConditionBlock(), actions: [] };
  if (withWork.length === 1) return { conditions: withWork[0].conditions, actions: withWork[0].actions };

  // Every trigger leads to the same chain — the ordinary "any of these events"
  // automation. Keep it flat so the saved shape stays readable and unchanged.
  const shapes = new Set(withWork.map(branchShape));
  if (shapes.size === 1) return { conditions: withWork[0].conditions, actions: withWork[0].actions };

  const choose: ChooseAction = {
    type: 'choose',
    id: `${CHOOSE_BY_TRIGGER_PREFIX}${withWork[0].triggerId}`,
    choices: withWork.map((branch) => ({
      alias: `Trigger ${branch.triggerId}`,
      conditions: {
        operator: 'and',
        conditions: [
          { type: 'trigger', id: `${TRIGGER_GATE_PREFIX}${branch.triggerId}`, triggerId: branch.triggerId },
          ...branch.conditions.conditions,
        ],
      },
      actions: branch.actions,
    })),
  };

  // Top-level conditions stay empty: each branch carries its own, and hoisting
  // them here is what made one branch's condition gate all the others.
  return { conditions: createEmptyConditionBlock(), actions: [choose] };
}

function getDownstreamNodes(
  sourceId: string,
  allNodes: Node<FlowNodeData>[],
  allEdges: Edge[],
): Node<FlowNodeData>[] {
  const result: Node<FlowNodeData>[] = [];
  const visited = new Set<string>([sourceId]);
  const queue = [sourceId];

  while (queue.length > 0) {
    const currentId = queue.shift()!;

    const outEdges = allEdges.filter((e) => e.source === currentId);
    for (const edge of outEdges) {
      if (visited.has(edge.target)) continue;
      visited.add(edge.target);

      const targetNode = allNodes.find((n) => n.id === edge.target);
      if (targetNode) {
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

/**
 * Read the "for" duration off a trigger node's config, returning undefined when
 * it's absent or zero so we don't write an empty duration into the automation.
 */
function buildForDuration(config: Record<string, unknown>): Duration | undefined {
  const hours = Number(config.forHours ?? 0) || 0;
  const minutes = Number(config.forMinutes ?? 0) || 0;
  const seconds = Number(config.forSeconds ?? 0) || 0;
  if (!hours && !minutes && !seconds) return undefined;
  return {
    ...(hours ? { hours } : {}),
    ...(minutes ? { minutes } : {}),
    ...(seconds ? { seconds } : {}),
  };
}

function nodeToTrigger(node: Node<FlowNodeData>): Trigger {
  const data = node.data as FlowNodeData;
  const config = data.config;

  switch (data.nodeType) {
    // Simplified: device_changed → state or numeric_state
    case 'device_changed': {
      const isGroup = !!config.serviceGroupId;
      const hasThresholds = config.above !== undefined || config.below !== undefined;
      // "…and stays that way for N" — the engine cancels the pending fire if the
      // value reverts first, which is what makes "left open for 5 minutes" work.
      const forDuration = buildForDuration(config);
      if (hasThresholds) {
        return {
          type: 'numeric_state',
          id: node.id,
          ...(isGroup
            ? { serviceGroupId: config.serviceGroupId as string }
            : { accessoryId: (config.accessoryId as string) ?? '' }
          ),
          characteristicType: (config.characteristicType as string) ?? '',
          above: config.above as number | undefined,
          below: config.below as number | undefined,
          ...(forDuration ? { for: forDuration } : {}),
        } satisfies NumericStateTrigger;
      }
      return {
        type: 'state',
        id: node.id,
        ...(isGroup
          ? { serviceGroupId: config.serviceGroupId as string }
          : { accessoryId: (config.accessoryId as string) ?? '' }
        ),
        characteristicType: (config.characteristicType as string) ?? '',
        to: config.to ?? undefined,
        from: config.from ?? undefined,
        ...(forDuration ? { for: forDuration } : {}),
      } satisfies StateTrigger;
    }

    case 'device_offline':
      return {
        type: 'device_availability',
        id: node.id,
        accessoryId: (config.accessoryId as string) ?? '',
        to: (config.availability as 'unavailable' | 'available') ?? 'unavailable',
        ...(buildForDuration(config) ? { for: buildForDuration(config)! } : {}),
      } satisfies DeviceAvailabilityTrigger;

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

    case 'error':
      return {
        type: 'event',
        id: node.id,
        eventType: 'automation.error',
      } satisfies EventTrigger;

    // Legacy engine types (for loading existing automations)
    case 'state':
      return {
        type: 'state',
        id: node.id,
        accessoryId: (config.accessoryId as string) ?? '',
        characteristicType: (config.characteristicType as string) ?? '',
        to: config.to ?? undefined,
        from: config.from ?? undefined,
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

  const action = nodeToActionInner(node, _allNodes, _allEdges);
  if (!action) return null;

  // Apply common action fields from config
  if (config.onError && config.onError !== 'stop') {
    (action as any).onError = config.onError;
  }
  if (config.maxRetries != null) (action as any).maxRetries = config.maxRetries;
  if (config.retryDelayMs != null) (action as any).retryDelayMs = config.retryDelayMs;
  if (!data.enabled) (action as any).enabled = false;

  return action;
}

function nodeToActionInner(
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
      // If serviceGroupId is set, use set_service_group action
      if (config.serviceGroupId) {
        return {
          type: 'set_service_group',
          id: node.id,
          groupId: config.serviceGroupId as string,
          characteristicType: (config.characteristicType as string) ?? '',
          value: config.value,
        } satisfies SetServiceGroupAction;
      }
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

    case 'notify': {
      const actions = config.actions as Array<{ action: string; title: string }> | undefined;
      const data: Record<string, unknown> | undefined =
        actions && actions.length > 0 ? { actions } : undefined;
      // Re-checked here and not only in the config panel: a blueprint or an
      // imported automation reaches this function without ever passing through
      // the form, and an icon is a string that ends up in a URL.
      const icon = config.icon as string | undefined;
      const iconColor = config.iconColor as string | undefined;
      return {
        type: 'notify',
        id: node.id,
        message: (config.message as string) ?? '',
        title: config.title as string | undefined,
        icon: icon && isValidNotificationIcon(icon) ? icon : undefined,
        iconColor: iconColor && isNotificationIconColor(iconColor) ? iconColor : undefined,
        data,
      } satisfies NotifyAction;
    }

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
    case 'code':
      return { type: 'code', id: node.id, code: (config.code as string) ?? '', timeout: config.timeout as number | undefined } satisfies CodeAction;
    case 'helper':
      return {
        type: 'helper',
        id: node.id,
        helperId: (config.helperId as string) ?? '',
        operation: (config.operation as HelperAction['operation']) ?? 'toggle',
        value: config.value,
        duration: config.duration as HelperAction['duration'],
        step: config.step as number | undefined,
      } satisfies HelperAction;
    case 'choose':
      // Branch actions are attached from the graph edges, as with if/repeat.
      return { type: 'choose', id: node.id, choices: [] } satisfies ChooseAction;
    case 'sub_workflow':
      return { type: 'call_script', id: node.id, scriptId: (config.automationId as string) ?? '' } satisfies CallScriptAction;
    case 'merge': {
      // Derive inputIds from edges targeting this node
      const inputIds = _allEdges
        .filter((e) => e.target === node.id)
        .map((e) => e.source);
      return {
        type: 'merge',
        id: node.id,
        mode: (config.mergeMode as 'append' | 'combine' | 'wait_all') ?? 'append',
        combineKey: config.combineKey as string | undefined,
        inputIds,
      } satisfies MergeAction;
    }

    default:
      return null;
  }
}
