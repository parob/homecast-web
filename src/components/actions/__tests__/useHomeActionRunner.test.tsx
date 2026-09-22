// @vitest-environment jsdom
//
// The elapsed-time interval's lifetime.
//
// parob/homecast-web#207: `run` starts a per-run `setInterval` and clears it in
// `finally` — which is tied to the awaited promise, not to the component. A
// card unmounted while a run is still in flight (navigate away mid-run, close
// the section, a relay that never answers) leaves the interval ticking and
// `setElapsed` calling setState on a component that is gone.
//
// In the app that is usually invisible, because the promise settles. In the
// test environment it is not: vitest tears jsdom down, the tick lands, and
// React asks for `window`, which has gone —
//
//   ReferenceError: window is not defined
//    ❯ getCurrentEventPriority react-dom.development.js:10993
//    ❯ dispatchSetState        react-dom.development.js:16648
//    ❯ Timeout._onTimeout      useHomeActionRunner.ts
//
// — which fails the whole run with every test passing.
//
// The assertions count live timers rather than watching for a React warning:
// React 18 dropped the "setState on an unmounted component" warning, so the
// leak is silent in jsdom until the environment is torn down under it. The
// timer is the thing that leaks, so the timer is what is counted.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useHomeActionRunner } from '../useHomeActionRunner';
import type { HomeAction } from '../catalog';

const ACTION = {
  id: 'lights',
  label: 'All lights',
  runningLabel: 'Turning off',
  subtitle: '3 of 4 on',
  icon: 'lightbulb',
  serviceType: 'lightbulb',
  targetCount: 4,
  turningOn: false,
  disabled: false,
  steps: [{ writes: [] }],
} as unknown as HomeAction;

/** A promise that only settles when told — a fresh one per call. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useHomeActionRunner timer lifetime', () => {
  it('THE DEFECT: stops ticking when the card unmounts mid-run', async () => {
    const pending = deferred();
    const { result, unmount } = renderHook(() =>
      useHomeActionRunner(() => pending.promise),
    );

    act(() => { void result.current.run(ACTION); });
    expect(vi.getTimerCount(), 'a run in flight is ticking').toBe(1);

    unmount();
    expect(vi.getTimerCount(), 'unmount stops it').toBe(0);
  });

  it('does not leave a tick that outlives the environment', async () => {
    const pending = deferred();
    const { result, unmount } = renderHook(() =>
      useHomeActionRunner(() => pending.promise),
    );

    act(() => { void result.current.run(ACTION); });
    unmount();

    // Whatever happens after the component is gone must not reach setState.
    // With a live timer this advance is what fires the tick that kills the run.
    expect(() => vi.advanceTimersByTime(5000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('still clears the timer when a run completes normally', async () => {
    const pending = deferred();
    const { result } = renderHook(() => useHomeActionRunner(() => pending.promise));

    act(() => { void result.current.run(ACTION); });
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => { pending.resolve(); await pending.promise; });
    expect(vi.getTimerCount(), 'the run cleared its own timer').toBe(0);
  });

  it('clears an abandoned run and its replacement together on unmount', async () => {
    // A superseding press starts its own timer while the abandoned run's is
    // still ticking — the abandoned `finally` only runs when ITS promise
    // settles, which aborting does not do. So two can be live at once, which
    // is why the hook keeps a set rather than a single handle.
    const first = deferred();
    const second = deferred();
    let call = 0;
    const { result, unmount } = renderHook(() =>
      useHomeActionRunner(() => (call++ === 0 ? first.promise : second.promise)),
    );

    act(() => { void result.current.run(ACTION); });
    act(() => { void result.current.run(ACTION); });
    expect(vi.getTimerCount(), 'both the abandoned run and its replacement are ticking').toBe(2);

    unmount();
    expect(vi.getTimerCount(), 'unmount clears both, not just the current one').toBe(0);
  });
});
