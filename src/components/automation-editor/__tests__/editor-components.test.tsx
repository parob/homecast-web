// @vitest-environment jsdom
/**
 * Component coverage for the editor canvas and palette.
 *
 * These files sat at 0%, which is exactly where the icon-registry drift, the
 * missing arrowhead marker and the blank config-panel icon all hid. Rendering
 * assertions are the only thing that would have caught any of them.
 */
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

// Remote help content is fetched over the network; irrelevant here.
vi.mock('../help/useNodeHelp', () => ({
  useNodeHelp: () => ({ content: null, loading: false, error: null }),
}));

import { BaseNode } from '../nodes/BaseNode';
import { NodePalette } from '../panels/NodePalette';
import { ALL_NODE_DEFINITIONS, createDefaultNodeData, type FlowNodeData } from '../constants';

class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

function nodeData(overrides: Partial<FlowNodeData> = {}): FlowNodeData {
  return {
    category: 'action',
    nodeType: 'set_device',
    label: 'Set Device',
    icon: 'Lightbulb',
    config: {},
    isConfigured: true,
    enabled: true,
    ...overrides,
  };
}

function renderNode(data: Partial<FlowNodeData> = {}, selected = false) {
  return render(
    <ReactFlowProvider>
      <BaseNode
        id="n1"
        data={nodeData(data)}
        selected={selected}
        type="automationNode"
        dragging={false}
        zIndex={0}
        isConnectable
        positionAbsoluteX={0}
        positionAbsoluteY={0}
        {...({} as never)}
      />
    </ReactFlowProvider>,
  );
}

afterEach(() => cleanup());

describe('BaseNode', () => {
  it('renders the node label', () => {
    renderNode();
    expect(screen.getByText('Set Device')).toBeTruthy();
  });

  it('renders a subtitle when present', () => {
    renderNode({ subtitle: 'Turn on Porch Light' });
    expect(screen.getByText('Turn on Porch Light')).toBeTruthy();
  });

  it('prompts to configure when unconfigured and there is no subtitle', () => {
    renderNode({ isConfigured: false });
    expect(screen.getByText(/click to configure/i)).toBeTruthy();
  });

  it('exposes a labelled delete control', () => {
    renderNode();
    expect(screen.getByLabelText(/delete node/i)).toBeTruthy();
  });

  it('renders an icon rather than an empty chip', () => {
    const { container } = renderNode();
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('shows both outputs for an IF node', () => {
    renderNode({ category: 'logic', nodeType: 'if', label: 'IF', icon: 'GitBranch' });
    expect(screen.getByText('T')).toBeTruthy();
    expect(screen.getByText('F')).toBeTruthy();
  });

  it('dims a disabled node', () => {
    const { container } = renderNode({ enabled: false });
    expect(container.innerHTML).toContain('opacity-40');
  });

  it('marks a failed execution', () => {
    const { container } = renderNode({ executionState: 'failed', executionError: 'boom' });
    expect(container.innerHTML).toMatch(/red/);
  });

  it('marks a completed execution', () => {
    const { container } = renderNode({ executionState: 'completed' });
    expect(container.innerHTML).toMatch(/emerald/);
  });

  it('renders every node type in the palette without throwing', () => {
    for (const def of ALL_NODE_DEFINITIONS) {
      const data = createDefaultNodeData(def);
      expect(() => renderNode({ ...data })).not.toThrow();
      cleanup();
    }
  });
});

describe('NodePalette', () => {
  function renderPalette(props: Partial<React.ComponentProps<typeof NodePalette>> = {}) {
    return render(
      <MockedProvider mocks={[]} addTypename={false}>
        <NodePalette
          collapsed={false}
          onToggleCollapsed={() => {}}
          {...(props as never)}
        />
      </MockedProvider>,
    );
  }

  it('lists every category heading', () => {
    renderPalette();
    for (const label of ['Triggers', 'Actions', 'Logic']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('lists the newly exposed logic nodes', () => {
    renderPalette();
    for (const label of ['Repeat', 'Choose', 'Parallel', 'Set Variable', 'Stop']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('lists the device offline trigger', () => {
    renderPalette();
    expect(screen.getByText('Device Offline')).toBeTruthy();
  });

  it('renders a distinct icon per palette row rather than a wall of fallbacks', () => {
    const { container } = renderPalette();
    // One <svg> per row icon (plus chevrons); the regression made every logic
    // node render the identical Zap glyph, which this many-icons check plus
    // the icons.test.ts collision assertion together rule out.
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(10);
  });

  it('collapses a category when its header is clicked', () => {
    renderPalette();
    expect(screen.getByText('Repeat')).toBeTruthy();

    fireEvent.click(screen.getByText('Logic'));

    expect(screen.queryByText('Repeat')).toBeNull();
  });

  it('starts a drag with the node type on the dataTransfer', () => {
    renderPalette();
    const setData = vi.fn();
    const row = screen.getByText('Delay').closest('[draggable]')!;

    fireEvent.dragStart(row, { dataTransfer: { setData, effectAllowed: '' } });

    expect(setData).toHaveBeenCalledWith('application/reactflow', 'action:delay');
  });
});
