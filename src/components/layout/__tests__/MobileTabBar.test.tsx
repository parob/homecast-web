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

// jsdom has no ResizeObserver, and the bar watches its own row so the end
// fades stay right when a pin is renamed. Same stub the scenes tests use.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;

// Nor scrollIntoView, which the bar calls to bring the active chip into view.
Element.prototype.scrollIntoView = vi.fn();

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

/**
 * Scenes and shortcuts no longer fire from the bar.
 *
 * They used to run the moment you touched the chip, which made the two most
 * consequential things you can pin — "Everything off", "Lock up" — the two
 * easiest to set off by accident, from a row of small targets along the bottom
 * edge of a phone. They open their own card now and the card runs them.
 */
describe('scene and shortcut tabs', () => {
  it('opens a scene\'s card instead of running it', () => {
    const props = setup([TABS.scene]);

    fireEvent.click(screen.getByRole('button', { name: /Movie night/ }));

    expect(screen.getByTestId('control-popover')).toBeTruthy();
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('opens a shortcut\'s card instead of running it', () => {
    const props = setup([TABS.action]);

    fireEvent.click(screen.getByRole('button', { name: /Everything off/ }));

    expect(screen.getByTestId('control-popover')).toBeTruthy();
    expect(props.onActivate).not.toHaveBeenCalled();
  });

  it('closes the card on a second press, like any other panel', () => {
    setup([TABS.scene]);
    const button = screen.getByRole('button', { name: /Movie night/ });

    fireEvent.click(button);
    expect(screen.queryByTestId('control-popover')).toBeTruthy();

    fireEvent.click(button);
    expect(screen.queryByTestId('control-popover')).toBeNull();
  });

  it('latches only while its card is open — it is not somewhere you are', () => {
    setup([TABS.scene]);
    const button = screen.getByRole('button', { name: /Movie night/ });

    expect(button.getAttribute('aria-current')).toBeNull();
    fireEvent.click(button);
    expect(button.getAttribute('aria-current')).toBe('true');
    fireEvent.click(button);
    expect(button.getAttribute('aria-current')).toBeNull();
  });

  it('still reports a pin whose target has gone, rather than opening nothing', () => {
    const props = setup([TABS.scene], { resolveStatus: () => 'missing' as PinnedTabStatus });

    fireEvent.click(screen.getByRole('button', { name: /Movie night/ }));

    expect(props.onActivate).toHaveBeenCalledWith(TABS.scene);
    expect(screen.queryByTestId('control-popover')).toBeNull();
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
    const renderControl = vi.fn((tab: PinnedTab) => <div>control for {tab.homeId}</div>);
    setup([
      { type: 'action', id: 'everything-off', name: 'Upstairs off', homeId: 'HOME-1' },
      { type: 'action', id: 'everything-off', name: 'Cottage off', homeId: 'HOME-2' },
    ], { renderControl });

    fireEvent.click(screen.getByRole('button', { name: /Cottage off/ }));

    // Each opens its own home's card; a shared key would have opened the first.
    expect(screen.getByTestId('control-popover').textContent).toContain('HOME-2');
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
  it('renames from the editor, and clears the override when the field is emptied', () => {
    const onRename = vi.fn();
    setup([{ ...TABS.room, customName: 'Kitch' }], { editMode: true, onRename });

    // A tap opens the editor instead of navigating — you are arranging the bar,
    // not using it.
    fireEvent.click(screen.getByRole('button', { name: 'Kitch' }));
    const field = screen.getByLabelText('Name') as HTMLInputElement;
    expect(field.value).toBe('Kitch');

    fireEvent.change(field, { target: { value: 'Cook' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ROOM-1' }),
      { customName: 'Cook', customIcon: undefined },
    );

    // Emptying it must send `undefined`, not '' — that is what falls back to the
    // real name rather than rendering a blank tab.
    onRename.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Kitch' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ROOM-1' }),
      { customName: undefined, customIcon: undefined },
    );
  });

  it('gives a tab a hand-picked icon, and hands back the key that was stored', () => {
    const onRename = vi.fn();
    setup([TABS.room], { editMode: true, onRename });

    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    fireEvent.click(screen.getByRole('button', { name: 'cooking pot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ROOM-1' }),
      { customName: undefined, customIcon: 'cooking-pot' },
    );
  });

  it('sends both overrides in one call, so setting an icon cannot drop a rename', () => {
    const onRename = vi.fn();
    setup([TABS.room], { editMode: true, onRename });

    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Galley' } });
    fireEvent.click(screen.getByRole('button', { name: 'cooking pot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onRename).toHaveBeenCalledTimes(1);
    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ROOM-1' }),
      { customName: 'Galley', customIcon: 'cooking-pot' },
    );
  });

  it('goes back to the derived icon when the default is picked again', () => {
    const onRename = vi.fn();
    setup([{ ...TABS.room, customIcon: 'cooking-pot' }], { editMode: true, onRename });

    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    fireEvent.click(screen.getByRole('button', { name: /Default icon for Kitchen/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));

    expect(onRename).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ROOM-1' }),
      { customName: undefined, customIcon: undefined },
    );
  });

  it('never navigates or runs while editing', () => {
    const props = setup([TABS.room, TABS.scene], { editMode: true });

    // One at a time: the editor is modal, so the second tab is not reachable
    // until the first is dismissed.
    fireEvent.click(screen.getByRole('button', { name: 'Kitchen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
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

  it('draws nothing at all once the last pin is removed, even while editing', () => {
    // There is no "Add" affordance on the bar — you pin things from the thing
    // itself — so an empty bar has nothing to say and should not be a stray
    // empty pill floating over the dashboard.
    const { container } = render(
      <MobileTabBar
        pinnedTabs={[]}
        selectedHomeId={null} selectedRoomId={null}
        selectedCollectionId={null} selectedCollectionGroupId={null}
        onSelectHome={vi.fn()} onSelectRoom={vi.fn()}
        onSelectCollection={vi.fn()} onSelectCollectionGroup={vi.fn()}
        onActivate={vi.fn()} renderControl={vi.fn()}
        resolveStatus={() => 'ready'} resolveAccessory={() => undefined}
        editMode onReorder={vi.fn()} onRename={vi.fn()} onUnpin={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('latches nothing active while editing', () => {
    setup([TABS.home], { editMode: true, selectedHomeId: 'HOME-1' });
    expect(screen.getByRole('button', { name: 'Beach House' }).getAttribute('aria-current')).toBeNull();
  });
});

/**
 * Sliding along the bar before letting go.
 *
 * The bar is a row of small targets at the bottom edge of a phone, so a press
 * is not committed until it is released: whatever the thumb is nearest at
 * release is what runs.
 *
 * Nearest, not underneath. The lit tab is the wide one, so the bar re-lays
 * itself out as the finger crosses it and a swipe aimed at either end used to
 * run out of bar before it ran out of thumb. Now x alone decides and y is
 * ignored entirely.
 *
 * jsdom lays nothing out, so every rect is zero — stand in a real row: 40px
 * capsules on a 50px pitch, so tab 0 spans 0–40 and tab 1 spans 50–90.
 */
describe('press and slide', () => {
  const PITCH = 50;
  const CAPSULE = 40;

  /** Give the rendered tabs a geometry to be near. */
  const layOutBar = () => {
    document.querySelectorAll<HTMLElement>('[data-tab-key]').forEach((slot, i) => {
      const left = i * PITCH;
      slot.getBoundingClientRect = () => ({
        left, right: left + CAPSULE, top: 0, bottom: 44,
        x: left, y: 0, width: CAPSULE, height: 44, toJSON: () => ({}),
      }) as DOMRect;
    });
  };

  const bar = () => screen.getByRole('button', { name: /Beach House/ }).parentElement!.parentElement!;

  /** Press, optionally slide, and let go. */
  const slide = (from: number, to = from, y = 0) => {
    fireEvent.pointerDown(bar(), { clientX: from, clientY: 0 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: to, clientY: y }));
    fireEvent(window, new PointerEvent('pointerup', { clientX: to, clientY: y }));
  };

  it('acts on the tab under the finger at release, not the one pressed', () => {
    const props = setup([TABS.home, TABS.room]);
    layOutBar();

    slide(10, 60);

    expect(props.onSelectRoom).toHaveBeenCalledWith('HOME-1', 'ROOM-1');
    expect(props.onSelectHome).not.toHaveBeenCalled();
  });

  it('picks the nearer capsule when the finger is in the gap between two', () => {
    const props = setup([TABS.home, TABS.room]);
    layOutBar();

    // 47 is 7px past the end of tab 0 and 3px short of tab 1.
    slide(10, 47);

    expect(props.onSelectRoom).toHaveBeenCalledWith('HOME-1', 'ROOM-1');
  });

  /**
   * The three ways the old hit test came back with nothing, and the swipe died.
   */
  it('holds the left-most tab when the finger runs off the left end', () => {
    const props = setup([TABS.home, TABS.room]);
    layOutBar();

    slide(60, -400);

    expect(props.onSelectHome).toHaveBeenCalledWith('HOME-1');
    expect(props.onSelectRoom).not.toHaveBeenCalled();
  });

  it('holds the right-most tab when the finger runs off the right end', () => {
    const props = setup([TABS.home, TABS.room]);
    layOutBar();

    slide(10, 400);

    expect(props.onSelectRoom).toHaveBeenCalledWith('HOME-1', 'ROOM-1');
    expect(props.onSelectHome).not.toHaveBeenCalled();
  });

  it('holds its tab when the finger slides above or below the bar', () => {
    const props = setup([TABS.home, TABS.room]);
    layOutBar();

    slide(60, 60, -400); // dragged up over the dashboard

    expect(props.onSelectRoom).toHaveBeenCalledWith('HOME-1', 'ROOM-1');
  });

  it('lights the tab it would commit to while the finger is still down', () => {
    setup([TABS.home, TABS.room]);
    layOutBar();

    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 999, clientY: -400 }));

    // Only one tab is lit at a time, and it is the one the release would take.
    // (The label is no signal — it is always rendered, collapsed to max-w-0.)
    expect(screen.getByRole('button', { name: /Kitchen/ }).className).toContain('bg-primary');
    expect(screen.getByRole('button', { name: /Beach House/ }).className).not.toContain('bg-primary');
  });

  /**
   * The name belongs above the bar, not under the thumb covering it.
   *
   * The capsule that grows its label is the one you are pressing, so the label
   * arrives exactly where it cannot be read — and widens the bar on its way.
   * The callout says it where there is nothing in front of it, and the capsule
   * underneath stops growing at all once the finger aims past the open tab.
   */
  /** Is this tab wearing its label? Collapsed ones are still rendered, at max-w-0. */
  const labelled = (name: RegExp) =>
    !screen.getByRole('button', { name }).querySelector('span[aria-hidden]')!
      .className.includes('max-w-0');

  it('keeps every name on show throughout the slide, not just the one aimed at', () => {
    setup([TABS.home, TABS.room]);
    layOutBar();

    const named = () => screen.getAllByRole('button').map(b => b.textContent);
    expect(named()).toEqual(expect.arrayContaining(['Beach House', 'Kitchen']));

    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 60, clientY: 0 }));

    // The old bar hid the labels here and named the aimed-at tab in a callout
    // above itself. Nothing is hidden now, so there is nothing to restore.
    expect(named()).toEqual(expect.arrayContaining(['Beach House', 'Kitchen']));
  });

  it('leaves the open tab labelled while the finger is still on it', () => {
    setup([TABS.home, TABS.room], { selectedHomeId: 'HOME-1' });
    layOutBar();

    // Every ordinary tap of the view you are already in: nothing may move.
    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });

    expect(labelled(/Beach House/)).toBe(true);
  });

  it('moves only the fill as the finger crosses tabs — the labels stay put', () => {
    setup([TABS.home, TABS.room], { selectedHomeId: 'HOME-1' });
    layOutBar();

    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 60, clientY: 0 }));

    // Both still named — the row does not reflow under the thumb, which is
    // what the labels appearing and disappearing used to cause.
    expect(labelled(/Beach House/)).toBe(true);
    expect(labelled(/Kitchen/)).toBe(true);
    // The fill is the only thing that follows, and it says what a release takes.
    expect(screen.getByRole('button', { name: /Kitchen/ }).className).toContain('bg-primary');
    expect(screen.getByRole('button', { name: /Beach House/ }).className).not.toContain('bg-primary');
  });

  it('does not fire twice when the release is followed by its own click', () => {
    const props = setup([TABS.home]);
    layOutBar();
    const home = screen.getByRole('button', { name: /Beach House/ });

    slide(10);
    fireEvent.click(home); // the click the browser sends after every tap

    expect(props.onSelectHome).toHaveBeenCalledTimes(1);
  });

  it('still works from the keyboard, where no pointer gesture happens', () => {
    const props = setup([TABS.home]);
    fireEvent.click(screen.getByRole('button', { name: /Beach House/ }));
    expect(props.onSelectHome).toHaveBeenCalledTimes(1);
  });

  it('leaves the gesture alone while arranging, so dnd-kit keeps the pointer', () => {
    const props = setup([TABS.home, TABS.room], { editMode: true });
    layOutBar();

    slide(10, 60);

    expect(props.onSelectRoom).not.toHaveBeenCalled();
    expect(props.onSelectHome).not.toHaveBeenCalled();
  });
});

/**
 * The end fades.
 *
 * A fade on an end you have already reached claims there is more that way when
 * there is not, which reads as a rendering fault rather than an affordance —
 * so each end is masked only while something is actually beyond it. jsdom
 * reports every box as zero, so the scroller's metrics are stubbed.
 */
describe('scroll fades', () => {
  // Each tab sits in its own TabSlot wrapper, so the scroller is a level
  // further up than the button's parent.
  const scroller = () => document.querySelector<HTMLElement>('.overflow-x-auto')!;

  const metrics = (scrollWidth: number, clientWidth: number, scrollLeft: number) => {
    const el = scroller();
    Object.defineProperty(el, 'scrollWidth', { value: scrollWidth, configurable: true });
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
    el.scrollLeft = scrollLeft;
    fireEvent.scroll(el);
    return el;
  };

  it('fades neither end when the whole row fits', () => {
    setup([TABS.home, TABS.room]);
    const el = metrics(200, 200, 0);
    expect(el.className).not.toContain('tab-fade-left');
    expect(el.className).not.toContain('tab-fade-right');
  });

  it('fades only the right at the start of a row that overflows', () => {
    setup([TABS.home, TABS.room, TABS.scene]);
    const el = metrics(600, 300, 0);
    expect(el.className).not.toContain('tab-fade-left');
    expect(el.className).toContain('tab-fade-right');
  });

  it('fades only the left once the far end is reached', () => {
    setup([TABS.home, TABS.room, TABS.scene]);
    const el = metrics(600, 300, 300);
    expect(el.className).toContain('tab-fade-left');
    expect(el.className).not.toContain('tab-fade-right');
  });

  it('fades both ends in the middle', () => {
    setup([TABS.home, TABS.room, TABS.scene]);
    const el = metrics(600, 300, 150);
    expect(el.className).toContain('tab-fade-both');
  });

  /**
   * While the row overflows the browser owns this axis as a pan — it takes the
   * pointer and cancels our gesture, so a swipe scrolls and only a tap picks.
   * With nothing to pan, the axis goes back to slide-to-select.
   */
  it('hands the axis to the browser only while there is something to scroll', () => {
    setup([TABS.home, TABS.room, TABS.scene]);
    expect(metrics(600, 300, 0).className).toContain('touch-pan-x');
    expect(metrics(300, 300, 0).className).toContain('touch-none');
  });
});

/**
 * Centring the tab you pressed.
 *
 * Driven by the press, not by whatever became active. Keyed off "active" it
 * also fired when a panel closed and handed that state back to the page you
 * were already on, so shutting a panel slid the bar as though you had
 * navigated somewhere.
 *
 * The scroll is ours rather than `scroll-behavior: smooth`, whose duration the
 * browser picks and whose scroll events arrive on its own schedule — which the
 * open panel follows, so it inherited that cadence and juddered. jsdom lays
 * nothing out, so the metrics are stubbed; reduced motion is switched on to
 * make the move land in one tick.
 */
describe('centring the pressed tab', () => {
  const scroller = () => document.querySelector<HTMLElement>('.overflow-x-auto')!;

  /**
   * 100px chips in a window `clientWidth` wide; chip n starts at n*100 in the
   * row, so its centre is n*100 + 50.
   *
   * Stubbed through `getBoundingClientRect`, which is what the code reads —
   * and reads for a reason. `offsetLeft` is measured from the offsetParent,
   * and every chip's is its own `TabSlot` wrapper (`position: relative`, so it
   * can anchor the unpin badge), so `offsetLeft` is about zero for all of them.
   * Stubbing that instead let a version through that never moved the bar.
   */
  const layOut = (clientWidth = 300) => {
    const el = scroller();
    Object.defineProperty(el, 'clientWidth', { value: clientWidth, configurable: true });
    Object.defineProperty(el, 'scrollWidth', { value: 500, configurable: true });
    el.getBoundingClientRect = () => ({
      left: 0, right: clientWidth, top: 0, bottom: 44,
      x: 0, y: 0, width: clientWidth, height: 44, toJSON: () => ({}),
    }) as DOMRect;
    el.querySelectorAll<HTMLElement>('[data-tab-key]').forEach((chip, n) => {
      // Scroll-aware, like a real rect: the row slides under the window.
      chip.getBoundingClientRect = () => {
        const left = n * 100 - el.scrollLeft;
        return { left, right: left + 100, top: 0, bottom: 44,
          x: left, y: 0, width: 100, height: 44, toJSON: () => ({}) } as DOMRect;
      };
    });
    return el;
  };

  beforeEach(() => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia;
  });

  it('scrolls the pressed tab to the middle', () => {
    setup([TABS.home, TABS.room, TABS.scene]);
    const el = layOut();

    fireEvent.click(screen.getByRole('button', { name: /Movie night/ }));

    // Chip 2 spans 200..300, centre 250; window is 300 wide, so 250 - 150.
    expect(el.scrollLeft).toBe(100);
  });

  it('centres a popover tab too — its panel rides across with it', () => {
    setup([TABS.home, TABS.accessory]);
    const el = layOut();

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));

    // Chip 1 centre is 150, dead centre of the window, so no travel.
    expect(el.scrollLeft).toBe(0);
  });

  it('never scrolls past either end', () => {
    setup([TABS.home, TABS.room, TABS.scene]);
    const el = layOut();

    fireEvent.click(screen.getByRole('button', { name: /Beach House/ }));
    expect(el.scrollLeft).toBe(0);           // centring chip 0 would want -150

    fireEvent.click(screen.getByRole('button', { name: /Movie night/ }));
    expect(el.scrollLeft).toBe(100);         // and the far end caps at 200
  });

  it('centres the chip you pressed to close, never the page behind it', () => {
    setup([TABS.room, TABS.accessory], { selectedRoomId: 'ROOM-1' });
    const el = layOut(150);   // room centres at 0, the lamp at 75

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));
    expect(el.scrollLeft).toBe(75);

    // Closing hands "active" back to the room, whose chip centres at 0. The bar
    // must stay on the chip that was pressed.
    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));
    expect(el.scrollLeft).toBe(75);
  });

  it('leaves the bar where it is while arranging, where a tap opens the editor', () => {
    setup([TABS.home, TABS.room], { editMode: true });
    // Edit mode has no inner scroller; the pill itself is the scrollable one.
    const pill = document.querySelector<HTMLElement>('.overflow-x-auto')!;
    pill.scrollLeft = 42;

    fireEvent.click(screen.getByRole('button', { name: /Kitchen/ }));

    expect(pill.scrollLeft).toBe(42);
  });
});

/**
 * The real path a finger takes, not `click`.
 *
 * A press is committed on pointerup by the slide gesture, and the click the
 * browser sends afterwards is meant to be swallowed. If that swallow ever
 * misses, the tap runs twice and a toggle lands back where it started — which
 * looks exactly like a chip that refuses to stay lit.
 */
describe('a scene chip pressed the way a finger presses it', () => {
  const bar = () => document.querySelector<HTMLElement>('.overflow-x-auto')!;
  const chip = (name: RegExp) => screen.getByRole('button', { name });

  const press = (name: RegExp) => {
    const el = chip(name);
    document.elementFromPoint = vi.fn(() => el);
    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointerup', { clientX: 10, clientY: 0 }));
    // The click the browser always sends after a tap.
    fireEvent.click(el);
  };

  it('stays lit after one press', () => {
    setup([TABS.scene]);
    press(/Movie night/);
    expect(chip(/Movie night/).getAttribute('aria-current')).toBe('true');
    expect(screen.queryByTestId('control-popover')).toBeTruthy();
  });

  it('closes on the second press, not the first', () => {
    setup([TABS.scene]);
    press(/Movie night/);
    expect(screen.queryByTestId('control-popover')).toBeTruthy();
    press(/Movie night/);
    expect(screen.queryByTestId('control-popover')).toBeNull();
    expect(chip(/Movie night/).getAttribute('aria-current')).toBeNull();
  });

  it('does the same for a shortcut', () => {
    setup([TABS.action]);
    press(/Everything off/);
    expect(chip(/Everything off/).getAttribute('aria-current')).toBe('true');
  });
});

/**
 * Which chip wears the fill when more than one thing is "active".
 *
 * A pinned room reads as active the whole time you are looking at it, and
 * `activeKey` takes the first tab that does — so opening a scene's card lit
 * nothing, because the room was found first and kept the fill. This is the
 * case the single-pin tests could not see.
 */
describe('the fill when a page and a panel are both live', () => {
  it('gives an open scene card the fill, not the room you are standing in', () => {
    setup([TABS.room, TABS.scene], { selectedRoomId: 'ROOM-1' });
    const room = screen.getByRole('button', { name: /Kitchen/ });
    const scene = screen.getByRole('button', { name: /Movie night/ });

    expect(room.className).toContain('bg-primary');

    fireEvent.click(scene);
    expect(scene.className).toContain('bg-primary');
    expect(room.className).not.toContain('bg-primary');
  });

  it('hands the fill back to the room when the card closes', () => {
    setup([TABS.room, TABS.scene], { selectedRoomId: 'ROOM-1' });
    const room = screen.getByRole('button', { name: /Kitchen/ });
    const scene = screen.getByRole('button', { name: /Movie night/ });

    fireEvent.click(scene);
    fireEvent.click(scene);

    expect(room.className).toContain('bg-primary');
    expect(scene.className).not.toContain('bg-primary');
  });

  it('does the same for an accessory panel', () => {
    setup([TABS.room, TABS.accessory], { selectedRoomId: 'ROOM-1' });
    const lamp = screen.getByRole('button', { name: /Lamp/ });

    fireEvent.click(lamp);
    expect(lamp.className).toContain('bg-primary');
    expect(screen.getByRole('button', { name: /Kitchen/ }).className).not.toContain('bg-primary');
  });
});

/**
 * Collapsed names — the Display setting.
 *
 * Five names is the honest default, but it is a wide bar, and someone who knows
 * their own five glyphs would rather have the room back. Collapsed, only the
 * chip you are on is named, and a callout above the bar does the naming while
 * a finger travels — because a capsule that grows its name under a thumb has
 * put that name in the one place on screen it cannot be read.
 */
describe('collapsed tab names', () => {
  const bar = () => document.querySelector<HTMLElement>('.overflow-x-auto')!;
  const named = (re: RegExp) => {
    const span = screen.getByRole('button', { name: re }).querySelector('span[aria-hidden]');
    return !span?.className.includes('max-w-0');
  };
  const callout = () => screen.queryByTestId('tab-callout');

  /**
   * The slide picks the chip nearest along x, so it needs real horizontal
   * extents. jsdom reports every rect as zero, which makes the first chip the
   * nearest to everything.
   */
  const layOut = () => {
    document.querySelectorAll<HTMLElement>('[data-tab-key]').forEach((chip, n) => {
      const left = n * 50;
      chip.getBoundingClientRect = () => ({
        left, right: left + 40, top: 0, bottom: 44,
        x: left, y: 0, width: 40, height: 44, toJSON: () => ({}),
      }) as DOMRect;
    });
  };

  it('names only the tab you are on', () => {
    setup([TABS.home, TABS.room], { collapseNames: true, selectedHomeId: 'HOME-1' });
    expect(named(/Beach House/)).toBe(true);
    expect(named(/Kitchen/)).toBe(false);
  });

  it('names all of them when the setting is off', () => {
    setup([TABS.home, TABS.room], { selectedHomeId: 'HOME-1' });
    expect(named(/Beach House/)).toBe(true);
    expect(named(/Kitchen/)).toBe(true);
  });

  it('names all of them while arranging, whatever the setting says', () => {
    setup([TABS.home, TABS.room], { collapseNames: true, editMode: true });
    expect(named(/Beach House/)).toBe(true);
    expect(named(/Kitchen/)).toBe(true);
  });

  it('hands the naming to a callout while a finger travels', () => {
    setup([TABS.home, TABS.room], { collapseNames: true, selectedHomeId: 'HOME-1' });
    layOut();

    expect(callout()).toBeNull();

    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 60, clientY: 0 }));

    expect(callout()?.textContent).toContain('Kitchen');
    // The bar itself goes quiet: nothing reflows under the thumb.
    expect(named(/Beach House/)).toBe(false);
    expect(named(/Kitchen/)).toBe(false);
  });

  it('takes the callout away once the finger lifts', () => {
    setup([TABS.home, TABS.room], { collapseNames: true, selectedHomeId: 'HOME-1' });
    layOut();

    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointerup', { clientX: 60, clientY: 0 }));

    expect(callout()).toBeNull();
  });

  it('shows no callout at all when names are not collapsed', () => {
    setup([TABS.home, TABS.room], { selectedHomeId: 'HOME-1' });
    layOut();

    fireEvent.pointerDown(bar(), { clientX: 10, clientY: 0 });
    fireEvent(window, new PointerEvent('pointermove', { clientX: 60, clientY: 0 }));

    expect(callout()).toBeNull();
  });
});
