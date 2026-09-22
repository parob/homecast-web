// @vitest-environment jsdom
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpandedOverlay, useExpandedOverlayWidth } from '../ExpandedOverlay';

vi.mock('@/contexts/BackgroundContext', () => ({ useBackgroundContext: () => ({ isDarkBackground: false }) }));
vi.mock('@/hooks/use-mobile', () => ({ useIsMobile: () => false }));
class ResizeObserverStub { observe() {} unobserve() {} disconnect() {} }
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1440 });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function Media({ width }: { width: number }) {
  useExpandedOverlayWidth(width);
  return <div>camera preview</div>;
}
function panelWidth() {
  return document.querySelector<HTMLElement>('[data-expandable-widget] [style*="width:"]')?.style.width;
}
describe('media overlay width', () => {
  it('gives camera content room without changing non-media defaults', () => {
    const { rerender } = render(<ExpandedOverlay isExpanded onClose={vi.fn()}><Media width={960} /></ExpandedOverlay>);
    expect(panelWidth()).toBe('960px');
    rerender(<ExpandedOverlay isExpanded onClose={vi.fn()}><Media width={560} /></ExpandedOverlay>);
    expect(panelWidth()).toBe('560px');
    rerender(<ExpandedOverlay isExpanded onClose={vi.fn()}><div>normal widget</div></ExpandedOverlay>);
    expect(panelWidth()).toBe('380px');
  });
  it('still clamps a media viewer to a phone viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    render(<ExpandedOverlay isExpanded onClose={vi.fn()}><Media width={960} /></ExpandedOverlay>);
    expect(panelWidth()).toBe('358px');
  });
  it('keeps an explicit caller width authoritative', () => {
    render(<ExpandedOverlay isExpanded onClose={vi.fn()} width={700}><Media width={960} /></ExpandedOverlay>);
    expect(panelWidth()).toBe('700px');
  });
});
