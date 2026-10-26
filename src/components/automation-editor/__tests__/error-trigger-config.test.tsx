// @vitest-environment jsdom
/**
 * The Error trigger's "Watch automation" picker offered "All automations" as
 * `<SelectItem value="">`. Radix reserves the empty string for "no selection"
 * and throws on an item that uses it, so opening the trigger's config took the
 * whole automation editor down. "All" is now its own value, stored as no
 * filter — the same shape the Auth type picker uses for "None".
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

const AUTOMATIONS = [{ id: 'auto-1', name: 'Porch light at dusk' }];

function renderErrorTrigger(config: Record<string, unknown>) {
  return render(
    <MockedProvider mocks={[]}>
      <ReactFlowProvider>
        <NodeConfigPanel
          node={{
            id: 'n1', type: 'base', position: { x: 0, y: 0 },
            data: {
              category: 'trigger', nodeType: 'error', label: 'Automation Error',
              icon: 'AlertTriangle', config, isConfigured: true, enabled: true,
            },
          } as never}
          onUpdateData={vi.fn() as never}
          onDelete={() => {}}
          accessories={[]}
          homes={[{ id: 'HOME-1', name: 'Test Home' } as never]}
          scenes={[]}
          availableAutomations={AUTOMATIONS}
        />
      </ReactFlowProvider>
    </MockedProvider>,
  );
}

afterEach(() => cleanup());

describe('Error trigger config', () => {
  it('opens with no automation filter set', () => {
    expect(() => renderErrorTrigger({})).not.toThrow();
    expect(screen.getByText('Watch automation')).toBeTruthy();
    expect(screen.getByRole('combobox').textContent).toContain('All automations');
  });

  it('shows the watched automation when one is set', () => {
    renderErrorTrigger({ watchAutomationId: 'auto-1' });
    expect(screen.getByRole('combobox').textContent).toContain('Porch light at dusk');
  });
});
