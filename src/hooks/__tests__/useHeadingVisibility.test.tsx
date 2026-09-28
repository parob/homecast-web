// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useHeadingVisibility } from '../useHeadingVisibility';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('follows non-bubbling Android container scrolls and heading replacements', () => {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(fn, 16));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  let bottom = 185;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ bottom } as DOMRect));
  function Page({ loading = false, version = 0 }) {
    const { headingRef, headingHidden } = useHeadingVisibility();
    return <><span data-testid="compact" hidden={!headingHidden}>My Home</span><main data-testid="scroller">{!loading && <h2 key={version} ref={headingRef}>My Home</h2>}</main></>;
  }
  const { rerender } = render(<Page />);
  const compact = () => screen.getByTestId('compact');
  const scroll = (position: number) => {
    bottom = position;
    fireEvent.scroll(screen.getByTestId('scroller'), { bubbles: false });
    act(() => vi.advanceTimersByTime(20));
  };
  expect(compact().hidden).toBe(true);
  scroll(-100);
  expect(compact().hidden).toBe(false);
  scroll(185);
  expect(compact().hidden).toBe(true);
  rerender(<Page loading />);
  rerender(<Page version={1} />);
  expect(compact().hidden).toBe(true);
  scroll(-100);
  expect(compact().hidden).toBe(false);
  scroll(185);
  expect(compact().hidden).toBe(true);
});
