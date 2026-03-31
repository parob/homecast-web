// Automation Editor - Constants
// Simplified node types: 3 triggers + 5 actions + 2 logic = 10 palette types
// These map to the engine's detailed types during serialization

// ============================================================
// Node Categories
// ============================================================

export type NodeCategory = 'trigger' | 'condition' | 'action' | 'logic';

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
];

// ============================================================
// All nodes (palette uses these 3 categories only)
// ============================================================

export const ALL_NODE_DEFINITIONS: NodeDefinition[] = [
  ...TRIGGER_NODES,
  ...ACTION_NODES,
  ...LOGIC_NODES,
];

export const NODE_DEFINITIONS_BY_CATEGORY: Partial<Record<NodeCategory, NodeDefinition[]>> = {
  trigger: TRIGGER_NODES,
  action: ACTION_NODES,
  logic: LOGIC_NODES,
};

export const CATEGORY_LABELS: Record<NodeCategory, string> = {
  trigger: 'Triggers',
  condition: 'Conditions',
  action: 'Actions',
  logic: 'Logic',
};

// Palette only shows these 3 categories (conditions are inside IF node)
export const PALETTE_CATEGORIES: NodeCategory[] = ['trigger', 'action', 'logic'];

// ============================================================
// Node dimensions — Node-RED rectangular style
// ============================================================

export const NODE_WIDTH = 180;
export const NODE_HEIGHT = 40;
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
  return {
    category: def.category,
    nodeType: def.type,
    label: def.label,
    icon: def.icon,
    config: {},
    isConfigured: false,
    enabled: true,
  };
}
