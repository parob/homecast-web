// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { WidgetCard } from '../WidgetCard';
import type { HomeKitAccessory } from '@/lib/graphql/types';

// jsdom has no matchMedia; the mobile hook asks for it at render.
window.matchMedia = window.matchMedia || (((query: string) => ({
  matches: false, media: query, onchange: null,
  addListener: () => {}, removeListener: () => {},
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia);

// A switch's expanded panel is hero-only: no children at all. When
// showChildren forgot the hero (f56ec90b) the collapse stayed shut and the
// panel rendered a title and nothing else — no rocker, no actions. This is
// the guard.

vi.mock('@/lib/config', () => ({ isCommunity: false, config: { version: 'test', isStaging: false } }));
vi.mock('@/lib/accessoryRefresh', () => ({ requestAccessoryRefresh: vi.fn() }));
vi.mock('@/contexts/DealsContext', () => ({
  useDeals: () => ({ isTracked: () => false, openPriceHistory: vi.fn() }),
}));
vi.mock('@/contexts/HistoryContext', () => ({
  useHistory: () => ({
    historyAvailable: () => true,
    analyticsAvailable: true,
    analyticsAvailableFor: () => true,
    openHistory: vi.fn(),
    openGroupHistory: vi.fn(),
    openAnalytics: vi.fn(),
  }),
}));
vi.mock('./VirtualAccessoryEditContext', () => ({
  useVirtualAccessoryEditor: () => undefined,
  useVirtualAccessoryRemover: () => undefined,
}));

const accessory = {
  id: 'ACC-1', name: 'Desk Switch', roomName: 'Study', isReachable: true,
  services: [{
    id: 's', name: 'Switch', serviceType: 'switch',
    characteristics: [{ id: 'c', characteristicType: 'power_state', value: true, isReadable: true, isWritable: true }],
  }],
} as HomeKitAccessory;

describe('WidgetCard expanded panel', () => {
  it('renders a hero-only widget and its actions (no children)', () => {
    render(
      <WidgetCard
        title="Desk Switch"
        icon={<span />}
        accessory={accessory}
        expanded
        hero={<div data-testid="rocker">rocker</div>}
      />,
    );
    expect(screen.getByTestId('rocker')).toBeTruthy();
    expect(screen.getByLabelText('Analytics')).toBeTruthy();
  });

  it('still renders the header action when there is no hero', () => {
    render(
      <WidgetCard
        title="Desk Switch"
        icon={<span />}
        accessory={accessory}
        expanded
        headerAction={<button>toggle</button>}
      />,
    );
    expect(screen.getByRole('button', { name: 'toggle' })).toBeTruthy();
    expect(screen.getByLabelText('Analytics')).toBeTruthy();
  });
});
