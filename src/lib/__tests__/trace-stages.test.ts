import { describe, expect, it } from 'vitest';
import {
  buildJourney,
  reasonLabel,
  stepsFromSpan,
  visibleStages,
  type TraceSpanInput,
} from '../trace-stages';

const T0 = Date.parse('2026-08-19T12:00:00.000Z');

function span(partial: Partial<TraceSpanInput> & { offsetMs: number }): TraceSpanInput {
  const { offsetMs, ...rest } = partial;
  return {
    id: `s${offsetMs}`,
    timestamp: new Date(T0 + offsetMs).toISOString(),
    severity: 'INFO',
    message: '',
    spanName: null,
    action: null,
    source: null,
    latencyMs: null,
    success: null,
    error: null,
    instanceId: null,
    routingMode: null,
    targetSlot: null,
    clientType: null,
    deviceId: null,
    payload: null,
    ...rest,
  };
}

/** A server-only trace — exactly what production emitted before the fixes. */
const SERVER_ONLY: TraceSpanInput[] = [
  span({ offsetMs: 0, spanName: 'server_received', action: 'characteristic.set', clientType: 'web' }),
  span({ offsetMs: 12, spanName: 'route_decision', routingMode: 'direct', targetSlot: 'homecast-prod-x' }),
  span({ offsetMs: 20, spanName: 'relay_sent', action: 'characteristic.set' }),
  span({ offsetMs: 190, spanName: 'relay_response', latencyMs: 170, success: true }),
  span({ offsetMs: 200, spanName: 'response_sent', latencyMs: 200, success: true }),
];

function stageById(spans: TraceSpanInput[], id: string, opts = {}) {
  return buildJourney(spans, opts).stages.find((s) => s.id === id)!;
}

describe('buildJourney — the honest baseline', () => {
  it('marks stages the spans prove as observed', () => {
    const j = buildJourney(SERVER_ONLY);
    expect(stageById(SERVER_ONLY, 'ingress').status).toBe('observed');
    expect(stageById(SERVER_ONLY, 'routing').status).toBe('observed');
    expect(stageById(SERVER_ONLY, 'relay_socket').status).toBe('observed');
    expect(j.ok).toBe(true);
  });

  it('never invents a stage nothing reported', () => {
    // This is the whole point: the relay's own code, the native bridge and the
    // HomeKit call are opt-in, so by default they must read as absent.
    for (const id of ['client', 'relay_web', 'bridge', 'homekit']) {
      const stage = stageById(SERVER_ONLY, id);
      expect(stage.status).toBe('not-reporting');
      expect(stage.startMs).toBeNull();
    }
  });

  it('blames the setting, not the system, when activity logs are off', () => {
    expect(stageById(SERVER_ONLY, 'client').reason).toBe('activity-logs-off');
  });

  it('says "not part of this request" when logs were expected but absent', () => {
    const stage = stageById(SERVER_ONLY, 'client', { activityLogsExpected: true });
    expect(stage.reason).toBe('not-on-this-path');
  });

  it('reports the accessory as permanently uninstrumented', () => {
    const stage = stageById(SERVER_ONLY, 'accessory');
    expect(stage.status).toBe('not-reporting');
    expect(stage.reason).toBe('never-instrumented');
  });

  it('infers the edge, which is real but silent', () => {
    // A request that reached the server necessarily crossed the load balancer.
    expect(stageById(SERVER_ONLY, 'edge').status).toBe('inferred');
  });
});

describe('routing modes', () => {
  it('infers the peer hop from a direct route decision', () => {
    // The decision span proves the request crossed pods even when the peer
    // itself reported nothing — which was the norm before the trace fixes.
    expect(stageById(SERVER_ONLY, 'peer').status).toBe('inferred');
  });

  it('skips the peer hop entirely on a local route', () => {
    const local = [
      span({ offsetMs: 0, spanName: 'server_received' }),
      span({ offsetMs: 5, spanName: 'route_decision', routingMode: 'local' }),
      span({ offsetMs: 40, spanName: 'response_sent', latencyMs: 40 }),
    ];
    expect(stageById(local, 'peer').status).toBe('skipped');
    expect(visibleStages(buildJourney(local)).map((s) => s.id)).not.toContain('peer');
  });

  it('skips the peer hop on a sibling route', () => {
    const sibling = [
      span({ offsetMs: 0, spanName: 'server_received' }),
      span({ offsetMs: 5, spanName: 'route_decision', routingMode: 'sibling' }),
    ];
    expect(stageById(sibling, 'peer').status).toBe('skipped');
    expect(buildJourney(sibling).routingMode).toBe('sibling');
  });

  it('does not recognise pubsub, which no longer exists', () => {
    // Pub/Sub routing was removed in April 2026; the string survives only in
    // old schemas and must not be presented as a live path.
    const j = buildJourney([
      span({ offsetMs: 0, spanName: 'route_decision', routingMode: 'pubsub' }),
    ]);
    expect(j.routingMode).toBeNull();
  });
});

describe('RequestTrace steps', () => {
  const traceSpan = span({
    offsetMs: 2,
    spanName: 'request_trace',
    action: 'characteristic.set',
    payload: JSON.stringify({
      metadata: {
        steps: [
          { name: 'received', ms: 0, status: 'ok', detail: null },
          { name: 'auth', ms: 3, status: 'ok', detail: null },
          { name: 'relay_send', ms: 18, status: 'ok', detail: 'WS send 2ms' },
          { name: 'homekit_call', ms: 60, status: 'ok', detail: 'write 41ms' },
        ],
      },
    }),
  });

  it('extracts the step list', () => {
    expect(stepsFromSpan(traceSpan).map((s) => s.name)).toEqual([
      'received', 'auth', 'relay_send', 'homekit_call',
    ]);
  });

  it('lights up HomeKit from the relay-reported homekit_call step', () => {
    // This step is appended by the relay itself and returned on the response.
    // It is the only measurement of anything inside the relay that exists
    // without shipping a new app.
    const stage = stageById([...SERVER_ONLY, traceSpan], 'homekit');
    expect(stage.status).toBe('observed');
    expect(stage.steps[0].detail).toBe('write 41ms');
  });

  it('routes auth and home lookup into the core stage', () => {
    const core = stageById([...SERVER_ONLY, traceSpan], 'core');
    expect(core.status).toBe('observed');
    expect(core.steps.map((s) => s.name)).toContain('auth');
  });

  it('survives a malformed payload', () => {
    expect(stepsFromSpan(span({ offsetMs: 0, payload: 'not json' }))).toEqual([]);
    expect(stepsFromSpan(span({ offsetMs: 0, payload: null }))).toEqual([]);
    expect(stepsFromSpan(span({ offsetMs: 0, payload: '{"metadata":{"steps":"nope"}}' }))).toEqual([]);
  });

  it('drops step entries that are not shaped like steps', () => {
    const messy = span({
      offsetMs: 0,
      spanName: 'request_trace',
      payload: JSON.stringify({ metadata: { steps: [null, 3, { detail: 'no name' }, { name: 'ok' }] } }),
    });
    expect(stepsFromSpan(messy).map((s) => s.name)).toEqual(['ok']);
  });
});

describe('failures', () => {
  it('marks the stage that failed, not the whole journey blank', () => {
    const failed = [
      span({ offsetMs: 0, spanName: 'server_received' }),
      span({ offsetMs: 10, spanName: 'relay_sent' }),
      span({
        offsetMs: 30_010, spanName: 'relay_response', severity: 'WARNING',
        success: false, error: 'TIMEOUT',
      }),
    ];
    const stage = stageById(failed, 'relay_socket');
    expect(stage.status).toBe('failed');
    expect(stage.error).toBe('TIMEOUT');
    expect(buildJourney(failed).ok).toBe(false);
  });

  it('handles a relay that never answered at all', () => {
    const stalled = [
      span({ offsetMs: 0, spanName: 'server_received' }),
      span({ offsetMs: 8, spanName: 'relay_sent' }),
    ];
    const j = buildJourney(stalled);
    expect(j.ok).toBe(true);
    expect(stageById(stalled, 'relay_socket').status).toBe('observed');
    expect(stageById(stalled, 'homekit').status).toBe('not-reporting');
  });
});

describe('ordering and timing', () => {
  it('sorts out-of-order spans before measuring', () => {
    const j = buildJourney([...SERVER_ONLY].reverse());
    expect(j.totalMs).toBe(200);
    expect(j.baseTime).toBe(T0);
  });

  it('measures each stage from the first span in the trace', () => {
    expect(stageById(SERVER_ONLY, 'relay_socket').startMs).toBe(20);
    expect(stageById(SERVER_ONLY, 'relay_socket').endMs).toBe(190);
  });

  it('surfaces unaccounted time between observed stages', () => {
    // Gaps are where latency nobody instrumented actually lives.
    const gaps = buildJourney(SERVER_ONLY).gaps;
    expect(gaps.length).toBeGreaterThan(0);
    expect(gaps.every((g) => g.ms > 0)).toBe(true);
  });

  it('ignores spans with an unparseable timestamp', () => {
    const j = buildJourney([...SERVER_ONLY, span({ offsetMs: 0, timestamp: 'nope' } as never)]);
    expect(j.totalMs).toBe(200);
  });
});

describe('metadata', () => {
  it('picks up the action and client type', () => {
    const j = buildJourney(SERVER_ONLY);
    expect(j.action).toBe('characteristic.set');
    expect(j.clientType).toBe('web');
  });

  it('surfaces the trigger for server-initiated work', () => {
    // 61% of relay calls are background work; the trigger is what makes that
    // journey explicable rather than mysterious.
    const probe = [
      span({
        offsetMs: 0, spanName: 'request_trace', action: 'relay.probe',
        payload: JSON.stringify({ trigger: 'deep_probe', metadata: { steps: [] } }),
      }),
      span({ offsetMs: 5, spanName: 'relay_sent', action: 'relay.probe' }),
    ];
    expect(buildJourney(probe).trigger).toBe('deep_probe');
  });

  it('ignores span names it does not know rather than guessing a stage', () => {
    const j = buildJourney([span({ offsetMs: 0, spanName: 'something_new' })]);
    expect(j.stages.every((s) => s.spans.length === 0)).toBe(true);
  });
});

describe('empty trace', () => {
  it('still returns the full architecture', () => {
    const j = buildJourney([]);
    expect(j.stages).toHaveLength(11);
    expect(j.totalMs).toBe(0);
    expect(j.stages.every((s) => s.status === 'not-reporting')).toBe(true);
  });
});

describe('reasonLabel', () => {
  it('explains each absence in words', () => {
    expect(reasonLabel('activity-logs-off')).toMatch(/Activity logs/);
    expect(reasonLabel('never-instrumented')).toMatch(/inferred/);
    expect(reasonLabel('not-on-this-path')).toMatch(/Not part/);
    expect(reasonLabel(undefined)).toBe('No data');
  });
});
