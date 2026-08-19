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

  // A spinner used to replace the tab's icon while it ran, which cost the one
  // thing the row is for: with more than one pin going you could not tell which
  // tab you had pressed. The ring goes around the icon instead.
  it('keeps the tab icon visible while the run is in flight, and rings it', () => {
    const onActivate = vi.fn(() => new Promise<void>(() => {}));
    setup([TABS.action], { onActivate });

    const tab = screen.getByRole('button', { name: /Everything off/ });
    const iconOf = (el: HTMLElement) => el.querySelector('svg.lucide');

    expect(iconOf(tab)).toBeTruthy();
    expect(tab.querySelector('[aria-busy="true"]')).toBeNull();

    fireEvent.click(tab);

    expect(iconOf(tab)).toBeTruthy();
    // Specifically not the loader glyph standing in for the tab's own icon.
    expect(tab.querySelector('svg.lucide-loader-circle')).toBeNull();
    expect(tab.querySelector('[aria-busy="true"]')).toBeTruthy();
    expect(tab.querySelector('span.animate-spin')).toBeTruthy();
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
 * What the bar does when a panel opens and closes.
 *
 * Both of these were reported together and share one cause: the bar treated
 * opening an accessory's panel as navigation, so it scrolled the chip out from
 * under the panel that had just been anchored to it, and then scrolled back
 * again on close as though you had gone somewhere.
 */
describe('opening a control panel', () => {
  const scrolls = () => (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mock.calls.length;

  it('does not scroll the row when a popover pin is pressed', () => {
    setup([TABS.home, TABS.accessory]);
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));

    // The chip you just pressed is already under your thumb. Moving it took the
    // panel's anchor with it and put the widget off the side of the screen.
    expect(scrolls()).toBe(0);
  });

  it('does not slide back to the page you were already on when the panel closes', () => {
    setup([TABS.room, TABS.accessory], { selectedRoomId: 'ROOM-1' });

    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));
    (Element.prototype.scrollIntoView as ReturnType<typeof vi.fn>).mockClear();

    // Closing hands "active" back to the room, which the bar never left.
    fireEvent.click(screen.getByRole('button', { name: /Lamp/ }));

    expect(scrolls()).toBe(0);
  });

  it('still finds the tab for a room you navigate to', () => {
    setup([TABS.room, TABS.accessory], { selectedRoomId: 'ROOM-1' });
    // The case the scrolling exists for: a navigate pin that is newly current.
    expect(scrolls()).toBeGreaterThan(0);
  });
});
