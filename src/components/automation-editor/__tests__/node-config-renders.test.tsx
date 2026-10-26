// @vitest-environment jsdom
/**
 * Every node in the palette must be able to open its config panel.
 *
 * The Error trigger's panel threw on render for six months — a Radix
 * `<SelectItem value="">` — and nothing noticed, because no test had ever
 * rendered that branch of NodeConfigPanel. The panel is one large switch over
 * node types, so a render-time crash in any single case is invisible to tests
 * written for the others. This walks the palette instead of a hand-picked list:
 * a node added later is covered the day it appears in ALL_NODE_DEFINITIONS.
 *
 * It asserts only that the panel renders. What each panel does is for the
 * per-node tests.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
import { ALL_NODE_DEFINITIONS, createDefaultNodeData } from '../constants';
import type { FlowNodeData } from '../constants';
import type { HomeKitAccessory } from '@/lib/graphql/types';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

const ACCESSORIES = [{
  id: 'ACC-LAMP', name: 'Reading Lamp', homeId: 'HOME-1', category: 'Lightbulb',
  isReachable: true, roomId: 'ROOM-1', roomName: 'Living Room',
  services: [{
    id: 'SVC-1', name: 'Lamp', serviceType: 'lightbulb',
    characteristics: [
      { id: 'CH-1', characteristicType: 'power_state', value: true, isReadable: true, isWritable: true },
      { id: 'CH-2', characteristicType: 'brightness', value: 40, isReadable: true, isWritable: true, minValue: 0, maxValue: 100 },
    ],
  }],
}] as unknown as HomeKitAccessory[];

const CONTEXT = {
  accessories: ACCESSORIES,
  homes: [{ id: 'HOME-1', name: 'Test Home' }] as never,
  scenes: [{ id: 'SCENE-1', name: 'Movie Night', homeId: 'HOME-1' }] as never,
  serviceGroups: [{ id: 'GRP-1', name: 'Downstairs', homeId: 'HOME-1', accessoryIds: ['ACC-LAMP'] }] as never,
  availableAutomations: [{ id: 'auto-1', name: 'Porch light at dusk' }],
  availableHelpers: [{ id: 'helper-1', name: 'Guest mode', type: 'switch' }] as never,
};

// The fields node configs commonly key on, pointing at the context above. A
// node ignores the ones it doesn't use; the ones it does use take it down the
// "already configured" branch, which renders different controls from the
// empty one.
const POPULATED = {
  accessoryId: 'ACC-LAMP',
  accessoryName: 'Reading Lamp',
  characteristicType: 'power_state',
  serviceGroupId: 'GRP-1',
  sceneId: 'SCENE-1',
  watchAutomationId: 'auto-1',
  automationId: 'auto-1',
  scriptId: 'auto-1',
  helperId: 'helper-1',
};

function renderPanel(data: FlowNodeData) {
  return render(
    <MockedProvider mocks={[]}>
      <ReactFlowProvider>
        <NodeConfigPanel
          node={{ id: 'n1', type: 'base', position: { x: 0, y: 0 }, data } as never}
          onUpdateData={vi.fn()}
          onDelete={() => {}}
          homeId="HOME-1"
          {...CONTEXT}
        />
      </ReactFlowProvider>
    </MockedProvider>,
  );
}

afterEach(() => cleanup());

const CONFIGURABLE = ALL_NODE_DEFINITIONS.filter((def) => def.category !== 'annotation');

describe('every node config panel renders', () => {
  it('covers the whole palette', () => {
    expect(CONFIGURABLE.length).toBeGreaterThan(10);
  });

  it.each(CONFIGURABLE.map((def) => [def.category, def.type, def] as const))(
    '%s/%s — empty',
    (_category, _type, def) => {
      renderPanel(createDefaultNodeData(def));
      expect(screen.getByTestId('config-panel')).toBeTruthy();
    },
  );

  it.each(CONFIGURABLE.map((def) => [def.category, def.type, def] as const))(
    '%s/%s — configured',
    (_category, _type, def) => {
      const data = createDefaultNodeData(def);
      renderPanel({ ...data, config: { ...data.config, ...POPULATED }, isConfigured: true });
      expect(screen.getByTestId('config-panel')).toBeTruthy();
    },
  );
});
