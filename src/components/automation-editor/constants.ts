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

// Category visual config — Node-RED style: colored left border
export const CATEGORY_STYLES: Record<NodeCategory, {
  borderColor: string; // For node left border (border-l-4)
  iconBg: string;      // For palette icon background
  text: string;
  miniMapColor: string;
}> = {
  trigger: {
    borderColor: 'border-l-emerald-500',
    iconBg: 'bg-emerald-100 text-emerald-600',
    text: 'text-emerald-700',
    miniMapColor: '#10b981',
  },
  condition: {
    borderColor: 'border-l-amber-500',
    iconBg: 'bg-amber-100 text-amber-600',
    text: 'text-amber-700',
    miniMapColor: '#f59e0b',
  },
  action: {
    borderColor: 'border-l-blue-500',
    iconBg: 'bg-blue-100 text-blue-600',
    text: 'text-blue-700',
    miniMapColor: '#3b82f6',
  },
  logic: {
    borderColor: 'border-l-purple-500',
    iconBg: 'bg-purple-100 text-purple-600',
    text: 'text-purple-700',
    miniMapColor: '#a855f7',
  },
  annotation: {
    borderColor: 'border-l-amber-400',
    iconBg: 'bg-amber-100 text-amber-600',
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
export const GRID_SIZE = 16;

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
