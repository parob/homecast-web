/**
 * Node subtitles must name what the node targets, not its UUID.
 *
 * Reported from production: the editor showed "Group 7468B625-D23… power_state"
 * for a trigger on County Hall's Kitchen Lights. The cause was two independent
 * summary builders — one used when a node is edited (NodeConfigPanel), one when
 * a saved automation is loaded (automationToGraph). Only the first resolved
 * names, so the canvas rendered raw ids on every reload. Both now go through
 * entity-labels, and these tests pin the load path specifically because that is
 * the one that was wrong.
 */

import { describe, it, expect } from 'vitest';
import { automationToGraph } from '../serialization/automationToGraph';
import type { FlowNodeData } from '../constants';
import type { Automation } from '@/automation/types/automation';

const GROUP_ID = '7468B625-D235-41A5-90ED-55AD320623C7';
const ACC_ID = '9EB2B6C3-67CB-56CD-B991-E5DB223A679D';

const NAMES = {
  accessories: [{ id: ACC_ID, name: 'Hue outdoor motion sensor' }],
  serviceGroups: [{ id: GROUP_ID, name: 'Kitchen Lights' }],
};

function automation(over: Partial<Automation> = {}): Automation {
  return {
    id: 'auto-1',
    name: 'Test',
    homeId: 'home-1',
    enabled: true,
    mode: 'single',
    triggers: [{ type: 'state', id: 't1', serviceGroupId: GROUP_ID, characteristicType: 'power_state', to: 1 }],
    conditions: { operator: 'and', conditions: [] },
    actions: [],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
    ...over,
  } as Automation;
}

const subtitleOf = (auto: Automation, names?: typeof NAMES, category = 'trigger') => {
  const { nodes } = automationToGraph(auto, names);
  const node = nodes.find((n) => (n.data as FlowNodeData).category === category);
  return (node!.data as FlowNodeData).subtitle;
};

describe('automation node subtitles', () => {
  it('names the service group instead of printing its UUID', () => {
    expect(subtitleOf(automation(), NAMES)).toBe('Kitchen Lights / Power State');
  });

  it('names the accessory for a device trigger', () => {
    const auto = automation({
      triggers: [{ type: 'state', id: 't1', accessoryId: ACC_ID, characteristicType: 'motion_detected' }],
    } as Partial<Automation>);
    expect(subtitleOf(auto, NAMES)).toBe('Hue outdoor motion sensor / Motion Detected');
  });

  it('never renders a bare UUID when the name is unknown', () => {
    // HomeKit data hadn't loaded yet, or the entity is gone.
    const subtitle = subtitleOf(automation(), undefined) ?? '';
    expect(subtitle).not.toContain(GROUP_ID);
    expect(subtitle).toContain('Group');
    expect(subtitle).toContain('Power State');
  });

  it('humanises the characteristic on numeric triggers too', () => {
    const auto = automation({
      triggers: [{
        type: 'numeric_state', id: 't1', accessoryId: ACC_ID,
        characteristicType: 'battery_level', below: 20,
      }],
    } as Partial<Automation>);
    const subtitle = subtitleOf(auto, NAMES) ?? '';
    expect(subtitle).toContain('Hue outdoor motion sensor');
    expect(subtitle).toContain('Battery Level');
    expect(subtitle).not.toContain('battery_level');
  });

  it('names the target of a set-characteristic action', () => {
    const auto = automation({
      actions: [{ type: 'set_characteristic', id: 'a1', accessoryId: ACC_ID, characteristicType: 'power_state', value: true }],
    } as Partial<Automation>);
    const subtitle = subtitleOf(auto, NAMES, 'action') ?? '';
    expect(subtitle).toContain('Hue outdoor motion sensor');
    expect(subtitle).not.toContain(ACC_ID);
  });

  it('resolves a renamed group by id rather than trusting stale config', () => {
    const renamed = {
      ...NAMES,
      serviceGroups: [{ id: GROUP_ID, name: 'Kitchen Downlights' }],
    };
    expect(subtitleOf(automation(), renamed)).toBe('Kitchen Downlights / Power State');
  });
});
