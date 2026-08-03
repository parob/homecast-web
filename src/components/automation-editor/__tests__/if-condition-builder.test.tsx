// @vitest-environment jsdom
//
// The IF node's condition builder: pick a device and characteristic instead
// of typing states('UUID', 'char_type') by hand, see what the device reads
// right now, and adopt it in one tap. The expression textarea survives as the
// advanced mode; a condition the form can't express is preserved verbatim.

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

import { NodeConfigPanel } from '../panels/NodeConfigPanel';
import type { FlowNodeData } from '../constants';
import type { HomeKitAccessory } from '@/lib/graphql/types';

/** A lamp currently ON, and a thermostat currently at 21.5°. */
const ACCESSORIES = [
  {
    id: 'ACC-LAMP', name: 'Reading Lamp', homeId: 'HOME-1', category: 'Lightbulb',
    isReachable: true, roomId: 'ROOM-1', roomName: 'Living Room',
    services: [{
      id: 'SVC-1', name: 'Lamp', serviceType: 'lightbulb',
      characteristics: [
        { id: 'CH-1', characteristicType: 'power_state', value: true, isReadable: true, isWritable: true },
      ],
    }],
  },
  {
    id: 'ACC-THERMO', name: 'Hall Thermostat', homeId: 'HOME-1', category: 'Thermostat',
    isReachable: true, roomId: 'ROOM-2', roomName: 'Hall',
    services: [{
      id: 'SVC-2', name: 'Thermostat', serviceType: 'thermostat',
      characteristics: [
        { id: 'CH-2', characteristicType: 'current_temperature', value: 21.5, minValue: 0, maxValue: 40, isReadable: true, isWritable: false },
      ],
    }],
  },
] as unknown as HomeKitAccessory[];

function renderIfNode(config: Record<string, unknown>, onUpdateData = vi.fn()) {
  const data = {
    category: 'logic', nodeType: 'if', label: 'IF', icon: 'GitBranch',
    config, isConfigured: false, enabled: true,
  } as FlowNodeData;

  render(
    <MockedProvider mocks={[]} addTypename={false}>
      <ReactFlowProvider>
        <NodeConfigPanel
          node={{ id: 'if1', type: 'base', position: { x: 0, y: 0 }, data } as never}
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

describe('IF condition builder', () => {
  it('defaults to the visual builder with an add-condition button, not a code textarea', () => {
    renderIfNode({});
    expect(screen.getByTestId('add-condition-row')).toBeTruthy();
    expect(document.querySelector('textarea')).toBeNull();
  });

  it('shows the device\'s current value beside a configured row', () => {
    renderIfNode({
      conditionMode: 'simple',
      conditions: [{ accessoryId: 'ACC-LAMP', accessoryName: 'Reading Lamp', characteristicType: 'power_state', operator: 'eq', value: 0 }],
    });

    // "Currently On" — live from the accessory data, humanized.
    expect(screen.getByTestId('current-value-chip').textContent).toContain('Currently');
    expect(screen.getByTestId('current-value-chip').textContent).toContain('On');
    expect(screen.getByTestId('use-current-value')).toBeTruthy();
  });

  it('adopts the current value on tap', () => {
    const onUpdateData = renderIfNode({
      conditionMode: 'simple',
      conditions: [{ accessoryId: 'ACC-LAMP', accessoryName: 'Reading Lamp', characteristicType: 'power_state', operator: 'eq', value: 0 }],
    });

    fireEvent.click(screen.getByTestId('use-current-value'));

    const updated = onUpdateData.mock.calls.at(-1)?.[0] as { config: { conditions: { value: unknown }[] } };
    // Lamp is on → boolean true normalizes to 1 (stored form).
    expect(updated.config.conditions[0].value).toBe(1);
  });

  it('adopts a numeric current value into an above/below threshold', () => {
    const onUpdateData = renderIfNode({
      conditionMode: 'simple',
      conditions: [{ accessoryId: 'ACC-THERMO', accessoryName: 'Hall Thermostat', characteristicType: 'current_temperature', operator: 'above' }],
    });

    fireEvent.click(screen.getByTestId('use-current-value'));

    const updated = onUpdateData.mock.calls.at(-1)?.[0] as { config: { conditions: { threshold: number }[] } };
    expect(updated.config.conditions[0].threshold).toBe(21.5);
  });

  it('keeps the expression textarea available as the advanced mode', () => {
    renderIfNode({ conditionMode: 'expression', expression: 'now().hour > 20' });
    const textarea = document.querySelector('textarea');
    expect(textarea).not.toBeNull();
    expect((textarea as HTMLTextAreaElement).value).toBe('now().hour > 20');
  });

  it('preserves an out-of-editor condition instead of mangling it', () => {
    renderIfNode({ conditionMode: 'custom', conditionJson: '{"operator":"or","conditions":[{"type":"sun","id":"c1","after":"sunset"}]}' });
    expect(screen.getByText(/kept exactly as saved/i)).toBeTruthy();
    expect(document.querySelector('textarea')).toBeNull();
  });
});
