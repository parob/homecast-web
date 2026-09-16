// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { useCameraFrameHeight } from '../useCameraFrameHeight';

const disconnectResize = vi.fn();
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() { disconnectResize(); } }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); disconnectResize.mockClear(); });

function Viewer({ limit }: { limit: number }) {
  const { frameRef, maxHeight } = useCameraFrameHeight(true);
  return <div data-expanded-overlay-scroll style={{ maxHeight: limit }} ref={el => {
    if (!el) return;
    Object.defineProperty(el, 'scrollHeight', { configurable: true,
      get: () => 120 + (parseFloat(frameRef.current?.style.height ?? '') || 200) });
    const frame = el.querySelector<HTMLElement>('[data-testid="frame"]')!;
    Object.defineProperty(frame, 'offsetHeight', { configurable: true, get: () => parseFloat(frame.style.height) });
  }}>
    <div data-testid="frame" style={{ height: maxHeight ?? 200 }} ref={frameRef} />
  </div>;
}

describe('camera image height budget', () => {
  it('responds to a higher cap even when no element resize fires', async () => {
    const view = render(<Viewer limit={500} />);
    await waitFor(() => expect(view.getByTestId('frame').style.height).toBe('378px'));
    view.rerender(<Viewer limit={700} />);
    await waitFor(() => expect(view.getByTestId('frame').style.height).toBe('578px'));
    view.rerender(<Viewer limit={350} />);
    await waitFor(() => expect(view.getByTestId('frame').style.height).toBe('228px'));
  });

  it('disconnects both observers when the viewer unmounts', () => {
    const disconnectMutation = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const view = render(<Viewer limit={500} />);
    view.unmount();
    expect(disconnectResize).toHaveBeenCalledOnce();
    expect(disconnectMutation).toHaveBeenCalledOnce();
  });
});
