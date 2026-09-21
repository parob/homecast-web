// @vitest-environment jsdom
/**
 * One thing says a card is hidden, not two.
 *
 * A hidden card already reads as hidden twice over: it is dimmed to 40%, and
 * the badge in its corner says "Unhide". `HiddenLabel` is the *fallback* for
 * the case where neither of those is enough — a revealed card with no way to
 * act on it, where a grey card with nothing saying why is just a mysterious
 * one. WidgetCard has always treated it that way ("falls back to a plain Hidden
 * label when the tile cannot be unhidden", edit-mode-tile.test.tsx).
 *
 * The scene, shortcut and automation cards did not: they rendered the pill
 * whenever `isHidden`, so in Edit Layout every hidden card carried an "Unhide"
 * badge AND a "Hidden" pill — and the pill is centred, so on a ~160px tile it
 * sat across the card's own name. Reported as homecast-cloud#160, from an
 * iPhone, with a screenshot in which "Open all blinds", "All lights off test"
 * and "Turn off heating & cooling" are each unreadable behind one.
 *
 * The rule under test is the general one rather than "not while editing":
 * the pill appears exactly when no Unhide button does. That also covers the
 * desktop reveal, where Show Hidden Items offers Unhide without ever entering
 * edit mode — the same double label, on the other platform.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MockedProvider } from '@apollo/client/testing/react';
import type { MockLink } from '@apollo/client/testing';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  getRelayAddress: () => null,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

import { SceneCard } from '@/components/scenes/SceneCard';
import { ActionCard } from '@/components/actions/ActionCard';
import { AutomationCard } from '@/components/automations/AutomationCard';
import { SwitchWidget } from '@/components/widgets/SwitchWidget';
import type { WidgetProps } from '@/components/widgets/types';
import type { HomeKitScene } from '@/lib/graphql/types';
import type { Automation } from '@/automation/types/automation';
import type { HomeAction } from '@/components/actions/catalog';

if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(cleanup);

/**
 * No card here issues a query; the provider is only there to satisfy Apollo.
 * No `addTypename` — it is not a prop of this Apollo version's MockedProvider,
 * and passing one is a type error already sitting in typecheck-baseline.json.
 */
const NO_MOCKS: MockLink.MockedResponse[] = [];

const HOME_ID = 'HOME-1';

const SCENE = {
  id: 'scene-1', name: 'Open all blinds', actionCount: 2,
  __typename: 'HomeKitScene',
} as unknown as HomeKitScene;

const ACTION = {
  id: 'all_lights', label: 'All lights', subtitle: 'All off',
  icon: 'lightbulb', serviceType: 'lightbulb',
} as unknown as HomeAction;

const AUTOMATION: Automation = {
  id: 'auto-1', name: 'Aircon Off Every 2 Hours', homeId: HOME_ID,
  enabled: true, mode: 'single', triggers: [],
  conditions: { operator: 'and', conditions: [] }, actions: [],
  metadata: { createdAt: '', updatedAt: '', triggerCount: 0 },
};

const ACCESSORY = {
  id: 'acc-lamp', name: 'Ceiling Light', category: 'Switch',
  isReachable: true, roomName: 'Kitchen',
  services: [{
    id: 'acc-lamp:svc', name: 'Ceiling Light', serviceType: 'switch',
    characteristics: [{
      id: 'c-power', characteristicType: 'power_state', value: true,
      isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic',
    }],
    __typename: 'HomeKitService',
  }],
  __typename: 'HomeKitAccessory',
};

/**
 * The four kinds of card that can be hidden, each in the two states that
 * matter: revealed with an unhide route, and revealed without one.
 *
 * `withUnhide` is a *revealed* card — in Edit Layout for the three grid cards
 * (the only way a touch device reveals anything), and via the desktop reveal
 * for the accessory tile, whose badge stands on `isHidden` alone.
 */
const CARDS = [
  {
    name: 'scene card',
    withUnhide: () => render(
      <SceneCard
        scene={SCENE} homeId={HOME_ID} tile editMode isHidden
        running={false} onRun={vi.fn()} onEdit={vi.fn()} onToggleHidden={vi.fn()}
      />,
    ),
    withoutUnhide: () => render(
      <SceneCard
        scene={SCENE} homeId={HOME_ID} tile editMode isHidden
        running={false} onRun={vi.fn()} onEdit={vi.fn()}
      />,
    ),
  },
  {
    name: 'shortcut card',
    withUnhide: () => render(
      <ActionCard
        action={ACTION} homeId={HOME_ID} tile editMode touchMode isHidden
        running={false} elapsed={null} runningTextOf={() => 'Running'}
        onPress={vi.fn()} onRun={vi.fn()} onToggleHidden={vi.fn()}
      />,
    ),
    withoutUnhide: () => render(
      <ActionCard
        action={ACTION} homeId={HOME_ID} tile editMode touchMode isHidden
        running={false} elapsed={null} runningTextOf={() => 'Running'}
        onPress={vi.fn()} onRun={vi.fn()}
      />,
    ),
  },
  {
    name: 'automation card',
    withUnhide: () => render(
      <MockedProvider mocks={NO_MOCKS}>
        <AutomationCard hcAutomation={AUTOMATION} onClick={vi.fn()} editMode isHidden onToggleHidden={vi.fn()} />
      </MockedProvider>,
    ),
    withoutUnhide: () => render(
      <MockedProvider mocks={NO_MOCKS}>
        <AutomationCard hcAutomation={AUTOMATION} onClick={vi.fn()} editMode isHidden />
      </MockedProvider>,
    ),
  },
  {
    // The desktop reveal: Show Hidden Items never enters edit mode, so this
    // tile carries an Unhide badge with `editMode` false.
    name: 'accessory tile revealed on a desktop',
    withUnhide: () => render(<SwitchWidget {...({
      accessory: ACCESSORY, getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
      onSetValue: vi.fn(), onSlider: vi.fn(), onToggle: vi.fn(), onExpandToggle: vi.fn(),
      iconStyle: 'colourful', compact: true, isHidden: true, onHide: vi.fn(),
    } as unknown as WidgetProps)} />),
    withoutUnhide: () => render(<SwitchWidget {...({
      accessory: ACCESSORY, getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
      onSetValue: vi.fn(), onSlider: vi.fn(), onToggle: vi.fn(), onExpandToggle: vi.fn(),
      iconStyle: 'colourful', compact: true, isHidden: true,
    } as unknown as WidgetProps)} />),
  },
];

describe('a hidden card says so once', () => {
  for (const card of CARDS) {
    it(`shows no Hidden pill on a ${card.name} that offers Unhide`, () => {
      card.withUnhide();

      // The precondition: this really is the state the reporter photographed.
      expect(screen.getByRole('button', { name: /^Unhide/ })).toBeTruthy();
      // And the pill that sat across the card's own name is gone.
      expect(screen.queryByText('Hidden')).toBeNull();
    });

    it(`still labels a ${card.name} that has no unhide route`, () => {
      card.withoutUnhide();

      expect(screen.queryByRole('button', { name: /^Unhide/ })).toBeNull();
      expect(screen.getByText('Hidden')).toBeTruthy();
    });
  }
});
