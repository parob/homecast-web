// @vitest-environment jsdom
/**
 * The Device Offline trigger's device button called `openDevicePicker()` with
 * no callback, so the picker stored `undefined` and `onToggle` bailed on
 * `if (acc && pickerCallback)` — the dialog opened, a tap closed it, and the
 * device was never set. It now uses the shared DevicePicker like every other
 * node.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
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

// The picker list is virtualized: it renders nothing until something reports a
// viewport size, and jsdom measures every element as 0×0. Report a real size.
class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(el: Element) {
    queueMicrotask(() => this.cb(
      [{ target: el, contentRect: { width: 400, height: 600 }, borderBoxSize: [{ inlineSize: 400, blockSize: 600 }] } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    ));
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
(window as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({ width: 400, height: 600, top: 0, left: 0, right: 400, bottom: 600, x: 0, y: 0, toJSON: () => ({}) }),
});

const ACCESSORIES = [{
  id: 'ACC-LAMP', name: 'Reading Lamp', homeId: 'HOME-1', category: 'Lightbulb',
  isReachable: true, roomId: 'ROOM-1', roomName: 'Living Room',
  services: [{
    id: 'SVC-1', name: 'Lamp', serviceType: 'lightbulb',
    characteristics: [{ id: 'CH-1', characteristicType: 'power_state', value: true, isReadable: true, isWritable: true }],
  }],
}] as unknown as HomeKitAccessory[];

function renderPanel(onUpdateData: (u: Partial<{ config: Record<string, unknown> }>) => void) {
  const data: FlowNodeData = {
    category: 'trigger',
    nodeType: 'device_offline',
    label: 'Device Offline',
    icon: 'WifiOff',
    config: {},
    isConfigured: false,
    enabled: true,
  } as FlowNodeData;

  return render(
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
}

afterEach(() => cleanup());

describe('Device Offline trigger config', () => {
  it('records the device chosen in the picker', async () => {
    const onUpdateData = vi.fn();
    renderPanel(onUpdateData);

    fireEvent.click(screen.getByTestId('select-device-button'));
    fireEvent.click(await screen.findByRole('button', { name: /reading lamp/i }));

    await waitFor(() => expect(onUpdateData).toHaveBeenCalled());
    const config = onUpdateData.mock.calls.at(-1)?.[0]?.config;
    expect(config?.accessoryId).toBe('ACC-LAMP');
    expect(config?.accessoryName).toBe('Reading Lamp');
  });

  it('shows the chosen device on the picker button', () => {
    const onUpdateData = vi.fn();
    render(
      <MockedProvider mocks={[]} addTypename={false}>
        <ReactFlowProvider>
          <NodeConfigPanel
            node={{
              id: 'n1', type: 'base', position: { x: 0, y: 0 },
              data: {
                category: 'trigger', nodeType: 'device_offline', label: 'Device Offline',
                icon: 'WifiOff', config: { accessoryId: 'ACC-LAMP' }, isConfigured: true, enabled: true,
              },
            } as never}
            onUpdateData={onUpdateData as never}
            onDelete={() => {}}
            accessories={ACCESSORIES}
            homes={[{ id: 'HOME-1', name: 'Test Home' } as never]}
            scenes={[]}
          />
        </ReactFlowProvider>
      </MockedProvider>,
    );

    expect(screen.getByTestId('select-device-button').textContent).toContain('Reading Lamp');
  });
});
