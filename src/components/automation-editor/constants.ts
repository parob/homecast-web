// Automation Editor - Constants
// Simplified node types: 3 triggers + 5 actions + 2 logic = 10 palette types
// These map to the engine's detailed types during serialization

// ============================================================
// Node Categories
// ============================================================

export type NodeCategory = 'trigger' | 'condition' | 'action' | 'logic' | 'annotation';

export interface NodeDefinition {
  type: string;
  label: string;
  icon: string; // lucide icon name
  category: NodeCategory;
  description: string;
}

// Category visual config
export const CATEGORY_STYLES: Record<NodeCategory, {
  iconBg: string;      // Icon circle background
  iconColor: string;   // Icon color
  text: string;
  miniMapColor: string;
}> = {
  trigger: {
    iconBg: 'bg-emerald-500',
    iconColor: 'text-white',
    text: 'text-emerald-700',
    miniMapColor: '#10b981',
  },
  condition: {
    iconBg: 'bg-amber-500',
    iconColor: 'text-white',
    text: 'text-amber-700',
    miniMapColor: '#f59e0b',
  },
  action: {
    iconBg: 'bg-blue-500',
    iconColor: 'text-white',
    text: 'text-blue-700',
    miniMapColor: '#3b82f6',
  },
  logic: {
    iconBg: 'bg-purple-500',
    iconColor: 'text-white',
    text: 'text-purple-700',
    miniMapColor: '#a855f7',
  },
  annotation: {
    iconBg: 'bg-amber-400',
    iconColor: 'text-white',
    text: 'text-amber-700',
    miniMapColor: '#f59e0b',
  },
};

// ============================================================
// Triggers (3 simplified types)
// ============================================================

export const TRIGGER_NODES: NodeDefinition[] = [
  {
    type: 'device_changed',
    label: 'Device Changed',
    icon: 'Zap',
    category: 'trigger',
    description: 'When a device state changes (on/off, brightness, temperature, etc.)',
  },
  {
    type: 'schedule',
    label: 'Schedule',
    icon: 'Clock',
    category: 'trigger',
    description: 'At a specific time, repeating interval, or sunrise/sunset',
  },
  {
    type: 'webhook',
    label: 'Webhook',
    icon: 'Globe',
    category: 'trigger',
    description: 'When an HTTP request is received',
  },
  {
    type: 'error',
    label: 'Error',
    icon: 'AlertCircle',
    category: 'trigger',
    description: 'When another automation fails',
  },
  {
    type: 'device_offline',
    label: 'Device Offline',
    icon: 'WifiOff',
    category: 'trigger',
    description: 'When a device stops responding — Apple Home cannot detect this at all',
  },
];

// ============================================================
// Actions (5 simplified types)
// ============================================================

export const ACTION_NODES: NodeDefinition[] = [
  {
    type: 'set_device',
    label: 'Set Device',
    icon: 'Lightbulb',
    category: 'action',
    description: 'Control a HomeKit device (turn on, set brightness, etc.)',
  },
  {
    type: 'run_scene',
    label: 'Run Scene',
    icon: 'Play',
    category: 'action',
    description: 'Execute a HomeKit scene',
  },
  {
    type: 'delay',
    label: 'Delay',
    icon: 'Timer',
    category: 'action',
    description: 'Wait for a specified duration',
  },
  {
    type: 'notify',
    label: 'Notify',
    icon: 'Bell',
    category: 'action',
    description: 'Send a push notification',
  },
  {
    type: 'http_request',
    label: 'HTTP Request',
    icon: 'Send',
    category: 'action',
    description: 'Make an HTTP request to any URL',
  },
  {
    type: 'code',
    label: 'Code',
    icon: 'Code',
    category: 'action',
    description: 'Run custom JavaScript to transform data',
  },
  // NOTE: the `helper` action (virtual switches, modes, counters, timers) is
  // implemented end-to-end in the engine, serializes both ways, and persists —
  // but it is deliberately NOT in the palette yet. There is no UI to *create* a
  // helper definition, so the node would reference helpers a user cannot make.
  // Add it here alongside the helper-management screen.
];

// ============================================================
// Logic (2 simplified types)
// ============================================================

export const LOGIC_NODES: NodeDefinition[] = [
  {
    type: 'if',
    label: 'IF',
    icon: 'GitBranch',
    category: 'logic',
    description: 'Split flow based on a condition (true/false outputs)',
  },
  {
    type: 'wait',
    label: 'Wait',
    icon: 'Pause',
    category: 'logic',
    description: 'Pause until a device changes or a timeout',
  },
  {
    type: 'merge',
    label: 'Merge',
    icon: 'GitMerge',
    category: 'logic',
    description: 'Combine data from multiple branches',
  },
  {
    type: 'sub_workflow',
    label: 'Sub-workflow',
    icon: 'Workflow',
    category: 'logic',
    description: 'Execute another automation as a sub-flow',
  },
  // The engine has always executed these; they were simply never in the palette.
  {
    type: 'repeat',
    label: 'Repeat',
    icon: 'Repeat',
    category: 'logic',
    description: 'Loop a sequence — a fixed count, over a list, or while a condition holds',
  },
  {
    type: 'choose',
    label: 'Choose',
    icon: 'ListTree',
    category: 'logic',
    description: 'Pick the first matching branch out of many (multi-way IF)',
  },
  {
    type: 'parallel',
    label: 'Parallel',
    icon: 'Split',
    category: 'logic',
    description: 'Run several branches at the same time',
  },
  {
    type: 'variables',
    label: 'Set Variable',
    icon: 'Variable',
    category: 'logic',
    description: 'Store a value for later steps to reference',
  },
  {
    type: 'stop',
    label: 'Stop',
    icon: 'CircleStop',
    category: 'logic',
    description: 'End the automation here',
  },
];

// ============================================================
// Annotations (editor-only, not serialized)
// ============================================================

export const ANNOTATION_NODES: NodeDefinition[] = [
  {
    type: 'sticky_note',
    label: 'Sticky Note',
    icon: 'StickyNote',
    category: 'annotation',
    description: 'Add a note to the canvas (not part of the automation)',
  },
];

// ============================================================
// All nodes
// ============================================================

export const ALL_NODE_DEFINITIONS: NodeDefinition[] = [
  ...TRIGGER_NODES,
  ...ACTION_NODES,
  ...LOGIC_NODES,
  ...ANNOTATION_NODES,
];

export const NODE_DEFINITIONS_BY_CATEGORY: Partial<Record<NodeCategory, NodeDefinition[]>> = {
  trigger: TRIGGER_NODES,
  action: ACTION_NODES,
  logic: LOGIC_NODES,
  annotation: ANNOTATION_NODES,
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: 'Triggers',
  condition: 'Conditions',
  action: 'Actions',
  logic: 'Logic',
  annotation: 'Annotations',
};

// Palette categories
export const PALETTE_CATEGORIES: NodeCategory[] = ['trigger', 'action', 'logic', 'annotation'];

// ============================================================
// Node dimensions — Node-RED rectangular style
// ============================================================

export const NODE_WIDTH = 220;
export const NODE_HEIGHT = 40; // Minimum height — expands with subtitle

// ============================================================
// Flow node data shape (stored in React Flow node.data)
// ============================================================

export interface FlowNodeData {
  category: NodeCategory;
  nodeType: string;
  label: string;
  icon: string;
  config: Record<string, unknown>;
  isConfigured: boolean;
  enabled: boolean;
  // Display
  subtitle?: string;
  // Execution state
  executionState?: 'idle' | 'running' | 'completed' | 'failed' | 'skipped';
  executionTime?: number;
  executionError?: string;
}

export function createDefaultNodeData(def: NodeDefinition): FlowNodeData {
  // Default config for specific node types
  const defaultConfigs: Record<string, Record<string, unknown>> = {
    webhook: { webhookId: crypto.randomUUID().slice(0, 8) },
  };

  return {
    category: def.category,
    nodeType: def.type,
    label: def.label,
    icon: def.icon,
    config: defaultConfigs[def.type] ?? {},
    isConfigured: false,
    enabled: true,
  };
}

// ============================================================
// Node output schemas (for data flow — what each node produces)
// Used by IF node data picker to show available upstream fields
// ============================================================

export interface NodeOutputField {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'unknown';
  label: string;
}

export const NODE_OUTPUT_SCHEMAS: Record<string, NodeOutputField[]> = {
  // Triggers
  device_changed: [
    { field: 'from_value', type: 'unknown', label: 'Previous Value' },
    { field: 'to_value', type: 'unknown', label: 'New Value' },
    { field: 'accessoryId', type: 'string', label: 'Accessory ID' },
    { field: 'serviceGroupId', type: 'string', label: 'Service Group ID' },
    { field: 'characteristicType', type: 'string', label: 'Characteristic' },
    { field: 'timestamp', type: 'number', label: 'Timestamp' },
  ],
  schedule: [
    { field: 'type', type: 'string', label: 'Trigger Type' },
    { field: 'timestamp', type: 'number', label: 'Timestamp' },
  ],
  webhook: [
    { field: 'webhookPayload', type: 'object', label: 'Request Body' },
    { field: 'timestamp', type: 'number', label: 'Timestamp' },
  ],
  error: [
    { field: 'eventData', type: 'object', label: 'Error Details' },
    { field: 'timestamp', type: 'number', label: 'Timestamp' },
  ],
  // Actions
  set_device: [
    { field: 'accessoryId', type: 'string', label: 'Accessory ID' },
    { field: 'characteristicType', type: 'string', label: 'Characteristic' },
    { field: 'value', type: 'unknown', label: 'Value Set' },
    { field: 'success', type: 'boolean', label: 'Success' },
  ],
  run_scene: [
    { field: 'sceneId', type: 'string', label: 'Scene ID' },
    { field: 'success', type: 'boolean', label: 'Success' },
  ],
  delay: [
    { field: 'durationMs', type: 'number', label: 'Duration (ms)' },
  ],
  notify: [
    { field: 'message', type: 'string', label: 'Message' },
    { field: 'success', type: 'boolean', label: 'Success' },
  ],
  http_request: [
    { field: 'status', type: 'number', label: 'HTTP Status' },
    { field: 'statusText', type: 'string', label: 'Status Text' },
    { field: 'body', type: 'object', label: 'Response Body' },
    { field: 'headers', type: 'object', label: 'Response Headers' },
    { field: 'ok', type: 'boolean', label: 'Success (2xx)' },
  ],
  code: [
    { field: 'result', type: 'unknown', label: 'Return Value' },
  ],
  // Logic
  if: [
    { field: 'branch', type: 'string', label: 'Branch Taken' },
    { field: 'result', type: 'boolean', label: 'Condition Result' },
  ],
  wait: [
    { field: 'triggered', type: 'boolean', label: 'Was Triggered' },
    { field: 'triggerData', type: 'object', label: 'Trigger Data' },
  ],
  merge: [
    { field: 'merged', type: 'object', label: 'Merged Data' },
    { field: 'inputCount', type: 'number', label: 'Input Count' },
  ],
  sub_workflow: [
    { field: 'response', type: 'object', label: 'Sub-workflow Result' },
  ],
};

/**
 * Has this node been given everything it needs to run?
 *
 * Drives the dashed outline on the canvas and the save-time warning, and is
 * shared with deserialization so an automation saved incomplete still shows as
 * incomplete when it is reopened — rather than being marked configured on the
 * way back in and hiding the very problem that broke it.
 */
export function isNodeConfigured(nodeType: string, category: string, config: Record<string, unknown>): boolean {
  if (category === 'trigger') {
    switch (nodeType) {
      case 'device_changed': return !!((config.accessoryId || config.serviceGroupId) && config.characteristicType);
      case 'schedule': {
        const mode = (config.scheduleMode as string) ?? 'time';
        if (mode === 'time') return !!config.at;
        if (mode === 'interval') return !!(config.hours || config.minutes);
        if (mode === 'sun') return !!config.event;
        return false;
      }
      case 'webhook': return !!config.webhookId;
      case 'device_offline': return !!config.accessoryId;
    }
  }
  if (category === 'action') {
    switch (nodeType) {
      // The value counts. Without it this node saved as "configured", drew
      // solid on the canvas and raised no save warning, yet stored no value at
      // all and failed the moment it ran. `0` is a real value, so test for
      // presence rather than truthiness.
      case 'set_device': return !!((config.accessoryId || config.serviceGroupId) && config.characteristicType)
        && config.value !== undefined && config.value !== null && config.value !== '';
      case 'run_scene': return !!config.sceneId;
      case 'delay': return !!((config.hours as number) || (config.minutes as number) || (config.seconds as number));
      case 'notify': return !!config.message;
      case 'http_request': return !!config.url;
      case 'code': return !!config.code;
    }
  }
  if (category === 'condition') {
    switch (nodeType) {
      case 'state': return !!(config.accessoryId && config.characteristicType);
      case 'time': return !!(config.after || config.before);
      case 'template': return !!config.expression;
    }
  }
  if (category === 'logic') {
    if (nodeType === 'sub_workflow') return !!config.automationId;
    if (nodeType === 'repeat') {
      return ((config.mode as string) ?? 'count') !== 'count' || !!(config.count as number);
    }
    if (nodeType === 'variables') {
      const vars = config.variables;
      return !!vars && typeof vars === 'object' && Object.keys(vars as Record<string, unknown>).length > 0;
    }
    return true;
  }
  return false;
}
