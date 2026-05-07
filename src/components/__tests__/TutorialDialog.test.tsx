// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { TutorialDialog } from '../TutorialDialog';

// Walk the tutorial forward N times by clicking the Next button.
// `findByRole` waits up to 1s for the button to appear — covers the dialog's
// initial warm-up state (where only a loading spinner is rendered until the
// host's demo data sentinel is visible) without explicit timing in each test.
async function advance(n: number) {
  for (let i = 0; i < n; i++) {
    const next = await screen.findByRole('button', { name: /next/i });
    await act(async () => { fireEvent.click(next); });
    await act(async () => { await new Promise(r => setTimeout(r, 200)); });
  }
}

function Wrapper({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <TutorialDialog
      open={open}
      onOpenChange={(o) => { if (!o) { setOpen(false); onClose(); } }}
      onComplete={() => { setOpen(false); onClose(); }}
    />
  );
}

// Attach a real bounding rect to a DOM element so getBoundingClientRect returns
// non-zero values inside jsdom (where it returns 0,0,0,0 by default).
function withRect(el: HTMLElement, rect: { top: number; left: number; width: number; height: number }) {
  Object.defineProperty(el, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      ...rect,
      bottom: rect.top + rect.height,
      right: rect.left + rect.width,
      x: rect.left,
      y: rect.top,
      toJSON: () => ({}),
    }),
  });
}

describe('TutorialDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    // Force a desktop-width viewport so useIsMobile resolves false; we test
    // mobile-only branches via a dedicated test below.
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = '';
  });

  it('opens the home context menu via the contextmenu trigger and spotlights Share', async () => {
    // Set up a fake sidebar with a home item. When the home receives a
    // contextmenu event we simulate Radix opening the menu by appending a
    // Share row to the DOM with the data-tour the tutorial expects.
    const home = document.createElement('div');
    home.setAttribute('data-tour', 'sidebar-home-item');
    withRect(home, { top: 100, left: 0, width: 200, height: 36 });
    // Inner element so the tutorial's "deepest descendant" dispatch lands here.
    const homeInner = document.createElement('button');
    home.appendChild(homeInner);
    document.body.appendChild(home);

    let contextMenuFired = 0;
    let lastClientX = -1;
    let lastClientY = -1;
    homeInner.addEventListener('contextmenu', (evt) => {
      contextMenuFired += 1;
      lastClientX = (evt as MouseEvent).clientX;
      lastClientY = (evt as MouseEvent).clientY;
      // Simulate the Radix ContextMenu mounting its content.
      const share = document.createElement('div');
      share.setAttribute('data-tour', 'sidebar-home-share-item');
      withRect(share, { top: 140, left: 220, width: 160, height: 32 });
      document.body.appendChild(share);
    });

    // sidebar-collections always exists, just needs a rect for the Collections step.
    const collections = document.createElement('div');
    collections.setAttribute('data-tour', 'sidebar-collections');
    withRect(collections, { top: 200, left: 0, width: 200, height: 100 });
    document.body.appendChild(collections);

    // widget-area ditto for the Device Widgets / Share device steps.
    const widgets = document.createElement('div');
    widgets.setAttribute('data-tour', 'widget-area');
    withRect(widgets, { top: 0, left: 220, width: 600, height: 400 });
    document.body.appendChild(widgets);

    // sidebar-homes wrapper.
    const homesSection = document.createElement('div');
    homesSection.setAttribute('data-tour', 'sidebar-homes');
    homesSection.appendChild(home);
    withRect(homesSection, { top: 80, left: 0, width: 200, height: 400 });
    document.body.appendChild(homesSection);

    // header-menu — always in DOM.
    const headerMenu = document.createElement('button');
    headerMenu.setAttribute('data-tour', 'header-menu');
    withRect(headerMenu, { top: 10, left: 800, width: 40, height: 40 });
    document.body.appendChild(headerMenu);

    const onClose = vi.fn();
    render(<Wrapper onClose={onClose} />);

    // Step 0 = Welcome (centered). Advance to step 3 (Share home/room stage 1).
    await advance(3);

    // Stage 1 doesn't need the context menu — only sidebar-home-item should be
    // spotlit and contextmenu shouldn't have fired yet.
    expect(contextMenuFired).toBe(0);

    // Advance to step 4 (Share home/room stage 2 — opens the menu).
    await advance(1);

    // The chain should fire a contextmenu on the home item, which mounts the
    // Share row, which then becomes the spotlight target.
    expect(contextMenuFired).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('[data-tour="sidebar-home-share-item"]')).not.toBeNull();

    // Coordinates should be the centre of the home wrapper (rect 0,100 + 200x36
    // → centre at clientX=100, clientY=118). Anchor for Radix's ContextMenu
    // popover positioning — if these are 0/0 the menu lands top-left.
    expect(lastClientX).toBeCloseTo(100, 0);
    expect(lastClientY).toBeCloseTo(118, 0);
  });
});
