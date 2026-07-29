// @vitest-environment jsdom
//
// The stream is sourced in-process, from the relay itself.
//
// The dashboard runs on the relay, so it already has this information: it
// handles every request, receives every HomeKit event and runs the automation
// engine. Routing that through the cloud and back would also go quiet exactly
// when it matters — a stream riding the relay's socket cannot report that the
// socket has stopped answering.
//
// Pausing stops the *display*, not the subscription: entries keep filling the
// buffer so resuming shows what happened while you were reading. A pause that
// dropped entries would make the log lie about a quiet period.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const { onLocalRelayActivity, getBufferedActivity, unwatch } = vi.hoisted(() => ({
  onLocalRelayActivity: vi.fn(),
  getBufferedActivity: vi.fn(() => []),
  unwatch: vi.fn(),
}));

vi.mock('@/server/local-activity', () => ({ onLocalRelayActivity, getBufferedActivity }));

import { useRelayActivity } from '../useRelayActivity';

/** Hand back the handler the hook registered, so tests can push entries. */
let emit: (entry: any) => void = () => {};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  getBufferedActivity.mockReturnValue([]);
  onLocalRelayActivity.mockImplementation((handler: (e: any) => void) => {
    emit = handler;
    return unwatch;
  });
});

afterEach(() => vi.useRealTimers());

const socket = (action: string, at = 1) => ({ lane: 'socket', at, action, phase: 'ok', ms: 12 });

describe('subscription lifecycle', () => {
  it('subscribes in-process, with no cloud round trip', () => {
    renderHook(() => useRelayActivity('mac_abc'));

    expect(onLocalRelayActivity).toHaveBeenCalledWith(expect.any(Function));
  });

  it('unsubscribes on unmount', () => {
    const { unmount } = renderHook(() => useRelayActivity('mac_abc'));

    unmount();

    expect(unwatch).toHaveBeenCalled();
  });

  it('does not subscribe without a relay', () => {
    renderHook(() => useRelayActivity(undefined));

    expect(onLocalRelayActivity).not.toHaveBeenCalled();
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

    act(() => { for (let i = 0; i < 1400; i++) emit(socket(`a${i}`, i)); vi.advanceTimersByTime(200); });

    expect(result.current.entries).toHaveLength(1000);
    // The newest survive; the oldest are dropped.
    expect(result.current.entries[0].action).toBe('a1399');
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


// Recording runs whether or not the panel is open, so opening it should show
// what already happened. The fault worth reading about is usually over by the
// time anyone looks.
describe('seeding from history', () => {
  it('shows what was recorded before the panel opened', () => {
    getBufferedActivity.mockReturnValue([socket('earlier', 5), socket('earliest', 1)]);

    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    expect(result.current.entries.map((e) => e.action)).toEqual(['earlier', 'earliest']);
  });

  it('puts new entries above the seeded history', () => {
    getBufferedActivity.mockReturnValue([socket('old', 1)]);
    const { result } = renderHook(() => useRelayActivity('mac_abc'));

    act(() => { emit(socket('new', 9)); vi.advanceTimersByTime(200); });

    expect(result.current.entries.map((e) => e.action)).toEqual(['new', 'old']);
  });
});
