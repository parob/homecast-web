// @vitest-environment jsdom
//
// A Set Device value can be an expression, not only a fixed position.
//
// The engine has always resolved `{{ … }}` in an action's value, but the editor
// offered only the fixed controls — a switch, a slider — so nobody could set a
// light's brightness from a Code node or an HTTP response without hand-writing
// the automation's JSON.

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

const EXPR = "{{ nodes['code1'].data.result }}";

/** Renders the Set Device panel with a Code node feeding it. */
function renderSetDevice(config: Record<string, unknown>) {
  const onUpdateData = vi.fn();
  const node = {
    id: 'n1', type: 'base', position: { x: 0, y: 0 },
    data: { category: 'action', nodeType: 'set_device', label: 'Set Device', icon: 'Lightbulb', config, isConfigured: false, enabled: true },
  } as Node<FlowNodeData>;
  const code = {
    id: 'code1', type: 'base', position: { x: 0, y: 0 },
    data: { category: 'action', nodeType: 'code', label: 'Code', icon: 'Code', config: { code: 'return 55;' }, isConfigured: true, enabled: true },
  } as Node<FlowNodeData>;
  const edges: Edge[] = [{ id: 'e1', source: 'code1', target: 'n1' }];

  render(
    <MockedProvider mocks={[]}>
      <ReactFlowProvider>
        <NodeConfigPanel
          node={node}
          allNodes={[code, node]}
          allEdges={edges}
          onUpdateData={onUpdateData}
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

const lastValue = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)?.[0]?.config?.value;

afterEach(() => cleanup());

describe('the Set Device value field', () => {
  it('shows the fixed control for a fixed value', () => {
    renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', value: 60 });

    expect(screen.getByTestId('value-mode-fixed').getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByTestId('value-expression')).toBeNull();
  });

  it('reopens a saved expression as an expression', () => {
    renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', value: EXPR });

    expect(screen.getByTestId('value-mode-expression').getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByTestId('value-expression') as HTMLInputElement).value).toBe(EXPR);
  });

  it('starts an expression empty rather than carrying the slider position in', () => {
    const onUpdateData = renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', value: 60 });

    fireEvent.click(screen.getByTestId('value-mode-expression'));

    expect(lastValue(onUpdateData)).toBeUndefined();
    // Still in expression mode with nothing typed yet.
    expect(screen.getByTestId('value-expression')).toBeTruthy();
  });

  it('uses an upstream output as the whole value, so its type survives', () => {
    const onUpdateData = renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', value: 60 });

    fireEvent.click(screen.getByTestId('value-mode-expression'));
    fireEvent.click(screen.getByRole('button', { name: /Return Value/ }));

    expect(lastValue(onUpdateData)).toBe(EXPR);
  });

  it("goes back to the device's own value on the fixed control", () => {
    const onUpdateData = renderSetDevice({ accessoryId: 'ACC-LAMP', characteristicType: 'brightness', value: EXPR });

    fireEvent.click(screen.getByTestId('value-mode-fixed'));

    expect(lastValue(onUpdateData)).toBe(60);
  });
});
