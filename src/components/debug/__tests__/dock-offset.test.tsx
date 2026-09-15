// @vitest-environment jsdom
//
// The tab bar sits above the request log dock rather than on top of it.
//
// The two cannot be reasoned about apart: `DebugDock` squashes the app by
// making its wrapper a containing block for `fixed` children, and the bar
// escapes that by portalling to `document.body` — so it is only the pair,
// rendered together, that shows whether the bar clears the log. Measured on a
// real page at 440×956 the pill sat at 908–944 with the dock spanning 696–956,
// i.e. inside it, and over the collapsed bar's expand chevron.
//
// jsdom does no layout, so the assertions here are on the offset the bar asks
// for; the pixels were checked in Chromium.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DebugDock } from '../DebugDock';
import { MobileTabBar, type PinnedTabStatus } from '@/components/layout/MobileTabBar';
import { setRequestPanelEnabled } from '@/lib/request-log';
import { getDebugDockHeight } from '@/lib/debug-dock';
import type { PinnedTab } from '@/lib/pinned-tabs';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
Element.prototype.scrollIntoView = vi.fn();

const TABS: PinnedTab[] = [
  { type: 'room', id: 'ROOM-1', name: 'Kitchen', homeId: 'HOME-1' },
];

/** The dock's own number, from RequestLogPanel. */
const DEFAULT_HEIGHT = 260;

function renderApp() {
  return render(
    <DebugDock>
      <div>dashboard</div>
      <MobileTabBar
        pinnedTabs={TABS}
        selectedHomeId={null}
        selectedRoomId={null}
        selectedCollectionId={null}
        selectedCollectionGroupId={null}
        onSelectHome={vi.fn()}
        onSelectRoom={vi.fn()}
        onSelectCollection={vi.fn()}
        onSelectCollectionGroup={vi.fn()}
        onActivate={vi.fn().mockResolvedValue(undefined)}
        renderControl={() => <div>control</div>}
        resolveStatus={(): PinnedTabStatus => 'ready'}
        resolveAccessory={() => undefined}
      />
    </DebugDock>,
  );
}

const bar = () => screen.getByTestId('tab-bar');

beforeEach(() => setRequestPanelEnabled(false));
afterEach(() => setRequestPanelEnabled(false));

describe('the tab bar and the request log dock', () => {
  it('sits on the bottom edge while the log is off', () => {
    renderApp();
    expect(bar().style.bottom).toBe('0px');
    // …and takes the home indicator into account, which is only its business
    // while it is the thing on the bottom edge.
    expect(bar().style.paddingBottom).toBe('max(6px, var(--safe-area-bottom, 0px))');
  });

  it('lifts by the height of the open log', async () => {
    setRequestPanelEnabled(true);
    renderApp();

    await screen.findByText('Requests');
    await waitFor(() => expect(bar().style.bottom).toBe(`${DEFAULT_HEIGHT}px`));
    // The dock is on the bottom edge now, so the inset below it is the dock's
    // to respect and the bar keeps only its own gap.
    expect(bar().style.paddingBottom).toBe('6px');
  });

  it('returns the bottom edge to the app when the log is minimised, and takes it back', async () => {
    setRequestPanelEnabled(true);
    renderApp();

    await screen.findByText('Requests');
    fireEvent.click(screen.getByTitle('Minimise'));

    // Minimised the log floats in the corner rather than docking, so it
    // reserves nothing: the bar goes back to the bottom edge, safe-area inset
    // and all. It used to stop 52px up, on a full-width collapsed bar.
    await waitFor(() => expect(bar().style.bottom).toBe('0px'));
    expect(bar().style.paddingBottom).toBe('max(6px, var(--safe-area-bottom, 0px))');

    // …and the floating button is still the way back in.
    fireEvent.click(screen.getByLabelText('Expand request log'));
    await waitFor(() => expect(bar().style.bottom).toBe(`${DEFAULT_HEIGHT}px`));
  });

  it('holds the pill clear of the floating button while minimised', async () => {
    setRequestPanelEnabled(true);
    renderApp();

    await screen.findByText('Requests');
    const ceiling = () => screen.getByTestId('tab-pill').style.maxWidth;
    expect(ceiling()).toBe('calc(100% - 32px)');

    fireEvent.click(screen.getByTitle('Minimise'));

    // jsdom lays nothing out, so the button measures 0 wide and only the gap
    // survives — enough to prove the rail reaches the bar, not what it is
    // worth. The pixels are in screenshots/request-log-minimised.spec.ts.
    await waitFor(() => expect(ceiling()).not.toBe('calc(100% - 32px)'));

    fireEvent.click(screen.getByLabelText('Expand request log'));
    await waitFor(() => expect(ceiling()).toBe('calc(100% - 32px)'));
  });

  it('returns to the bottom edge when the log is switched off', async () => {
    setRequestPanelEnabled(true);
    const { rerender } = renderApp();
    await screen.findByText('Requests');
    await waitFor(() => expect(bar().style.bottom).toBe(`${DEFAULT_HEIGHT}px`));

    setRequestPanelEnabled(false);
    rerender(<div />);

    await waitFor(() => expect(getDebugDockHeight()).toBe(0));
  });
});
