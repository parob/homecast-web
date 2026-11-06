// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { accessoryKey, isWriting, __resetPendingWrites } from '@/lib/pending-writes';
import { MQTT_CONFIRM_TIMEOUT_MS, pendingPayload, usePendingMqttWrites } from '../usePendingMqttWrites';

const topic = 'homecast/home-1111/bedroom-2222/lights-3333';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); __resetPendingWrites(); vi.useRealTimers(); });

describe('MQTT state confirmation', () => {
  it('holds the requested value through stale and unrelated updates, then accepts matching state', () => {
    const { result } = renderHook(usePendingMqttWrites);
    act(() => { result.current.begin(topic, '{"on":false}'); });
    act(() => { result.current.receive(topic, '{"on":true,"brightness":70}'); });
    expect(JSON.parse(pendingPayload(topic, '{"on":true,"brightness":70}', result.current.pending)))
      .toEqual({ on: false, brightness: 70 });
    act(() => { result.current.receive(topic, '{"brightness":50}'); });
    expect(result.current.pending[topic]).toBeDefined();
    act(() => { result.current.receive(topic, '{"on":false}'); });
    expect(result.current.pending[topic]).toBeUndefined();
  });

  it('keeps the newest toggle through an old echo and a late publish failure', () => {
    const { result } = renderHook(usePendingMqttWrites);
    let old: number;
    act(() => { old = result.current.begin(topic, '{"on":false}')!; });
    act(() => { result.current.begin(topic, '{"on":true}'); });
    act(() => { result.current.receive(topic, '{"on":false}'); result.current.fail(topic, old, 'old error'); });
    expect(JSON.parse(pendingPayload(topic, '{"on":false}', result.current.pending))).toEqual({ on: true });
    expect(result.current.errors[topic]).toBeUndefined();
    act(() => { result.current.receive(topic, '{"on":true}'); });
    expect(result.current.pending[topic]).toBeUndefined();
  });

  it('confirms each JSON property independently and ignores other topics and command echoes', () => {
    const { result } = renderHook(usePendingMqttWrites);
    act(() => { result.current.begin(topic, '{"on":false,"brightness":25}'); });
    act(() => {
      result.current.receive(topic + '/set', '{"on":false,"brightness":25}');
      result.current.receive('another/light', '{"on":false,"brightness":25}');
      result.current.receive(topic, '{"on":false}');
    });
    expect(Object.keys(result.current.pending[topic])).toEqual(['brightness']);
    act(() => { result.current.receive(topic, '{"brightness":25}'); });
    expect(result.current.pending[topic]).toBeUndefined();
  });

  it('does not treat a retained snapshot as confirmation of a new command', () => {
    const { result } = renderHook(usePendingMqttWrites);
    act(() => { result.current.begin(topic, '{"on":false}'); result.current.receive(topic, '{"on":false}', true); });
    expect(result.current.pending[topic]).toBeDefined();
  });

  it('times out to the latest reported values, reports the missing update and releases the icon ring', async () => {
    const { result } = renderHook(usePendingMqttWrites);
    act(() => { result.current.begin(topic, '{"on":false}'); });
    expect(isWriting(accessoryKey(topic))).toBe(true);
    await act(async () => { vi.advanceTimersByTime(MQTT_CONFIRM_TIMEOUT_MS); });
    expect(pendingPayload(topic, '{"on":true,"brightness":42}', result.current.pending)).toBe('{"on":true,"brightness":42}');
    expect(result.current.errors[topic]).toMatch(/No matching update received/);
    expect(isWriting(accessoryKey(topic))).toBe(false);
    act(() => { result.current.receive(topic, '{"on":false}'); });
    expect(result.current.errors[topic]).toBeUndefined();
  });

  it('only reverts the failed command, preserving a separate slider change', () => {
    const { result } = renderHook(usePendingMqttWrites);
    let id: number;
    act(() => { id = result.current.begin(topic, '{"on":false}')!; result.current.begin(topic, '{"brightness":80}'); });
    act(() => { result.current.fail(topic, id, 'Publish failed'); });
    expect(JSON.parse(pendingPayload(topic, '{"on":true,"brightness":20}', result.current.pending)))
      .toEqual({ on: true, brightness: 80 });
    expect(result.current.errors[topic]).toBe('Publish failed');
  });

  it('clears pending writes on disconnect and releases them on unmount', async () => {
    const { result, unmount } = renderHook(usePendingMqttWrites);
    act(() => { result.current.begin(topic, '{"on":false}'); result.current.disconnect(); });
    expect(result.current.pending).toEqual({});
    expect(result.current.errors[topic]).toMatch(/Disconnected/);
    act(() => { result.current.begin(topic, '{"on":true}'); });
    await act(async () => { unmount(); });
    expect(isWriting(accessoryKey(topic))).toBe(false);
  });

  it('understands boolean and legacy target-state echoes without treating motor position as its new target', () => {
    const { result } = renderHook(usePendingMqttWrites);
    act(() => { result.current.begin(topic, '{"lock_target":true}'); result.current.receive(topic, '{"locked":1}'); });
    expect(result.current.pending[topic]).toBeUndefined();
    act(() => { result.current.begin(topic, '{"target":25}'); result.current.receive(topic, '{"position":25,"target":50}'); });
    expect(result.current.pending[topic]).toBeDefined();
    act(() => { result.current.receive(topic, '{"position":25}'); });
    expect(result.current.pending[topic]).toBeUndefined();
  });

  it('rejects invalid JSON and drops tombstoned topics', () => {
    const { result } = renderHook(usePendingMqttWrites);
    act(() => { expect(result.current.begin(topic, 'false')).toBeNull(); });
    expect(result.current.errors[topic]).toMatch(/JSON object/);
    act(() => { result.current.begin(topic, '{"on":false}'); result.current.forget(topic); });
    expect(result.current.pending[topic]).toBeUndefined();
    expect(result.current.errors[topic]).toBeUndefined();
  });
});
