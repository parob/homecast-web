// @vitest-environment jsdom
//
// What this screen's switches actually do, said in words.
//
// Every row here is a name and a switch — the home's name, then the names of
// the automations under it — which is the same shape as the Automations page
// next door, where a switch means something else entirely. So the caption is
// the only thing telling the two apart, and it used to say "turn off
// individual automations that send notifications". A reporter read that the
// way it is written: as turning the automation off. It silences the
// notification; the automation carries on running.
//
// The Automations page had already solved this ("Turning one off here only
// hides its card on the home screen — the automation keeps running"), so what
// is guarded here is that this screen says the same kind of thing: what the
// switch silences, and what it leaves alone.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';

// config.ts reads localStorage at module scope, which jsdom doesn't provide here.
vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

// The mutes hook talks to the server and to a device fingerprint; neither is
// what this test is about. Nothing is muted, so every row renders live.
vi.mock('@/hooks/useNotificationMutes', () => ({
  useNotificationMutes: () => ({
    platform: 'ios',
    fingerprint: 'ios-test',
    deviceMuted: false,
    isSaving: false,
    setMute: () => {},
    isMuted: () => false,
  }),
}));

import { HC_AUTOMATIONS } from '@/lib/graphql/queries';
import { HomeNotificationsSection } from '../HomeNotificationsSection';

const AUTOMATION = {
  id: 'auto-1',
  name: 'Notify Annex Lights',
  enabled: true,
  triggers: [],
  actions: [{ id: 'a1', type: 'notify', config: {} }],
};

const mocks = [
  {
    request: { query: HC_AUTOMATIONS, variables: { homeId: 'HOME-1' } },
    result: {
      data: {
        hcAutomations: [
          {
            __typename: 'StoredEntityInfo',
            id: 'ent-1',
            entityType: 'hc_automation',
            entityId: 'auto-1',
            parentId: 'HOME-1',
            dataJson: JSON.stringify(AUTOMATION),
            updatedAt: '2026-08-28T00:00:00Z',
          },
        ],
      },
    },
  },
];

function renderSection() {
  return render(
    <MockedProvider mocks={mocks}>
      <HomeNotificationsSection home={{ id: 'HOME-1', name: 'George Street' }} />
    </MockedProvider>,
  );
}

/** Everything the screen says, whitespace-normalised. */
const visibleText = () => (document.body.textContent ?? '').replace(/\s+/g, ' ');

afterEach(cleanup);

describe('a home’s notification switches', () => {
  it('says the switch silences notifications, not the automation', async () => {
    renderSection();
    await screen.findByText('Notify Annex Lights');

    const text = visibleText();
    expect(text).toMatch(/silences its notifications/i);
    expect(text).toMatch(/the automation keeps running/i);
  });

  it('never describes a switch as turning an automation off', async () => {
    renderSection();
    await screen.findByText('Notify Annex Lights');

    // The exact phrasing that was reported as misleading.
    expect(visibleText()).not.toMatch(/turn off individual automations/i);
  });

  it('still says the mutes are per-device', async () => {
    renderSection();
    await screen.findByText('Notify Annex Lights');

    expect(visibleText()).toMatch(/this device only/i);
  });
});
