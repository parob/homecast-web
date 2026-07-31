// @vitest-environment jsdom
//
// The node info popover portals to document.body while the editor's modal
// Dialog holds a react-remove-scroll lock whose shards cover only the dialog
// content. A non-modal popover sits outside those shards, so its touchmove
// events were preventDefault()ed — help content could not be scrolled by
// touch (wheel had a stopPropagation escape hatch, which is why the bug was
// mobile-only). `modal` on the Popover mounts its own scroll lock, making the
// popover the active lock target. jsdom has no layout, so these tests guard
// the structure that produces the behavior.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../help/useNodeHelp', () => ({
  useNodeHelp: () => ({ content: '## How it works\nSends a notification.', loading: false }),
}));

import { NodeInfoPopover } from '../panels/NodeInfoPopover';

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
});
afterEach(() => cleanup());

function openPopover() {
  render(<NodeInfoPopover nodeType="notify" />);
  fireEvent.click(screen.getByRole('button'));
  const content = document.querySelector('[role="dialog"]');
  expect(content).not.toBeNull();
  return content as HTMLElement;
}

describe('NodeInfoPopover scrolling', () => {
  it('mounts its own scroll lock (modal), so touch scrolling is not swallowed', () => {
    openPopover();
    // react-remove-scroll marks the body while a modal lock is active. A
    // non-modal popover never sets this — it regression-guards the fix.
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
  });

  it('keeps the help body as a bounded scroller between fixed header and footer', () => {
    const content = openPopover();
    expect(content.className).toContain('flex-col');
    expect(content.className).toMatch(/max-h-/);
    const scroller = content.querySelector('.overflow-y-auto');
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toContain('overscroll-contain');
    expect(scroller!.className).toContain('min-h-0');
  });

  it('clamps its width to the viewport on small screens', () => {
    const content = openPopover();
    expect(content.className).toContain('w-[min(340px,calc(100vw-2rem))]');
  });
});
