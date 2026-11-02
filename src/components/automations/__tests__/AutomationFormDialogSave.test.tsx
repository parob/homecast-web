// @vitest-environment jsdom
//
// Saving an edit sends only what the user changed. The dialog used to send
// name, trigger and actions on every save, and relays before the in-place
// update rebuilt the whole automation whenever a trigger arrived — a rename
// that failed half-way deleted the automation.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';

// config.ts reads localStorage at module scope, which jsdom doesn't provide here.
vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { AutomationFormDialog } from '../AutomationFormDialog';
import { GET_ACCESSORIES, GET_HOMES } from '@/lib/graphql/queries';
import { UPDATE_AUTOMATION } from '@/lib/graphql/mutations';
import type { HomeKitAutomation } from '@/lib/graphql/types';

const HOME_ID = 'HOME-1111';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const automation = {
  id: 'AUTO-1',
  name: 'Evening lights',
  isEnabled: true,
  trigger: { type: 'event', events: [{ type: 'significantTime', significantEvent: 'sunset' }] },
  actions: [{ accessoryId: 'ACC-1', accessoryName: 'Lamp', characteristicType: 'brightness', targetValue: '50' }],
} as unknown as HomeKitAutomation;

describe('AutomationFormDialog save', () => {
  beforeEach(() => {
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
  });

  afterEach(() => cleanup());

  it('sends only the name for a rename — no trigger, no actions', async () => {
    const updated = vi.fn(() => ({
      data: {
        updateAutomation: {
          id: 'AUTO-1', name: 'Dusk lights', isEnabled: true, lastFireDate: null, homeId: HOME_ID,
          trigger: {
            type: 'event', fireDate: null, recurrence: null, timeZone: null, executeOnce: false,
            events: [{
              type: 'significantTime', significantEvent: 'sunset', offsetMinutes: null,
              accessoryId: null, accessoryName: null, characteristicType: null, triggerValue: null,
            }],
          },
          actions: automation.actions,
        },
      },
    }));
    const mocks = [
      {
        request: { query: GET_ACCESSORIES, variables: { homeId: HOME_ID } },
        result: { data: { accessories: [] } },
      },
      {
        request: { query: GET_HOMES },
        result: { data: { homes: [{ id: HOME_ID, name: 'Test Home', isPrimary: true, isAdmin: true }] } },
      },
      {
        // Exact variables: a save that also carried trigger or actions would not match
        request: { query: UPDATE_AUTOMATION, variables: { automationId: 'AUTO-1', homeId: HOME_ID, name: 'Dusk lights' } },
        result: updated,
      },
    ];
    const onOpenChange = vi.fn();

    render(
      <MockedProvider mocks={mocks}>
        <AutomationFormDialog open onOpenChange={onOpenChange} homeId={HOME_ID} automation={automation} />
      </MockedProvider>,
    );

    const nameInput = await screen.findByDisplayValue('Evening lights');
    // Let the dialog take its opening snapshot before editing
    await new Promise((resolve) => setTimeout(resolve, 10));
    fireEvent.change(nameInput, { target: { value: 'Dusk lights' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updated).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
