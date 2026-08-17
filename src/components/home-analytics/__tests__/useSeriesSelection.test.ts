// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSeriesSelection } from '../useSeriesSelection';

/**
 * The invariant these all circle: anything latched ⇒ nothing hovered. Callers
 * drop hover updates while a latch exists, so a `hovered` left standing across
 * a latch is a value nothing can correct — and `highlight` falls back to it the
 * moment the last latch goes. That resurrection is what left one line lit and
 * every other line, in every panel, faded after you deselected the last chip.
 */
describe('useSeriesSelection', () => {
  it('lights whatever is hovered while nothing is latched', () => {
    const { result } = renderHook(() => useSeriesSelection());
    act(() => result.current.setHovered('A'));
    expect(result.current.highlight).toBe('A');
  });

  it('lets the latch win over the hover', () => {
    const { result } = renderHook(() => useSeriesSelection());
    act(() => result.current.setHovered('A'));
    act(() => result.current.toggleLatch('B'));
    expect([...result.current.latched]).toEqual(['B']);
    expect(result.current.highlight).toBeNull();
  });

  it('lights nothing once the last latch goes — even with the pointer still on it', () => {
    const { result } = renderHook(() => useSeriesSelection());
    act(() => result.current.setHovered('A'));
    act(() => result.current.toggleLatch('A'));
    act(() => result.current.toggleLatch('A'));
    expect(result.current.latched.size).toBe(0);
    // Used to be 'A': the frozen hover came back and kept the view dimmed.
    expect(result.current.highlight).toBeNull();
  });

  it('does not resurrect a hover from before the latch', () => {
    const { result } = renderHook(() => useSeriesSelection());
    act(() => result.current.setHovered('A'));
    act(() => result.current.toggleLatch('B'));
    act(() => result.current.toggleLatch('B'));
    expect(result.current.highlight).toBeNull();
  });

  it('keeps the rest lit while more than one is latched', () => {
    const { result } = renderHook(() => useSeriesSelection());
    act(() => result.current.toggleLatch('A'));
    act(() => result.current.toggleLatch('B'));
    act(() => result.current.toggleLatch('A'));
    expect([...result.current.latched]).toEqual(['B']);
    expect(result.current.highlight).toBeNull();
  });

  it('lets everything go on a null toggle — the empty-plot click', () => {
    const { result } = renderHook(() => useSeriesSelection());
    act(() => result.current.toggleLatch('A'));
    act(() => result.current.toggleLatch('B'));
    act(() => result.current.toggleLatch(null));
    expect(result.current.latched.size).toBe(0);
    expect(result.current.highlight).toBeNull();
  });

  it('hands back the same set when there was nothing to clear', () => {
    const { result } = renderHook(() => useSeriesSelection());
    const before = result.current.latched;
    act(() => result.current.toggleLatch(null));
    // Same reference — an idle click on the plot must not re-render every panel.
    expect(result.current.latched).toBe(before);
  });
});
