// @vitest-environment jsdom
//
// What a tile does while Edit Layout is running.
//
// Two complaints drove this. Hiding and unhiding were two different-looking
// controls — a small icon-only badge in the corner to hide, a centred labelled
// pill to unhide — so the same job looked like two unrelated ones depending on
// which state a tile happened to be in. And tiles stayed live while editing, so
// a mis-grab on the way to a drag switched a light on.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { SwitchWidget } from '../SwitchWidget';
import type { WidgetProps } from '../types';

vi.mock('@/lib/config', () => ({
  isCommunity: false,
  getCommunityMode: () => null,
  isRelayMode: () => false,
  isClientMode: () => false,
  isRelaySetupComplete: () => false,
  config: { isCommunity: false, apiBase: 'https://api.test', graphqlUrl: 'https://api.test/', wsUrl: 'wss://api.test/ws' },
}));

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

const ACCESSORY = {
  id: 'acc-lamp',
  name: 'Ceiling Light',
  category: 'Switch',
  isReachable: true,
  roomName: 'Kitchen',
  services: [{
    id: 'acc-lamp:svc',
    name: 'Ceiling Light',
    serviceType: 'switch',
    characteristics: [{
      id: 'c-power', characteristicType: 'power_state', value: true,
      isReadable: true, isWritable: true, __typename: 'HomeKitCharacteristic',
    }],
    __typename: 'HomeKitService',
  }],
  __typename: 'HomeKitAccessory',
};

function renderTile(overrides: Record<string, unknown> = {}) {
  const props = {
    accessory: ACCESSORY,
    getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
    onSetValue: vi.fn(),
    onSlider: vi.fn(),
    onToggle: vi.fn(),
    onExpandToggle: vi.fn(),
    iconStyle: 'colourful',
    compact: true,
    ...overrides,
  };
  render(<SwitchWidget {...(props as unknown as WidgetProps)} />);
  return props;
}

describe('the tile visibility control', () => {
  it('is one button whose label flips, not two different controls', () => {
    const onHide = vi.fn();

    // Visible, editing: says Hide.
    renderTile({ editMode: true, onHide });
    const hide = screen.getByRole('button', { name: /^Hide / });
    fireEvent.click(hide);
    expect(onHide).toHaveBeenCalledTimes(1);
    cleanup();

    // Hidden: the same control, same place, only the word changes.
    renderTile({ editMode: true, isHidden: true, onHide });
    expect(screen.getByRole('button', { name: /^Unhide / })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Hide / })).toBeNull();
  });

  it('offers unhide on a revealed tile even with no edit mode (desktop)', () => {
    // Desktop reveals hidden tiles from the context menu and never enters edit
    // mode, so the button has to stand on `isHidden` alone.
    const onHide = vi.fn();
    renderTile({ isHidden: true, onHide });
    fireEvent.click(screen.getByRole('button', { name: /^Unhide / }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it('shows no visibility control on a plain visible tile', () => {
    renderTile({ onHide: vi.fn() });
    expect(screen.queryByRole('button', { name: /^Hide |^Unhide / })).toBeNull();
  });

  it('falls back to a plain Hidden label when the tile cannot be unhidden', () => {
    renderTile({ isHidden: true });
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Unhide/ })).toBeNull();
  });
});

describe('tiles are inert while editing', () => {
  it('does not expand when tapped', () => {
    const props = renderTile({ editMode: true, onHide: vi.fn() });
    // The card is the tile's own clickable surface; clicking anywhere that is
    // not the visibility button must do nothing at all.
    fireEvent.click(screen.getByText('Ceiling Light'));
    expect(props.onExpandToggle).not.toHaveBeenCalled();
  });

  it('still expands when not editing', () => {
    const props = renderTile();
    fireEvent.click(screen.getByText('Ceiling Light'));
    expect(props.onExpandToggle).toHaveBeenCalled();
  });

  it('takes its switch away, so a mis-grab cannot toggle the accessory', () => {
    renderTile();
    expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
    cleanup();

    renderTile({ editMode: true, onHide: vi.fn() });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });
});
