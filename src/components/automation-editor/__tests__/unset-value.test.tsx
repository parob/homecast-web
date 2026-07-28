// @vitest-environment jsdom
//
// A value nobody chose must not look like a value someone chose.
//
// Reported: "if i don't toggle the value widget in the automations builder it
// looks like it is 'Off' but actually it set it as no value". The switch had no
// third position, so an untouched action rendered exactly like a deliberate
// Off, saved with the key missing entirely (JSON.stringify drops undefined),
// counted as configured, and then failed every time it ran.
//
// The fix is a real default rather than a warning: choosing a characteristic
// seeds the value from what the device is set to right now.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { MockedProvider } from '@apollo/client/testing/react';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

vi.mock('../help/useNodeHelp', () => ({
  useNodeHelp: () => ({ content: null, loading: false, error: null }),
}));

import { NodeConfigPanel, defaultValueForCharacteristic } from '../panels/NodeConfigPanel';
import { isNodeConfigured, type FlowNodeData } from '../constants';
import { automationToGraph } from '../serialization/automationToGraph';
import { graphToAutomation } from '../serialization/graphToAutomation';
import type { Automation } from '@/automation/types/automation';
import type { HomeKitAccessory } from '@/lib/graphql/types';
import type { Node, Edge } from '@xyflow/react';

/** A lamp that is currently ON at 60% brightness. */
const ACCESSORIES = [{
  id: 'ACC-LAMP', name: 'Reading Lamp', homeId: 'HOME-1', category: 'Lightbulb',
  isReachable: true, roomId: 'ROOM-1', roomName: 'Living Room',
  services: [{
    id: 'SVC-1', name: 'Lamp', serviceType: 'lightbulb',
    characteristics: [
      { id: 'CH-1', characteristicType: 'power_state', value: true, isReadable: true, isWritable: true },
      { id: 'CH-2', characteristicType: 'brightness', value: 60, minValue: 0, maxValue: 100, isReadable: true, isWritable: true },
    ],
  }],
}] as unknown as HomeKitAccessory[];

function renderSetDevice(config: Record<string, unknown>, onUpdateData = vi.fn()) {
  const data = {
    category: 'action', nodeType: 'set_device', label: 'Set Device', icon: 'Lightbulb',
    config, isConfigured: false, enabled: true,
  } as FlowNodeData;

  render(
    <MockedProvider mocks={[]} addTypename={false}>
      <ReactFlowProvider>
        <NodeConfigPanel
          node={{ id: 'n1', type: 'base', position: { x: 0, y: 0 }, data } as never}
          onUpdateData={onUpdateData as never}
          onDelete={() => {}}
          accessories={ACCESSORIES}
          homes={[{ id: 'HOME-1', name: 'Test Home' } as never]}
          scenes={[]}
        />
      </ReactFlowProvider>
    </MockedProvider>,
  );
  return onUpdateData;
}

afterEach(() => cleanup());

describe('the value seeded when a characteristic is chosen', () => {
  // Picking a characteristic writes this straight into the config, so there is
  // never an untouched, unstored value to trip over.
  it("uses the device's current state for a boolean, normalised to 1/0", () => {
    expect(defaultValueForCharacteristic({ value: true }, 'power_state')).toBe(1);
    expect(defaultValueForCharacteristic({ value: false }, 'power_state')).toBe(0);
  });

  it('uses the current reading for a numeric characteristic', () => {
    expect(defaultValueForCharacteristic({ value: 60, minValue: 0 }, 'brightness')).toBe(60);
  });

  it('keeps a current reading of 0 rather than treating it as missing', () => {
    expect(defaultValueForCharacteristic({ value: 0, minValue: 0 }, 'brightness')).toBe(0);
  });

  it('falls back sensibly when the device cannot be read', () => {
    // Unreachable accessory, or a group whose members disagree.
    expect(defaultValueForCharacteristic({ minValue: 10, maxValue: 100 } as never, 'brightness')).toBe(10);
    expect(defaultValueForCharacteristic({ validValues: [3, 4, 5] }, 'target_heating_cooling_state')).toBe(3);
    expect(defaultValueForCharacteristic(undefined, 'power_state')).toBe(1);
  });

  it('has nothing to offer for a characteristic it knows nothing about', () => {
    expect(defaultValueForCharacteristic(undefined, 'some_custom_thing')).toBeUndefined();
  });
});

describe('the value control does not invent a position it has not stored', () => {
  it('shows neither On nor Off for a legacy action saved without a value', () => {
    renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'power_state' });

    expect(screen.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'On' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('shows Off as chosen when Off is what was stored', () => {
    renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'power_state', value: 0 });

    expect(screen.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'On' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('reaches Off in a single click', () => {
    // The old switch needed two — on, then off — which is part of why the
    // untouched state was so easy to leave behind.
    const onUpdateData = renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'power_state', value: 1 });

    fireEvent.click(screen.getByRole('button', { name: 'Off' }));

    expect(onUpdateData.mock.calls.at(-1)?.[0]?.config?.value).toBe(0);
  });
});

describe('isNodeConfigured: a Set Device without a value cannot run', () => {
  const base = { accessoryId: 'acc-1', characteristicType: 'power_state' };

  it('is incomplete with no value', () => {
    expect(isNodeConfigured('set_device', 'action', base)).toBe(false);
  });

  it.each([['Off', 0], ['On', 1], ['false', false]])('is complete once %s is chosen', (_label, value) => {
    // 0 and false are real values — a truthiness test would reject them and
    // make "turn it off" permanently unconfigurable.
    expect(isNodeConfigured('set_device', 'action', { ...base, value })).toBe(true);
  });
});

describe('an automation saved incomplete reopens as incomplete', () => {
  const broken: Automation = {
    // The shape actually found in production.
    id: 'a1', name: 'Notify Annex Lights', homeId: 'home-1', enabled: true, mode: 'single',
    triggers: [{ type: 'state', id: 't1', serviceGroupId: 'g-1', characteristicType: 'power_state', to: 1 }],
    conditions: { operator: 'and', conditions: [] },
    actions: [{ type: 'set_service_group', id: 'a-1', groupId: 'g-2', characteristicType: 'power_state' } as never],
    metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
  };

  it('is not marked configured on the way back in', () => {
    const action = automationToGraph(broken).nodes.find((n) => n.id === 'a-1');

    expect((action!.data as FlowNodeData).isConfigured).toBe(false);
  });

  it('is marked configured once it has a value', () => {
    const graph = automationToGraph({
      ...broken,
      actions: [{ type: 'set_service_group', id: 'a-1', groupId: 'g-2', characteristicType: 'power_state', value: 0 }],
    });

    expect((graph.nodes.find((n) => n.id === 'a-1')!.data as FlowNodeData).isConfigured).toBe(true);
  });
});

describe('a deliberate Off survives the round trip', () => {
  it('is still 0 after graph → automation → graph', () => {
    const nodes: Node<FlowNodeData>[] = [
      { id: 't1', type: 'automationNode', position: { x: 0, y: 0 },
        data: { category: 'trigger', nodeType: 'device_changed', label: '', icon: 'Zap', isConfigured: true, enabled: true,
          config: { accessoryId: 'acc-1', characteristicType: 'power_state', to: 1 } } as FlowNodeData },
      { id: 'a1', type: 'automationNode', position: { x: 0, y: 0 },
        data: { category: 'action', nodeType: 'set_device', label: '', icon: 'Lightbulb', isConfigured: true, enabled: true,
          config: { accessoryId: 'acc-2', characteristicType: 'power_state', value: 0 } } as FlowNodeData },
    ];
    const edges: Edge[] = [{ id: 'e', source: 't1', target: 'a1', type: 'controlFlow' }];

    const auto = graphToAutomation(nodes, edges, 'Off test', 'home-1');
    expect((auto.actions[0] as { value: unknown }).value).toBe(0);

    const action = automationToGraph(auto).nodes.find((n) => n.id === 'a1');
    expect((action!.data as FlowNodeData).config.value).toBe(0);
    expect((action!.data as FlowNodeData).isConfigured).toBe(true);
  });
});
