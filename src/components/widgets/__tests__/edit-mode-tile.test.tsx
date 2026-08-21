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
import { ServiceGroupWidget } from '../ServiceGroupWidget';
import { PinnedTabsProvider } from '@/contexts/PinnedTabsContext';
import { LayoutEditProvider } from '@/contexts/LayoutEditContext';
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

/** Renders inside a pin provider, which is what makes the Pin button appear. */
function renderPinnable(overrides: Record<string, unknown> = {}, pins: Record<string, unknown> = {}) {
  const actions = {
    enabled: true,
    isPinned: () => false,
    isFull: false,
    toggle: vi.fn(),
    ...pins,
  };
  render(
    <PinnedTabsProvider value={actions as never}>
      <SwitchWidget {...({
        accessory: ACCESSORY,
        getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
        onSetValue: vi.fn(), onSlider: vi.fn(), onToggle: vi.fn(),
        iconStyle: 'colourful', compact: true,
        ...overrides,
      } as unknown as WidgetProps)} />
    </PinnedTabsProvider>,
  );
  return actions;
}

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

describe('pin to tab bar', () => {
  it('offers a pin button beside the primary action while editing', () => {
    const actions = renderPinnable({ editMode: true, onHide: vi.fn() });

    expect(screen.getByRole('button', { name: /^Hide / })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pin to Tab Bar' }));
    expect(actions.toggle).toHaveBeenCalledTimes(1);
    expect((actions.toggle as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      type: 'accessory', id: 'acc-lamp',
    });
  });

  it('says Unpin once the tab is already on the bar', () => {
    renderPinnable({ editMode: true, onHide: vi.fn() }, { isPinned: () => true });
    expect(screen.getByRole('button', { name: 'Unpin from Tab Bar' })).toBeTruthy();
  });

  it('offers it disabled, not hidden, when the bar is full', () => {
    // Silently dropping the button would read as "this cannot be pinned" rather
    // than "the bar is full", which is a different and fixable problem.
    const actions = renderPinnable({ editMode: true, onHide: vi.fn() }, { isFull: true });
    const button = screen.getByRole('button', { name: /Tab Bar Full/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(actions.toggle).not.toHaveBeenCalled();
  });

  it('shows no pin button when pinning is not on offer at all', () => {
    renderTile({ editMode: true, onHide: vi.fn() });
    expect(screen.queryByRole('button', { name: /Pin|Unpin/ })).toBeNull();
  });
});

describe('collections, where nothing is hidden', () => {
  it('offers Remove in place of Hide', () => {
    // A collection has no hidden state — you chose what went in, so the
    // equivalent of hiding is taking it back out.
    const onRemove = vi.fn();
    renderTile({ editMode: true, onRemove, removeLabel: 'Remove from Collection' });

    fireEvent.click(screen.getByRole('button', { name: 'Remove from Collection' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Hide / })).toBeNull();
  });

  it('never offers remove outside edit mode', () => {
    renderTile({ onRemove: vi.fn(), removeLabel: 'Remove from Collection' });
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  });
});

describe('service groups are inert while editing too', () => {
  // The group's controls are scattered through its card rather than sitting in
  // one header slot, so an early attempt just made the card pointer-events-none.
  // That left every switch and slider visible but dead, which reads as broken
  // rather than as "not now".
  const GROUP = { id: 'grp-1', name: 'Downstairs', serviceIds: [], accessoryIds: ['acc-lamp'] };

  function renderGroup(overrides: Record<string, unknown> = {}) {
    const props = {
      group: GROUP,
      accessories: [ACCESSORY],
      onToggle: vi.fn(),
      onSlider: vi.fn(),
      getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
      compact: true,
      iconStyle: 'colourful',
      ...overrides,
    };
    render(<ServiceGroupWidget {...(props as unknown as Parameters<typeof ServiceGroupWidget>[0])} />);
  }

  it('shows its switch normally', () => {
    renderGroup();
    expect(screen.queryAllByRole('switch').length).toBeGreaterThan(0);
  });

  it('takes the switch away entirely while editing, not merely disables it', () => {
    renderGroup({ editMode: true, onHide: vi.fn() });
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
  });

  it('carries the same Hide button as an accessory tile', () => {
    const onHide = vi.fn();
    renderGroup({ editMode: true, onHide });
    fireEvent.click(screen.getByRole('button', { name: /^Hide Downstairs/ }));
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});

describe('what a long press means, by platform', () => {
  /** A tile inside a provider that says which platform this is. */
  function renderIn(layout: { touchMode: boolean; editMode: boolean }) {
    render(
      <LayoutEditProvider value={layout}>
        <PinnedTabsProvider value={{ enabled: true, isPinned: () => false, isFull: false, toggle: vi.fn() } as never}>
          <SwitchWidget {...({
            accessory: ACCESSORY,
            getEffectiveValue: (_i: string, _c: string, v: unknown) => v,
            onSetValue: vi.fn(), onSlider: vi.fn(), onToggle: vi.fn(),
            iconStyle: 'colourful', compact: true,
            homeName: 'Beach House',
          } as unknown as WidgetProps)} />
        </PinnedTabsProvider>
      </LayoutEditProvider>,
    );
  }

  it('opens the menu on a right-click, on a device with a mouse', () => {
    renderIn({ touchMode: false, editMode: false });
    fireEvent.contextMenu(screen.getByText('Ceiling Light'));
    expect(screen.getByText('Beach House · Kitchen')).toBeTruthy();
  });

  it('opens nothing on touch, where the same press is a lift', () => {
    // Not a timing question. Radix opens on a native `contextmenu` as well as
    // on its own hold timer, and an open menu puts `pointer-events: none` on
    // the body — which would kill the drag the press had just started. There is
    // no delay that separates the two, so the menu has to be absent.
    renderIn({ touchMode: true, editMode: false });
    fireEvent.contextMenu(screen.getByText('Ceiling Light'));
    expect(screen.queryByText('Beach House · Kitchen')).toBeNull();
  });

  it('still renders the tile itself on touch, menu or no menu', () => {
    renderIn({ touchMode: true, editMode: false });
    expect(screen.getByText('Ceiling Light')).toBeTruthy();
  });
});
