// Automation Editor - Built-in Templates
// Pre-built automation flow templates that pre-populate the editor canvas

import type { Node, Edge } from '@xyflow/react';
import type { FlowNodeData } from '../constants';

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  icon: string;
  nodes: Node<FlowNodeData>[];
  edges: Edge[];
}

const Y = (row: number) => 50 + row * 100;
const X = 300;

export const BUILT_IN_TEMPLATES: AutomationTemplate[] = [
  {
    id: 'motion-light',
    name: 'Motion-Activated Light',
    description: 'Turn on a light when motion is detected (after sunset), turn off after a delay.',
    icon: 'Lightbulb',
    nodes: [
      { id: 't1', type: 'automationNode', position: { x: X, y: Y(0) }, data: { category: 'trigger', nodeType: 'state', label: 'Motion Detected', icon: 'Activity', config: { summary: 'Configure motion sensor' }, isConfigured: false, enabled: true } },
      { id: 'c1', type: 'automationNode', position: { x: X, y: Y(1) }, data: { category: 'condition', nodeType: 'sun', label: 'After Sunset', icon: 'Sunrise', config: { after: 'sunset', summary: 'After sunset' }, isConfigured: true, enabled: true } },
      { id: 'a1', type: 'automationNode', position: { x: X, y: Y(2) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Light On', icon: 'Lightbulb', config: { summary: 'Configure light' }, isConfigured: false, enabled: true } },
      { id: 'a2', type: 'automationNode', position: { x: X, y: Y(3) }, data: { category: 'action', nodeType: 'delay', label: 'Wait 5 minutes', icon: 'Hourglass', config: { minutes: 5, summary: 'Wait 5m' }, isConfigured: true, enabled: true } },
      { id: 'a3', type: 'automationNode', position: { x: X, y: Y(4) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Light Off', icon: 'Lightbulb', config: { summary: 'Configure light' }, isConfigured: false, enabled: true } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1', type: 'controlFlow' },
      { id: 'e2', source: 'c1', target: 'a1', sourceHandle: 'pass', type: 'controlFlow' },
      { id: 'e3', source: 'a1', target: 'a2', type: 'controlFlow' },
      { id: 'e4', source: 'a2', target: 'a3', type: 'controlFlow' },
    ],
  },

  {
    id: 'sunset-sunrise',
    name: 'Sunset/Sunrise Lights',
    description: 'Turn on lights at sunset, turn them off at sunrise.',
    icon: 'Sunrise',
    nodes: [
      { id: 't1', type: 'automationNode', position: { x: X - 150, y: Y(0) }, data: { category: 'trigger', nodeType: 'sun', label: 'At Sunset', icon: 'Sunrise', config: { event: 'sunset', summary: 'At sunset' }, isConfigured: true, enabled: true } },
      { id: 'a1', type: 'automationNode', position: { x: X - 150, y: Y(1) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Lights On', icon: 'Lightbulb', config: { summary: 'Configure lights' }, isConfigured: false, enabled: true } },
      { id: 't2', type: 'automationNode', position: { x: X + 150, y: Y(0) }, data: { category: 'trigger', nodeType: 'sun', label: 'At Sunrise', icon: 'Sunrise', config: { event: 'sunrise', summary: 'At sunrise' }, isConfigured: true, enabled: true } },
      { id: 'a2', type: 'automationNode', position: { x: X + 150, y: Y(1) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Lights Off', icon: 'Lightbulb', config: { summary: 'Configure lights' }, isConfigured: false, enabled: true } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'a1', type: 'controlFlow' },
      { id: 'e2', source: 't2', target: 'a2', type: 'controlFlow' },
    ],
  },

  {
    id: 'temperature-alert',
    name: 'Temperature Alert',
    description: 'Send a notification when temperature goes above a threshold.',
    icon: 'Hash',
    nodes: [
      { id: 't1', type: 'automationNode', position: { x: X, y: Y(0) }, data: { category: 'trigger', nodeType: 'numeric_state', label: 'Temperature High', icon: 'Hash', config: { summary: 'Configure sensor + threshold' }, isConfigured: false, enabled: true } },
      { id: 'a1', type: 'automationNode', position: { x: X, y: Y(1) }, data: { category: 'action', nodeType: 'notify', label: 'Send Alert', icon: 'Bell', config: { message: 'Temperature is too high!', summary: 'Temperature is too high!' }, isConfigured: true, enabled: true } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'a1', type: 'controlFlow' },
    ],
  },

  {
    id: 'morning-scene',
    name: 'Good Morning Scene',
    description: 'Run a scene every weekday morning at a set time.',
    icon: 'Play',
    nodes: [
      { id: 't1', type: 'automationNode', position: { x: X, y: Y(0) }, data: { category: 'trigger', nodeType: 'time', label: 'Weekday 7:00 AM', icon: 'Clock', config: { at: '07:00', weekdays: [1, 2, 3, 4, 5], summary: 'At 07:00 (5 days)' }, isConfigured: true, enabled: true } },
      { id: 'a1', type: 'automationNode', position: { x: X, y: Y(1) }, data: { category: 'action', nodeType: 'execute_scene', label: 'Run Morning Scene', icon: 'Play', config: { summary: 'Configure scene' }, isConfigured: false, enabled: true } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'a1', type: 'controlFlow' },
    ],
  },

  {
    id: 'night-mode',
    name: 'Night Mode',
    description: 'At bedtime, turn off lights and set thermostat in parallel, then send a notification.',
    icon: 'Clock',
    nodes: [
      { id: 't1', type: 'automationNode', position: { x: X, y: Y(0) }, data: { category: 'trigger', nodeType: 'time', label: 'At 10:30 PM', icon: 'Clock', config: { at: '22:30', summary: 'At 22:30' }, isConfigured: true, enabled: true } },
      { id: 'l1', type: 'automationNode', position: { x: X, y: Y(1) }, data: { category: 'logic', nodeType: 'parallel', label: 'Parallel', icon: 'GitFork', config: { summary: '' }, isConfigured: true, enabled: true } },
      { id: 'a1', type: 'automationNode', position: { x: X - 150, y: Y(2) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Lights Off', icon: 'Lightbulb', config: { summary: 'Configure lights' }, isConfigured: false, enabled: true } },
      { id: 'a2', type: 'automationNode', position: { x: X + 150, y: Y(2) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Set Thermostat', icon: 'Lightbulb', config: { summary: 'Configure thermostat' }, isConfigured: false, enabled: true } },
      { id: 'a3', type: 'automationNode', position: { x: X, y: Y(3) }, data: { category: 'action', nodeType: 'notify', label: 'Goodnight', icon: 'Bell', config: { message: 'Good night! Home is in night mode.', summary: 'Good night! Home is in night m...' }, isConfigured: true, enabled: true } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'l1', type: 'controlFlow' },
      { id: 'e2', source: 'l1', target: 'a1', sourceHandle: 'branch-0', type: 'controlFlow' },
      { id: 'e3', source: 'l1', target: 'a2', sourceHandle: 'branch-1', type: 'controlFlow' },
      { id: 'e4', source: 'a1', target: 'a3', type: 'controlFlow' },
    ],
  },

  {
    id: 'door-alert',
    name: 'Door Open Alert',
    description: 'When a door opens at night, turn on hallway lights and send a notification.',
    icon: 'Bell',
    nodes: [
      { id: 't1', type: 'automationNode', position: { x: X, y: Y(0) }, data: { category: 'trigger', nodeType: 'state', label: 'Door Opened', icon: 'Activity', config: { summary: 'Configure door sensor' }, isConfigured: false, enabled: true } },
      { id: 'c1', type: 'automationNode', position: { x: X, y: Y(1) }, data: { category: 'condition', nodeType: 'time', label: 'Night Hours', icon: 'Clock', config: { after: '22:00', before: '06:00', summary: 'after 22:00, before 06:00' }, isConfigured: true, enabled: true } },
      { id: 'a1', type: 'automationNode', position: { x: X, y: Y(2) }, data: { category: 'action', nodeType: 'set_characteristic', label: 'Hallway Light 30%', icon: 'Lightbulb', config: { summary: 'Configure light' }, isConfigured: false, enabled: true } },
      { id: 'a2', type: 'automationNode', position: { x: X, y: Y(3) }, data: { category: 'action', nodeType: 'notify', label: 'Door Alert', icon: 'Bell', config: { message: 'Door opened at night!', summary: 'Door opened at night!' }, isConfigured: true, enabled: true } },
    ],
    edges: [
      { id: 'e1', source: 't1', target: 'c1', type: 'controlFlow' },
      { id: 'e2', source: 'c1', target: 'a1', sourceHandle: 'pass', type: 'controlFlow' },
      { id: 'e3', source: 'a1', target: 'a2', type: 'controlFlow' },
    ],
  },
];
