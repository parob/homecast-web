// @vitest-environment jsdom
//
// The stream's two non-obvious behaviours.
//
// Unwatching on unmount is not tidiness: the server only builds and sends
// entries while someone is watching, and that check sits on the relay's request
// path. A leaked watcher makes every routed request do work for a closed tab.
//
// And pausing stops the *display*, not the subscription — entries keep filling
// the buffer so resuming shows what happened while you were reading. A pause
// that dropped entries would make the log lie about a quiet period.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { watchRelayActivity, unwatch } = vi.hoisted(() => ({
  watchRelayActivity: vi.fn(),
  unwatch: vi.fn(),
}));

vi.mock('@/server/connection', () => ({ serverConnection: { watchRelayActivity } }));

import { useRelayActivity } from '../useRelayActivity';

/** Hand back the handler the hook registered, so tests can push entries. */
let emit: (entry: any) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  watchRelayActivity.mockImplementation((_id: string, handler: (e: any) => void) => {
    emit = handler;
    return unwatch;
  });
});

afterEach(() => vi.useRealTimers());

const socket = (action: string, at = 1) => ({ lane: 'socket', at, action, phase: 'ok', ms: 12 });

describe('subscription lifecycle', () => {
  it('watches the relay it was given', () => {
    renderHook(() => useRelayActivity('mac_abc'));

    expect(watchRelayActivity).toHaveBeenCalledWith('mac_abc', expect.any(Function));
  });

  it('unwatches on unmount, so the relay stops doing work for a closed tab', () => {
    const { unmount } = renderHook(() => useRelayActivity('mac_abc'));

    unmount();

    expect(unwatch).toHaveBeenCalled();
  });

  it('does not subscribe without a relay', () => {
    renderHook(() => useRelayActivity(undefined));

    expect(watchRelayActivity).not.toHaveBeenCalled();
  });
});

describe('buffering', () => {
  it('shows newest first — a live log is read from the top', () => {
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { emit(socket('first', 1)); emit(socket('second', 2)); vi.advanceTimersByTime(200); });

    expect(result.current.entries.map((e) => e.action)).toEqual(['second', 'first']);
  });

  it('batches a burst into one render rather than one per entry', () => {
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { for (let i = 0; i < 50; i++) emit(socket(`a${i}`, i)); });
    // Nothing published until the flush window elapses.
    expect(result.current.entries).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(200); });
    expect(result.current.entries).toHaveLength(50);
  });

  it('keeps the buffer bounded so a busy relay cannot grow it without limit', () => {
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { for (let i = 0; i < 700; i++) emit(socket(`a${i}`, i)); vi.advanceTimersByTime(200); });

    expect(result.current.entries).toHaveLength(500);
    // The newest survive; the oldest are dropped.
    expect(result.current.entries[0].action).toBe('a699');
  });
});

describe('pausing', () => {
  it('holds the display still while entries keep arriving', () => {
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { emit(socket('before', 1)); vi.advanceTimersByTime(200); });
    act(() => { result.current.setPaused(true); });
    act(() => { emit(socket('during', 2)); vi.advanceTimersByTime(200); });

    expect(result.current.entries.map((e) => e.action)).toEqual(['before']);
    expect(result.current.pendingWhilePaused).toBe(1);
  });

  it('reveals what arrived while paused, rather than resuming from a gap', () => {
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { result.current.setPaused(true); });
    act(() => { emit(socket('hidden', 1)); vi.advanceTimersByTime(200); });
    act(() => { result.current.setPaused(false); });

    expect(result.current.entries.map((e) => e.action)).toEqual(['hidden']);
    expect(result.current.pendingWhilePaused).toBe(0);
  });
});

describe('clearing', () => {
  it('empties the buffer, not just the view', () => {
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { emit(socket('gone', 1)); vi.advanceTimersByTime(200); });
    act(() => { result.current.clear(); });
    // Nothing comes back on the next flush.
    act(() => { emit(socket('new', 2)); vi.advanceTimersByTime(200); });

    expect(result.current.entries.map((e) => e.action)).toEqual(['new']);
  });
});
