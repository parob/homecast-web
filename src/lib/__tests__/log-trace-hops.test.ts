import { describe, expect, it } from 'vitest';
import { buildTraceShape, pairSpans, type HopLog } from '../log-trace-hops';

const T0 = Date.parse('2026-08-19T12:00:00.000Z');

function log(partial: Partial<HopLog> & { id: string; offsetMs: number }): HopLog {
  const { offsetMs, ...rest } = partial;
  return {
    timestamp: new Date(T0 + offsetMs).toISOString(),
    spanName: null,
    action: null,
    instanceId: null,
    targetSlot: null,
    sourceSlot: null,
    success: null,
    error: null,
    ...rest,
  };
}

describe('pairSpans', () => {
  it('pairs relay_sent with relay_response into one hop with a duration', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'accessories.list' }),
        log({
          id: '2', offsetMs: 187, spanName: 'relay_response',
          action: 'accessories.list', success: true,
        }),
      ],
      T0,
    );
    expect(hops).toHaveLength(1);
    expect(hops[0].kind).toBe('pair');
    expect(hops[0].startMs).toBe(0);
    expect(hops[0].endMs).toBe(187);
    expect(hops[0].success).toBe(true);
    expect(hops[0].children).toHaveLength(2);
  });

  it('keeps concurrent round-trips for different actions apart', () => {
    // A single trace regularly carries several in-flight relay calls; matching
    // on span name alone would pair the wrong ones and invent bad latencies.
    const hops = pairSpans(
      [
        log({ id: 'a1', offsetMs: 0, spanName: 'relay_sent', action: 'accessories.list' }),
        log({ id: 'b1', offsetMs: 5, spanName: 'relay_sent', action: 'serviceGroups.list' }),
        log({ id: 'b2', offsetMs: 39, spanName: 'relay_response', action: 'serviceGroups.list' }),
        log({ id: 'a2', offsetMs: 187, spanName: 'relay_response', action: 'accessories.list' }),
      ],
      T0,
    );
    expect(hops).toHaveLength(2);
    const byAction = Object.fromEntries(hops.map((h) => [h.action, h.endMs - h.startMs]));
    expect(byAction['accessories.list']).toBe(187);
    expect(byAction['serviceGroups.list']).toBe(34);
  });

  it('prefers the opener whose targetSlot matches the closer sourceSlot', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'pubsub_sent', action: 'x', targetSlot: 'pod-a' }),
        log({ id: '2', offsetMs: 1, spanName: 'pubsub_sent', action: 'x', targetSlot: 'pod-b' }),
        log({ id: '3', offsetMs: 50, spanName: 'pubsub_received', action: 'x', sourceSlot: 'pod-a' }),
      ],
      T0,
    );
    const closed = hops.find((h) => h.endLog !== null);
    expect(closed?.targetSlot).toBe('pod-a');
    expect(closed?.endMs).toBe(50);
  });

  it('falls back to span+action when slots do not line up', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'x', targetSlot: 'pod-a' }),
        log({ id: '2', offsetMs: 20, spanName: 'relay_response', action: 'x', sourceSlot: null }),
      ],
      T0,
    );
    expect(hops).toHaveLength(1);
    expect(hops[0].endMs).toBe(20);
  });

  it('falls back to span alone when the action differs', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'x' }),
        log({ id: '2', offsetMs: 20, spanName: 'relay_response', action: 'y' }),
      ],
      T0,
    );
    expect(hops).toHaveLength(1);
    expect(hops[0].endLog?.id).toBe('2');
  });

  it('marks an opener that never closed as failed', () => {
    // A request that never came back is the single most important thing a
    // trace view can show; it must not render as an empty bar.
    const hops = pairSpans(
      [log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'x' })],
      T0,
    );
    expect(hops[0].success).toBe(false);
    expect(hops[0].error).toBe('no matching response span');
    expect(hops[0].endMs).toBe(hops[0].startMs);
  });

  it('renders a closer with no opener rather than dropping it', () => {
    const hops = pairSpans(
      [log({ id: '1', offsetMs: 10, spanName: 'relay_response', action: 'x' })],
      T0,
    );
    expect(hops).toHaveLength(1);
    expect(hops[0].kind).toBe('single');
  });

  it('renders unpaired spans as pins on the axis', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'server_received' }),
        log({ id: '2', offsetMs: 135, spanName: 'response_sent' }),
      ],
      T0,
    );
    expect(hops.map((h) => h.kind)).toEqual(['single', 'single']);
    expect(hops[1].startMs).toBe(135);
  });

  it('prefers the closer instance id, which knows which pod answered', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'x', instanceId: 'pod-a' }),
        log({ id: '2', offsetMs: 5, spanName: 'relay_response', action: 'x', instanceId: 'pod-b' }),
      ],
      T0,
    );
    expect(hops[0].instance).toBe('pod-b');
  });

  it('numbers repeated hops of the same kind', () => {
    const hops = pairSpans(
      [
        log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'x' }),
        log({ id: '2', offsetMs: 5, spanName: 'relay_response', action: 'x' }),
        log({ id: '3', offsetMs: 10, spanName: 'relay_sent', action: 'x' }),
        log({ id: '4', offsetMs: 15, spanName: 'relay_response', action: 'x' }),
      ],
      T0,
    );
    expect(hops.map((h) => h.label)).toEqual(['relay hop #1', 'relay hop #2']);
  });
});

describe('buildTraceShape', () => {
  it('handles an empty trace', () => {
    expect(buildTraceShape([])).toEqual({ hops: [], baseTime: 0, totalMs: 0 });
  });

  it('sorts out-of-order rows before pairing', () => {
    const shape = buildTraceShape([
      log({ id: '2', offsetMs: 187, spanName: 'relay_response', action: 'x', success: true }),
      log({ id: '1', offsetMs: 0, spanName: 'relay_sent', action: 'x' }),
    ]);
    expect(shape.hops).toHaveLength(1);
    expect(shape.totalMs).toBe(187);
  });

  it('measures the axis from the first log line', () => {
    const shape = buildTraceShape([
      log({ id: '1', offsetMs: 1000, spanName: 'server_received' }),
      log({ id: '2', offsetMs: 1250, spanName: 'response_sent' }),
    ]);
    expect(shape.baseTime).toBe(T0 + 1000);
    expect(shape.totalMs).toBe(250);
  });

  it('does not stretch the axis past the last hop end', () => {
    const shape = buildTraceShape([
      log({ id: '1', offsetMs: 0, spanName: 'server_received' }),
      log({ id: '2', offsetMs: 40, spanName: 'relay_sent', action: 'x' }),
    ]);
    expect(shape.totalMs).toBe(40);
  });
});
