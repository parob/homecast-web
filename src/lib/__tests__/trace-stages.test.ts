import { describe, expect, it } from 'vitest';
import {
  buildJourney,
  placesOf,
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

  it('reports the accessory as unmeasurable, not merely uninstrumented', () => {
    // It sits behind Apple's stack. "Not instrumented" implies someone could
    // fix that; nothing we ship ever could.
    const stage = stageById(SERVER_ONLY, 'accessory');
    expect(stage.status).toBe('not-reporting');
    expect(stage.reason).toBe('not-measurable');
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
    expect(reasonLabel('not-measurable')).toMatch(/Outside our code/);
    expect(reasonLabel('not-on-this-path')).toMatch(/Not part/);
    expect(reasonLabel(undefined)).toBe('No data');
  });
});

describe('measuredMs — only durations somebody actually measured', () => {
  it('takes the relay round trip from relay_response', () => {
    expect(stageById(SERVER_ONLY, 'relay_socket').measuredMs).toBe(170);
  });

  it('does NOT claim the server took the whole request', () => {
    // server_received and response_sent bracket everything downstream. Their
    // difference is the total, not the server's own cost — reporting it on the
    // server card is what made a 4s trace look like 4s of server time.
    const ingress = stageById(SERVER_ONLY, 'ingress');
    expect(ingress.measuredMs).toBeNull();
    expect(ingress.startMs).toBe(0);
  });

  it('takes the HomeKit call duration from the relay-reported step', () => {
    const traceSpan = span({
      offsetMs: 2,
      spanName: 'request_trace',
      payload: JSON.stringify({
        metadata: { steps: [{ name: 'homekit_call', ms: 60, status: 'ok', detail: 'write 41ms' }] },
      }),
    });
    expect(stageById([...SERVER_ONLY, traceSpan], 'homekit').measuredMs).toBe(41);
  });
});

describe('merged step lists', () => {
  it('dedupes and orders steps merged from two pods', () => {
    // A routed request builds a RequestTrace on the origin pod and on the pod
    // that served it; the two are merged before logging, so the same step
    // arrives twice, milliseconds apart and out of order. The screenshot that
    // prompted this showed lock_acquire listed twice at +2080ms and +2079ms.
    const merged = span({
      offsetMs: 0,
      spanName: 'request_trace',
      payload: JSON.stringify({
        metadata: {
          steps: [
            { name: 'relay_send', ms: 2082, status: 'ok', detail: 'WS send 1ms' },
            { name: 'lock_acquire', ms: 2080, status: 'ok', detail: '0ms' },
            { name: 'lock_acquire', ms: 2080, status: 'ok', detail: '0ms' },
          ],
        },
      }),
    });
    const stage = buildJourney([merged]).stages.find((s) => s.id === 'relay_socket')!;
    expect(stage.steps.map((s) => `${s.name}@${s.offsetMs}`)).toEqual([
      'lock_acquire@2080', 'relay_send@2082',
    ]);
  });

  it('keeps genuinely distinct repeats of the same step', () => {
    // Two relay hops in one request really do acquire the lock twice.
    const twoHops = span({
      offsetMs: 0,
      spanName: 'request_trace',
      payload: JSON.stringify({
        metadata: {
          steps: [
            { name: 'lock_acquire', ms: 10, status: 'ok', detail: '0ms' },
            { name: 'lock_acquire', ms: 90, status: 'ok', detail: '0ms' },
          ],
        },
      }),
    });
    const stage = buildJourney([twoHops]).stages.find((s) => s.id === 'relay_socket')!;
    expect(stage.steps).toHaveLength(2);
  });
});

describe('placesOf — grouping by the machine a stage runs on', () => {
  it('splits the journey into the four real places, in order', () => {
    // Eleven stages in a flat row gave no sense of place: which part is the
    // phone, which is a pod in europe-west1, which is a Mac in a kitchen.
    const places = placesOf(buildJourney(SERVER_ONLY));
    expect(places.map((p) => p.id)).toEqual(['client', 'cloud', 'relay', 'home']);
    expect(places.map((p) => p.label)).toEqual([
      'Your device', 'homecast.cloud', 'Your Mac', 'Your home',
    ]);
  });

  it('puts every stage somewhere', () => {
    const journey = buildJourney(SERVER_ONLY);
    const grouped = placesOf(journey).flatMap((p) => p.stages.map((s) => s.id));
    expect(grouped.sort()).toEqual(visibleStages(journey).map((s) => s.id).sort());
  });

  it('sums only measured time, so a place cannot invent a total', () => {
    const cloud = placesOf(buildJourney(SERVER_ONLY)).find((p) => p.id === 'cloud')!;
    // Nothing in the cloud group measured its own duration on this trace.
    expect(cloud.measuredMs).toBeNull();
    expect(cloud.anyObserved).toBe(true);

    const relay = placesOf(buildJourney(SERVER_ONLY)).find((p) => p.id === 'relay')!;
    expect(relay.measuredMs).toBe(170); // the relay round trip
  });

  it('reports a place as unobserved when none of its stages reported', () => {
    const client = placesOf(buildJourney(SERVER_ONLY)).find((p) => p.id === 'client')!;
    expect(client.anyObserved).toBe(false);
    expect(client.startMs).toBeNull();
  });

  it('drops a skipped stage from its place', () => {
    const local = [
      span({ offsetMs: 0, spanName: 'server_received' }),
      span({ offsetMs: 5, spanName: 'route_decision', routingMode: 'local' }),
    ];
    const cloud = placesOf(buildJourney(local)).find((p) => p.id === 'cloud')!;
    expect(cloud.stages.map((s) => s.id)).not.toContain('peer');
  });
});
