// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MobileTabBar, type PinnedTabStatus } from '../MobileTabBar';
import type { PinnedTab } from '@/lib/pinned-tabs';

// ExpandedOverlay portals to document.body and measures layout; in jsdom the
// measurements are all zero, so stand in for it with something assertable.
vi.mock('@/components/shared/ExpandedOverlay', () => ({
  ExpandedOverlay: ({ isExpanded, children }: { isExpanded: boolean; children: React.ReactNode }) =>
    isExpanded ? <div data-testid="control-popover">{children}</div> : null,
}));

const TABS: Record<string, PinnedTab> = {
  home: { type: 'home', id: 'HOME-1', name: 'Beach House' },
  room: { type: 'room', id: 'ROOM-1', name: 'Kitchen', homeId: 'HOME-1' },
  scene: { type: 'scene', id: 'SCENE-1', name: 'Movie night', homeId: 'HOME-1' },
  action: { type: 'action', id: 'everything-off', name: 'Everything off', homeId: 'HOME-1' },
  accessory: { type: 'accessory', id: 'ACC-1', name: 'Lamp', homeId: 'HOME-1' },
  group: { type: 'serviceGroup', id: 'GRP-1', name: 'Downstairs', homeId: 'HOME-1' },
};

function setup(tabs: PinnedTab[], overrides: Partial<React.ComponentProps<typeof MobileTabBar>> = {}) {
  const props = {
    pinnedTabs: tabs,
    selectedHomeId: null,
    selectedRoomId: null,
    selectedCollectionId: null,
    selectedCollectionGroupId: null,
    onSelectHome: vi.fn(),
    onSelectRoom: vi.fn(),
    onSelectCollection: vi.fn(),
    onSelectCollectionGroup: vi.fn(),
    onActivate: vi.fn().mockResolvedValue(undefined),
    renderControl: vi.fn((tab: PinnedTab) => <div>control for {tab.name}</div>),
    resolveStatus: vi.fn((): PinnedTabStatus => 'ready'),
    resolveAccessory: vi.fn(() => undefined),
    ...overrides,
  };
  render(<MobileTabBar {...props} />);
  return props;
}

beforeEach(() => vi.clearAllMocks());

describe('navigation tabs', () => {
  it('navigates and latches active for the view you are in', () => {
    const props = setup([TABS.home], { selectedHomeId: 'HOME-1' });

    expect(screen.getByRole('button', { name: /Beach House/ }).getAttribute('aria-current')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: /Beach House/ }));
    expect(props.onSelectHome).toHaveBeenCalledWith('HOME-1');
  });

  it('passes the home along when selecting a room', () => {
    const props = setup([TABS.room]);
    fireEvent.click(screen.getByRole('button', { name: /Kitchen/ }));
    expect(props.onSelectRoom).toHaveBeenCalledWith('HOME-1', 'ROOM-1');
  });
});

describe('run tabs', () => {
  it('runs a scene without ever latching as the current view', async () => {
    let release!: () => void;
    const onActivate = vi.fn(() => new Promise<void>(res => { release = res; }));
    setup([TABS.scene], { onActivate });

    const button = screen.getByRole('button', { name: /Movie night/ });
    fireEvent.click(button);

    expect(onActivate).toHaveBeenCalledWith(TABS.scene);

    release();
    // Once the run settles the tab must not be left looking selected — it is
    // something you did, not somewhere you are.
    await waitFor(() => expect(button.getAttribute('aria-current')).toBeNull());
  });

  it('ignores a second press while a run is still in flight', () => {
    const onActivate = vi.fn(() => new Promise<void>(() => {}));
    setup([TABS.scene, TABS.action], { onActivate });

    fireEvent.click(screen.getByRole('button', { name: /Movie night/ }));
    fireEvent.click(screen.getByRole('button', { name: /Movie night/ }));
    fireEvent.click(screen.getByRole('button', { name: /Everything off/ }));

    expect(onActivate).toHaveBeenCalledTimes(1);
  });
});

describe('popover tabs', () => {
  it('opens the control on tap and closes it on a second tap', () => {
    const props = setup([TABS.accessory]);
    const button = screen.getByRole('button', { name: /Lamp/ });

    expect(screen.queryByTestId('control-popover')).toBeNull();

    fireEvent.click(button);
    expect(screen.getByTestId('control-popover').textContent).toContain('control for Lamp');
    expect(props.renderControl).toHaveBeenCalledWith(TABS.accessory);
    expect(button.getAttribute('aria-current')).toBe('true');

    fireEvent.click(button);
    expect(screen.queryByTestId('control-popover')).toBeNull();
  });

  it('shows only one control at a time', () => {
    setup([TABS.accessory, TABS.group]);

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));
    fireEvent.click(screen.getByRole('button', { name: /Downstairs/ }));

    const open = screen.getAllByTestId('control-popover');
    expect(open).toHaveLength(1);
    expect(open[0].textContent).toContain('control for Downstairs');
  });

  it('closes an open control when navigating away', () => {
    setup([TABS.accessory, TABS.home]);

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));
    expect(screen.getByTestId('control-popover')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Beach House/ }));
    expect(screen.queryByTestId('control-popover')).toBeNull();
  });
});

describe('stale pins', () => {
  it('keeps a missing pin visible but dimmed rather than dropping it', () => {
    setup([TABS.scene], { resolveStatus: () => 'missing' });

    const button = screen.getByRole('button', { name: /Movie night/ });
    expect(button).toBeTruthy();
    expect(button.className).toContain('opacity-50');
    expect(button.getAttribute('aria-disabled')).toBe('true');
  });

  it('reports a missing pin instead of opening a control for it', () => {
    const props = setup([TABS.accessory], { resolveStatus: () => 'missing' });

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));

    expect(screen.queryByTestId('control-popover')).toBeNull();
    expect(props.onActivate).toHaveBeenCalledWith(TABS.accessory);
  });

  it('does not dim a pin that is merely still loading', () => {
    setup([TABS.accessory], { resolveStatus: () => 'loading' });
    // An offline relay must not make the bar look broken.
    expect(screen.getByRole('button', { name: /Lamp/ }).className).not.toContain('opacity-50');
  });
});

describe('labels and identity', () => {
  it('prefers a custom label over the cached name', () => {
    setup([{ ...TABS.scene, customName: 'Movie' }]);
    expect(screen.getByText('Movie')).toBeTruthy();
    expect(screen.queryByText('Movie night')).toBeNull();
  });

  it('renders the same action pinned in two homes as two independent tabs', () => {
    // The pinKey collision this feature had to fix: both were `action-…`.
    const onActivate = vi.fn().mockResolvedValue(undefined);
    setup([
      { type: 'action', id: 'everything-off', name: 'Upstairs off', homeId: 'HOME-1' },
      { type: 'action', id: 'everything-off', name: 'Cottage off', homeId: 'HOME-2' },
    ], { onActivate });

    fireEvent.click(screen.getByRole('button', { name: /Cottage off/ }));
    expect(onActivate.mock.calls[0][0].homeId).toBe('HOME-2');
  });

  it('renders nothing at all when there are no pins', () => {
    const { container } = render(
      <MobileTabBar
        pinnedTabs={[]}
        selectedHomeId={null} selectedRoomId={null}
        selectedCollectionId={null} selectedCollectionGroupId={null}
        onSelectHome={vi.fn()} onSelectRoom={vi.fn()}
        onSelectCollection={vi.fn()} onSelectCollectionGroup={vi.fn()}
        onActivate={vi.fn()} renderControl={vi.fn()}
        resolveStatus={() => 'ready'} resolveAccessory={() => undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe('edit mode', () => {
  it('renames on tap, and clears the override when the field is emptied', () => {
    const onRename = vi.fn();
    setup([{ ...TABS.room, customName: 'Kitch' }], { editMode: true, onRename });

    // A tap opens the field instead of navigating — you are arranging the bar,
    // not using it.
    fireEvent.click(screen.getByRole('button', { name: 'Kitch' }));
    const field = screen.getByRole('textbox', { name: 'Rename Kitchen' });
    expect((field as HTMLInputElement).value).toBe('Kitch');

    fireEvent.change(field, { target: { value: 'Cook' } });
    fireEvent.blur(field);
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'ROOM-1' }), 'Cook');

    // Emptying it must send `undefined`, not '' — that is what falls back to the
    // real name rather than rendering a blank tab.
    onRename.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Kitch' }));
    const again = screen.getByRole('textbox', { name: 'Rename Kitchen' });
    fireEvent.change(again, { target: { value: '   ' } });
    fireEvent.blur(again);
    expect(onRename).toHaveBeenCalledWith(expect.objectContaining({ id: 'ROOM-1' }), undefined);
  });

  it('never navigates or runs while editing', () => {
    const props = setup([TABS.room, TABS.scene], { editMode: true });

    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Movie night' }));

    expect(props.onSelectRoom).not.toHaveBeenCalled();
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('unpins the tab whose badge was pressed', () => {
    const onUnpin = vi.fn();
    setup([TABS.home, TABS.room], { editMode: true, onUnpin });

    fireEvent.click(screen.getByRole('button', { name: 'Unpin Kitchen' }));
    expect(onUnpin).toHaveBeenCalledTimes(1);
    expect(onUnpin.mock.calls[0][0].id).toBe('ROOM-1');
  });

  it('offers no unpin or rename affordances outside edit mode', () => {
    setup([TABS.room]);
    expect(screen.queryByRole('button', { name: /Unpin/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('still renders, with an Add slot, when editing an empty bar', () => {
    // Otherwise unpinning your last tab leaves no bar and no way back to one.
    const onRequestPin = vi.fn();
    setup([], { editMode: true, onRequestPin });

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(onRequestPin).toHaveBeenCalled();
  });

  it('hides the Add slot once the bar is full', () => {
    setup(
      [TABS.home, TABS.room, TABS.scene, TABS.action, TABS.accessory],
      { editMode: true },
    );
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
  });

  it('never puts the wiggle and the drag transform on one element', () => {
    // `.wiggle` animates `transform: rotate(...)`, and a running CSS animation
    // outranks an inline style — so sharing an element silently replaced
    // dnd-kit's translate and the tabs stopped moving aside as you dragged.
    // Nothing appeared to happen until the drop reordered the DOM.
    const { container } = render(
      <MobileTabBar
        pinnedTabs={[TABS.home, TABS.room]}
        selectedHomeId={null} selectedRoomId={null}
        selectedCollectionId={null} selectedCollectionGroupId={null}
        onSelectHome={vi.fn()} onSelectRoom={vi.fn()}
        onSelectCollection={vi.fn()} onSelectCollectionGroup={vi.fn()}
        onActivate={vi.fn()} renderControl={vi.fn()}
        resolveStatus={() => 'ready'} resolveAccessory={() => undefined}
        editMode onReorder={vi.fn()} onRename={vi.fn()} onUnpin={vi.fn()}
      />,
    );

    // Asserting on `style.transform` would be vacuous: dnd-kit only writes one
    // during an actual drag, which jsdom cannot perform. So assert the structure
    // that makes the clash impossible — the wiggling element is never the node
    // dnd-kit transforms.
    expect(container.querySelectorAll('[data-sortable-node]')).toHaveLength(2);
    expect(container.querySelectorAll('.wiggle')).toHaveLength(2);
    expect(container.querySelectorAll('[data-sortable-node].wiggle')).toHaveLength(0);
  });

  it('latches nothing active while editing', () => {
    setup([TABS.home], { editMode: true, selectedHomeId: 'HOME-1' });
    expect(screen.getByRole('button', { name: 'Beach House' }).getAttribute('aria-current')).toBeNull();
  });
});
