import { describe, expect, it } from 'vitest';
import {
  MIN_BASELINE_SAMPLE,
  TRACE_DIMENSIONS,
  baselinesFrom,
  bubbleUp,
  buildRoute,
  groupIncidents,
  hopOf,
  makeTimeScale,
  ownerAfter,
  verdictOf,
  type TraceEvent,
} from '../trace-route';

const T0 = Date.parse('2026-08-20T04:00:48.451Z');
const ev = (t: number, spanName: string | null, extra: Partial<TraceEvent> = {}): TraceEvent => ({
  id: `s${t}-${spanName}`,
  timestamp: new Date(T0 + t).toISOString(),
  spanName,
  message: '',
  instanceId: 'homecast-prod-bb9f4cb7-5hdrz',
  ...extra,
});

/**
 * Real production traces, trimmed. The three shapes are the whole point of this
 * module, so each one is pinned by the trace that taught us it existed.
 */

/** 8 spans, 80ms, everything worked. */
const REQUEST: TraceEvent[] = [
  ev(0, 'server_received', { action: 'automation.virtual_states' }),
  ev(34, 'route_decision', { routingMode: 'direct' }),
  ev(40, 'relay_sent', { action: 'automation.virtual_states', instanceId: 'homecast-prod-bb9f4cb7-x6tb9' }),
  ev(76, 'relay_response', { latencyMs: 36, instanceId: 'homecast-prod-bb9f4cb7-x6tb9' }),
  ev(80, 'response_sent', { latencyMs: 80, action: 'automation.virtual_states' }),
];

/** Four attempts ~5s apart, DEVICE_BUSY, and the relay answering 8.2s too late. */
const REPETITION: TraceEvent[] = [
  ev(0, 'server_received', { action: 'automation.virtual_states' }),
  ev(36, 'route_decision', { routingMode: 'direct' }),
  ev(47, 'relay_sent', { action: 'automation.virtual_states', instanceId: 'homecast-prod-bb9f4cb7-x6tb9' }),
  ev(5323, 'route_decision', { routingMode: 'direct' }),
  ev(10844, 'route_decision', { routingMode: 'direct' }),
  ev(16860, 'route_decision', { routingMode: 'direct' }),
  ev(21874, 'response_sent', { latencyMs: 21874, error: 'DEVICE_BUSY' }),
  ev(30047, 'relay_response', {
    latencyMs: 30000, error: 'TIMEOUT', severity: 'WARNING',
    instanceId: 'homecast-prod-bb9f4cb7-x6tb9',
  }),
];

/** A relay reconnect fanning out four calls, two of which never came back. */
const BURST: TraceEvent[] = [
  ev(77, 'route_decision', { action: 'rooms.list' }),
  ev(77, 'relay_sent', { action: 'rooms.list' }),
  ev(80, 'relay_sent', { action: 'accessories.list' }),
  ev(202, 'relay_response', { action: 'rooms.list', latencyMs: 125 }),
  ev(247, 'relay_response', { action: 'accessories.list', latencyMs: 167 }),
  ev(3830, 'relay_sent', { action: 'serviceGroups.list' }),
  ev(4610, 'relay_sent', { action: 'scenes.list' }),
];

describe('shape classification', () => {
  it('is the piece everything else hangs off', () => {
    expect(buildRoute(REQUEST).shape).toBe('request');
    expect(buildRoute(REPETITION).shape).toBe('repetition');
    expect(buildRoute(BURST).shape).toBe('burst');
  });

  it('counts retries only when they are retries of the same call', () => {
    expect(buildRoute(REPETITION).attempts).toBe(4);
    // Four route decisions for four *different* calls is a burst, not four
    // attempts at one thing. Calling those attempts would be a straight lie.
    expect(buildRoute(BURST).attempts).toBe(1);
  });

  it('survives an empty trace', () => {
    const m = buildRoute([]);
    expect(m.shape).toBe('request');
    expect(m.totalMs).toBe(0);
    expect(m.legs).toEqual([]);
  });
});

describe('lanes and legs', () => {
  it('orders lanes client → pod → relay however the spans arrive', () => {
    expect(buildRoute(REQUEST).lanes[0]).toBe('client');
    expect(buildRoute(REQUEST).lanes[buildRoute(REQUEST).lanes.length - 1]).toBe('relay');
  });

  it('gives the relay the interval that follows relay_sent', () => {
    const m = buildRoute(REQUEST);
    const waiting = m.phases.find((p) => p.label === 'waiting for the relay Mac');
    expect(waiting?.lane).toBe('relay');
    expect(waiting?.ms).toBe(36);
  });

  it('merges consecutive phases on one machine into a single leg', () => {
    const m = buildRoute(REPETITION);
    const podLegs = m.legs.filter((l) => l.lane.startsWith('pod'));
    // The four attempts are one continuous stretch on the origin pod.
    expect(podLegs.some((l) => l.parts.length > 1)).toBe(true);
    // Named after its dominant part, with a count of the rest — "2 steps" told
    // the reader nothing on the biggest bar in the trace.
    expect(podLegs.some((l) => /\(\+\d+\)$/.test(l.summary))).toBe(true);
    expect(podLegs.some((l) => l.summary.startsWith('handing off'))).toBe(true);
  });

  it('marks a leg that carries an error, so failure is visible before any click', () => {
    expect(buildRoute(REPETITION).legs.some((l) => l.failed)).toBe(true);
    expect(buildRoute(REQUEST).legs.some((l) => l.failed)).toBe(false);
  });

  it('flags an interval with nothing logged inside it as unexplained', () => {
    const m = buildRoute(REPETITION);
    const gap = m.phases.find((p) => p.ms > 5000);
    expect(gap?.unexplained).toBe(true);
  });
});

describe('hops', () => {
  it('routes each span between the right pair of machines', () => {
    expect(hopOf(REQUEST[0])).toEqual(['client', 'pod 5hdrz']);
    expect(hopOf(REQUEST[2])).toEqual(['pod x6tb9', 'relay']);
    expect(hopOf(REQUEST[3])).toEqual(['relay', 'pod x6tb9']);
    expect(hopOf(REQUEST[4])).toEqual(['pod 5hdrz', 'client']);
  });

  it('leaves an unknown span on its own pod rather than inventing a hop', () => {
    const [a, b] = hopOf(ev(1, null, { source: 'websocket' }));
    expect(a).toBe(b);
  });

  it('hands the interval after response_sent back to the client', () => {
    expect(ownerAfter(REQUEST[4])).toBe('client');
  });
});

describe('exchanges', () => {
  it('counts what never came back, which is the whole burst story', () => {
    const m = buildRoute(BURST);
    expect(m.exchanges).toHaveLength(4);
    expect(m.exchanges.filter((x) => x.backAt === null)).toHaveLength(2);
    expect(m.exchanges.filter((x) => x.backAt === null).map((x) => x.key))
      .toEqual(['serviceGroups.list', 'scenes.list']);
  });

  it('pairs a response with the send of the same call, not merely the oldest', () => {
    const m = buildRoute(BURST);
    const rooms = m.exchanges.find((x) => x.key === 'rooms.list');
    expect(rooms?.ms).toBe(125);
  });
});

describe('the late answer', () => {
  it('notices a reply that lands after the client was already told it failed', () => {
    const m = buildRoute(REPETITION);
    expect(m.failure?.code).toBe('DEVICE_BUSY');
    expect(m.lateAnswer?.afterMs).toBe(30047 - 21874);
  });

  it('reports none when the request succeeded', () => {
    expect(buildRoute(REQUEST).lateAnswer).toBeNull();
  });
});

describe('baselines', () => {
  const many = (action: string, n: number, ms: number) =>
    Array.from({ length: n }, () => ({ action, totalLatencyMs: ms, relayLatencyMs: Math.round(ms / 2) }));

  it('ignores an action with too few samples to call anything typical', () => {
    // A median of one is the trace itself, and reporting that as "typical"
    // invites exactly the wrong conclusion.
    const b = baselinesFrom([...many('rare', MIN_BASELINE_SAMPLE - 1, 22083), ...many('common', 40, 94)]);
    expect(b.has('rare')).toBe(false);
    expect(b.get('common')?.p50).toBe(94);
    expect(b.get('common')?.n).toBe(40);
  });

  it('skips summaries with no duration rather than counting them as zero', () => {
    const b = baselinesFrom([
      ...many('x', 6, 100),
      { action: 'x', totalLatencyMs: null, relayLatencyMs: 40 },
    ]);
    expect(b.get('x')?.n).toBe(6);
  });
});

describe('verdicts', () => {
  it('leads with the retry count for a repetition', () => {
    const v = verdictOf(buildRoute(REPETITION));
    expect(v.shape).toBe('repetition');
    expect(v.headline).toContain('3 more times');
    expect(v.detail).toContain('8.2s');
    expect(v.ok).toBe(false);
  });

  it('leads with what never came back for a burst', () => {
    const v = verdictOf(buildRoute(BURST));
    expect(v.headline).toBe('2 of 4 calls were never answered.');
    expect(v.detail).toContain('stopped');
  });

  it('says nothing is wrong when nothing is', () => {
    const v = verdictOf(buildRoute(REQUEST));
    expect(v.ok).toBe(true);
    expect(v.headline).toBe('Nothing wrong.');
  });

  it('reports no baseline rather than a fabricated one', () => {
    const v = verdictOf(buildRoute(REQUEST), baselinesFrom([]));
    expect(v.baseline).toBeNull();
  });

  it('attaches a baseline when the sample is big enough', () => {
    const summaries = Array.from({ length: 30 }, () => ({
      action: 'automation.virtual_states', totalLatencyMs: 94, relayLatencyMs: 35,
    }));
    const v = verdictOf(buildRoute(REQUEST), baselinesFrom(summaries));
    expect(v.baseline?.p50).toBe(94);
  });
});

describe('bubbleUp', () => {
  const rows = (n: number, over: Partial<Record<string, unknown>> = {}) =>
    Array.from({ length: n }, () => ({
      action: 'automation.virtual_states', success: true, error: null,
      hopCount: 8, totalLatencyMs: 94, relayLatencyMs: 35, clientType: 'web',
      originInstance: 'homecast-prod-bb9f4cb7-5hdrz', ...over,
    }));

  it('ranks an outlier above a bigger but duller gap', () => {
    // 25% DEVICE_BUSY where nothing else ever is, versus 50%/8% on hops. The
    // second gap is arithmetically larger and tells you nothing.
    // The proportions are the ones the real incident produced: DEVICE_BUSY at
    // 25%/0%, hops at 50%/8%.
    const selection = [
      ...rows(1, { success: false, error: 'DEVICE_BUSY: Owning worker busy', hopCount: 14 }),
      ...rows(1, { hopCount: 14 }),
      ...rows(2),
    ];
    const rest = [...rows(92), ...rows(8, { hopCount: 14 })];
    const ranked = bubbleUp(selection, rest, TRACE_DIMENSIONS);
    expect(ranked[0].key).toBe('outcome');
    expect(ranked[0].best?.value).toBe('DEVICE_BUSY');
    expect(ranked[0].best?.onlyHere).toBe(true);
  });

  it('never leads on something under-represented', () => {
    const selection = [...rows(87), ...rows(13, { success: false, error: 'TIMEOUT' })];
    const rest = rows(100);
    const outcome = bubbleUp(selection, rest, TRACE_DIMENSIONS).find((d) => d.key === 'outcome')!;
    // "ok" is the commonest value in the selection and is *less* common than the
    // baseline; it must not be the headline.
    expect(outcome.values[0].value).toBe('ok');
    expect(outcome.best?.value).toBe('TIMEOUT');
  });

  it('reports no standout when the selection looks like the baseline', () => {
    const ranked = bubbleUp(rows(40), rows(200), TRACE_DIMENSIONS);
    expect(ranked.every((d) => d.best === null || d.best.delta <= 0.001)).toBe(true);
  });

  it('buckets a probe by its relay share rather than dropping it as unknown', () => {
    const where = TRACE_DIMENSIONS.find((d) => d.key === 'where')!;
    expect(where.of({ totalLatencyMs: null, relayLatencyMs: 15000 })).toBe('almost all relay');
    expect(where.of({ totalLatencyMs: 1000, relayLatencyMs: 100 })).toBe('mostly cloud');
    expect(where.of({ totalLatencyMs: null, relayLatencyMs: null })).toBeNull();
  });

  it('groups an error by its code, not its whole message', () => {
    const outcome = TRACE_DIMENSIONS.find((d) => d.key === 'outcome')!;
    expect(outcome.of({ success: false, error: 'DEVICE_BUSY: Owning worker for mac_8ca2 busy' }))
      .toBe('DEVICE_BUSY');
  });

  it('handles an empty baseline without dividing by zero', () => {
    const ranked = bubbleUp(rows(3), [], TRACE_DIMENSIONS);
    expect(ranked.every((d) => Number.isFinite(d.score))).toBe(true);
  });
});

describe('the time axis', () => {
  const events = [{ t: 0 }, { t: 36 }, { t: 47 }, { t: 21874 }, { t: 30047 }];

  it('is linear and monotonic when not elided', () => {
    const s = makeTimeScale(events, 30047, false);
    expect(s.x(0)).toBe(0);
    expect(s.x(30047)).toBe(1);
    expect(s.x(15000)).toBeCloseTo(0.499, 2);
    expect(s.cuts).toEqual([]);
  });

  it('squashes a dominant gap so the small spans stop being hairlines', () => {
    const linear = makeTimeScale(events, 30047, false);
    const elided = makeTimeScale(events, 30047, true);
    // The first three events occupy 0.16% of a linear axis and are unreadable.
    // Elided they get ~10%, which is the whole point of the toggle.
    expect(linear.x(47)).toBeLessThan(0.002);
    expect(elided.x(47) / linear.x(47)).toBeGreaterThan(20);
  });

  it('keeps order and the endpoints under elision', () => {
    const s = makeTimeScale(events, 30047, true);
    expect(s.x(0)).toBe(0);
    expect(s.x(30047)).toBeCloseTo(1, 5);
    const xs = events.map((e) => s.x(e.t));
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it('reports what it hid, so the view can mark it', () => {
    const s = makeTimeScale(events, 30047, true);
    expect(s.cuts.length).toBeGreaterThan(0);
    expect(s.cuts.some((c) => c.ms > 8000)).toBe(true);
    s.cuts.forEach((c) => { expect(c.to).toBeGreaterThan(c.from); });
  });

  it('does not elide a trace with no dominant gap', () => {
    const even = [{ t: 0 }, { t: 20 }, { t: 40 }, { t: 60 }, { t: 80 }];
    expect(makeTimeScale(even, 80, true).cuts).toEqual([]);
  });

  it('never divides by zero on a single-instant trace', () => {
    const s = makeTimeScale([{ t: 0 }], 0, true);
    expect(Number.isFinite(s.x(0))).toBe(true);
  });
});

describe('things the real data broke', () => {
  it('titles the trace with the request, not the first inner call', () => {
    // A trace carrying several calls was titled `rooms.list` in the detail view
    // while the list linking to it said `serviceGroups.list`.
    const m = buildRoute([
      ev(0, 'route_decision', { action: 'rooms.list' }),
      ev(1, 'relay_sent', { action: 'rooms.list' }),
      ev(40, 'relay_response', { action: 'rooms.list', latencyMs: 40 }),
      ev(50, 'server_received', { action: 'serviceGroups.list' }),
      ev(90, 'response_sent', { action: 'serviceGroups.list', latencyMs: 90 }),
    ]);
    expect(m.action).toBe('serviceGroups.list');
  });

  it('orders lanes by the journey, so a cross-pod route reads forwards', () => {
    const m = buildRoute([
      ev(0, 'server_received', { instanceId: 'homecast-prod-x-czm6v' }),
      ev(10, 'route_decision', { instanceId: 'homecast-prod-x-czm6v' }),
      ev(20, 'relay_sent', { instanceId: 'homecast-prod-x-6lpgk' }),
      ev(300, 'relay_response', { instanceId: 'homecast-prod-x-6lpgk', latencyMs: 280 }),
    ]);
    // czm6v took the request and handed to 6lpgk; alphabetical order reversed them.
    expect(m.lanes.indexOf('pod czm6v')).toBeLessThan(m.lanes.indexOf('pod 6lpgk'));
  });

  it('does not invent a client leg out of post-reply bookkeeping', () => {
    const m = buildRoute([
      ev(0, 'server_received', { action: 'accessory.refresh' }),
      ev(100, 'relay_sent', { action: 'accessory.refresh' }),
      ev(180, 'relay_response', { action: 'accessory.refresh', latencyMs: 80 }),
      ev(183, 'response_sent', { action: 'accessory.refresh', latencyMs: 183 }),
      ev(188, 'request_trace', { action: 'accessory.refresh', latencyMs: 188 }),
    ]);
    expect(m.legs.some((l) => l.lane === 'client')).toBe(false);
    expect(m.legs.every((l) => !l.summary.includes('response_sent'))).toBe(true);
  });

  it('does not call a trace fine when it is far slower than usual', () => {
    // "Nothing wrong." sat directly above a panel reading "10.7x slower".
    const rows = [
      ev(0, 'server_received', { action: 'accessories.list' }),
      ev(933, 'response_sent', { action: 'accessories.list', latencyMs: 933 }),
    ];
    const baselines = baselinesFrom(
      Array.from({ length: 11 }, () => ({ action: 'accessories.list', totalLatencyMs: 87, relayLatencyMs: 40 })),
    );
    const v = verdictOf(buildRoute(rows), baselines);
    expect(v.ok).toBe(true);
    expect(v.headline).toContain('slower than usual');
    expect(v.headline).not.toContain('Nothing wrong');
  });

  it('still says nothing is wrong when the trace is genuinely normal', () => {
    const rows = [
      ev(0, 'server_received', { action: 'accessories.list' }),
      ev(90, 'response_sent', { action: 'accessories.list', latencyMs: 90 }),
    ];
    const baselines = baselinesFrom(
      Array.from({ length: 11 }, () => ({ action: 'accessories.list', totalLatencyMs: 87, relayLatencyMs: 40 })),
    );
    expect(verdictOf(buildRoute(rows), baselines).headline).toBe('Nothing wrong.');
  });

  it('leaves a short trace on a true axis rather than hatching all of it', () => {
    // Six spans with one dominant gap: compressing it rescues nothing and the
    // hatch ended up covering nearly the whole width.
    const few = [{ t: 0 }, { t: 5 }, { t: 933 }];
    expect(makeTimeScale(few, 933, true).cuts).toEqual([]);
  });
});

describe('a burst is not one call', () => {
  const BURST_ONLY = [
    ev(0, 'route_decision', { action: 'rooms.list' }),
    ev(1, 'relay_sent', { action: 'rooms.list' }),
    ev(40, 'relay_response', { action: 'rooms.list', latencyMs: 40 }),
    ev(50, 'relay_sent', { action: 'scenes.list' }),
    ev(90, 'relay_response', { action: 'scenes.list', latencyMs: 40 }),
  ];

  it('is titled by its size, not by whichever call came first', () => {
    // The list linking here said `serviceGroups.list`; the detail said
    // `rooms.list`, because the first span happened to be an inner call.
    expect(buildRoute(BURST_ONLY).title).toBe('2 calls');
  });

  it('gets no baseline, because its total is the sum of many calls', () => {
    // Against a single call's median this reported "13.8x slower" for a trace
    // that was thirteen perfectly ordinary calls.
    const baselines = baselinesFrom(
      Array.from({ length: 20 }, () => ({ action: 'rooms.list', totalLatencyMs: 40, relayLatencyMs: 38 })),
    );
    expect(verdictOf(buildRoute(BURST_ONLY), baselines).baseline).toBeNull();
  });

  it('still titles an ordinary request by its action', () => {
    expect(buildRoute(REQUEST).title).toBe('automation.virtual_states');
  });

  it('does not name the logger as a phase', () => {
    const m = buildRoute([
      ev(0, 'server_received', { action: 'x' }),
      ev(10, null, { source: 'websocket' }),
      ev(60, 'response_sent', { action: 'x', latencyMs: 60 }),
    ]);
    expect(m.phases.every((p) => !p.label.includes('websocket'))).toBe(true);
  });
});

describe('what needs attention', () => {
  const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
  const summary = (o: Partial<Parameters<typeof groupIncidents>[0][number]> & { traceId: string }) =>
    ({ action: 'serviceGroup.set', totalLatencyMs: 500, relayLatencyMs: 400, success: true, ...o });

  const base = new Map([
    ['serviceGroup.set', { action: 'serviceGroup.set', n: 40, p50: 500, p50Relay: 400, p95: 900 }],
    ['scene.execute', { action: 'scene.execute', n: 40, p50: 200, p50Relay: 100, p95: 400 }],
  ]);

  it('states one fault once, however many traces hit it', () => {
    const traces = Array.from({ length: 61 }, (_, i) => summary({
      traceId: `t${i}`, success: false, error: 'send_failed: Cannot call "send"',
      totalLatencyMs: 60_000 + i, startTime: at(i),
    }));
    const groups = groupIncidents(traces, base);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(61);
    expect(groups[0].why).toBe('send_failed');
    // The worst example is the one worth opening.
    expect(groups[0].worst.traceId).toBe('t60');
  });

  it('does not let one loud fault crowd out the others', () => {
    const loud = Array.from({ length: 61 }, (_, i) => summary({
      traceId: `loud${i}`, success: false, error: 'send_failed: x', totalLatencyMs: 60_000, startTime: at(i),
    }));
    const quiet = [summary({
      traceId: 'quiet', action: 'scene.execute', success: false,
      error: 'BRIDGE_TIMEOUT: no answer', totalLatencyMs: 8_000, startTime: at(3),
    })];
    const groups = groupIncidents([...loud, ...quiet], base);
    expect(groups.map((g) => g.why)).toEqual(['send_failed', 'BRIDGE_TIMEOUT']);
    // Loudest first, but the other one is still on the page.
    expect(groups[0].count).toBe(61);
    expect(groups[1].count).toBe(1);
  });

  it('buckets slowness by decade so it groups at all', () => {
    const slow = [3.2, 3.9, 4.5, 12, 30].map((mult, i) => summary({
      traceId: `s${i}`, totalLatencyMs: 500 * mult, startTime: at(i),
    }));
    const groups = groupIncidents(slow, base);
    expect(groups.map((g) => `${g.why}:${g.count}`)).toEqual(['3-10x slower:3', '10x+ slower:2']);
  });

  it('ignores a trace that is merely slower than its neighbours', () => {
    expect(groupIncidents([summary({ traceId: 'a', totalLatencyMs: 1400 })], base)).toEqual([]);
  });

  it('keeps a failure with no baseline for its action', () => {
    const groups = groupIncidents(
      [summary({ traceId: 'a', action: 'brand.new', success: false, error: 'nope' })],
      base,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].action).toBe('brand.new');
  });

  it('reports the span a fault covers, not just its count', () => {
    const groups = groupIncidents([
      summary({ traceId: 'a', success: false, error: 'send_failed', startTime: at(0) }),
      summary({ traceId: 'b', success: false, error: 'send_failed', startTime: at(9) }),
    ], base);
    expect(groups[0].lastMs - groups[0].firstMs).toBe(9 * 60_000);
  });
});

describe('elision cuts dead time only', () => {
  // A trace whose one long interval is a leg: the relay held it for 7s. Cutting
  // that is cutting the finding.
  const spread = [0, 40, 80, 7_080, 7_120, 7_200].map((t) => ({ t }));

  it('leaves a long interval alone when a leg covers it', () => {
    const busy = [{ at: 80, to: 7_080 }];
    const scale = makeTimeScale(spread, 7_200, true, busy);
    expect(scale.elided).toBe(false);
    expect(scale.cuts).toEqual([]);
    // ...and the leg keeps its true share of the axis.
    expect(scale.x(7_080) - scale.x(80)).toBeCloseTo(7_000 / 7_200, 2);
  });

  it('still cuts the same interval when nothing was happening in it', () => {
    const scale = makeTimeScale(spread, 7_200, true, []);
    expect(scale.elided).toBe(true);
    expect(scale.cuts).toHaveLength(1);
    expect(scale.cuts[0].ms).toBe(7_000);
  });

  it('does not shrink a small leg to rescue a large one', () => {
    // The shape that broke it: 7.0s of work, then 448ms of work, then a 3s
    // silence. Only the silence may be cut, so the 448ms leg stays small.
    const events = [0, 30, 7_030, 7_478, 10_478].map((t) => ({ t }));
    const busy = [{ at: 30, to: 7_030 }, { at: 7_030, to: 7_478 }];
    const scale = makeTimeScale(events, 10_478, true, busy);
    const big = scale.x(7_030) - scale.x(30);
    const small = scale.x(7_478) - scale.x(7_030);
    expect(big).toBeGreaterThan(small * 10);
    expect(scale.cuts).toHaveLength(1);
  });
});
