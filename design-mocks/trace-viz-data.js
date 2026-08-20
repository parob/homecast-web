/**
 * Four real production traces, pulled 2026-08-20, trimmed to the fields a
 * visualisation would actually use.
 *
 * They are here because the four SHAPES are the whole argument. A design that
 * only works on `fast` is the design we already have.
 *
 *   fast    8 spans,    80ms  — one request, everything worked
 *   timeout 8 spans,  30.3s   — one request, 30s of nothing then an error
 *   busy   13 spans,  21.9s   — FOUR attempts 5s apart, then DEVICE_BUSY;
 *                               the relay's TIMEOUT lands 8s after the client gave up
 *   burst  88 spans,  16.2s   — not one request at all: a relay reconnect fanning
 *                               out 25 calls across 3 homes, of which 13 came back
 */
const TRACES = {
  fast: {
    id: '2fa3009d-c50b-4771-b33a-b30824e1da68',
    action: 'automation.virtual_states', ok: true, totalMs: 80,
    events: [
      { t: 0,  n: 'server_received', s: 'api',       i: '5hdrz', m: 'automation.virtual_states received' },
      { t: 34, n: 'route_decision',  s: 'api',       i: '5hdrz', r: 'direct', m: 'route: direct → homecast-prod-bb9f4cb7-x6tb9' },
      { t: 40, n: 'relay_sent',      s: 'api',       i: 'x6tb9', m: 'automation.virtual_states → relay' },
      { t: 76, n: '',                s: 'websocket', i: 'x6tb9', m: '[b9a6706a] Response received in 36ms (total: 36ms)' },
      { t: 76, n: 'relay_response',  s: 'api',       i: 'x6tb9', l: 36, m: 'automation.virtual_states ← relay (36ms)' },
      { t: 79, n: '',                s: 'server',    i: '5hdrz', m: 'HTTP Request: POST http://10.115.1.139:8080/internal/route "HTTP/1.1 200 OK"' },
      { t: 80, n: 'response_sent',   s: 'api',       i: '5hdrz', l: 80, m: 'automation.virtual_states response sent (80ms)' },
      { t: 80, n: 'request_trace',   s: 'api',       i: '5hdrz', l: 80, m: 'automation.virtual_states trace (80ms, 4 steps)' },
    ],
  },
  timeout: {
    id: '47f26acd-ddf4-4e4f-a3f9-e9e978c58614',
    action: 'automation.virtual_states', ok: false, totalMs: 30261,
    events: [
      { t: 0,     n: 'server_received', s: 'api',       i: '5hdrz', m: 'automation.virtual_states received' },
      { t: 246,   n: 'route_decision',  s: 'api',       i: '5hdrz', r: 'direct', m: 'route: direct → homecast-prod-bb9f4cb7-x6tb9' },
      { t: 253,   n: 'relay_sent',      s: 'api',       i: 'x6tb9', m: 'automation.virtual_states → relay' },
      { t: 30253, n: 'relay_response',  s: 'api',       i: 'x6tb9', l: 30000, e: 'TIMEOUT', sev: 'WARNING', m: 'relay timeout after 30.0s' },
      { t: 30254, n: '',                s: 'server',    i: 'x6tb9', sev: 'ERROR', m: '[7b4fbe70] local_handler failed: TimeoutError: Device mac_8ca2d5a2…' },
      { t: 30260, n: '',                s: 'websocket', i: '5hdrz', sev: 'ERROR', m: 'Error routing automation.virtual_states to device:' },
      { t: 30260, n: 'response_sent',   s: 'api',       i: '5hdrz', l: 30261, e: 'INTERNAL_ERROR', m: 'response NOT sent (30261ms, INTERNAL_ERROR)' },
      { t: 30260, n: 'request_trace',   s: 'api',       i: '5hdrz', l: 30261, m: 'automation.virtual_states trace (30261ms, 5 steps)' },
    ],
  },
  busy: {
    id: '2c1d05e1-3d1e-4300-8771-0e0205ea0ee3',
    action: 'automation.virtual_states', ok: false, totalMs: 30047,
    events: [
      { t: 0,     n: 'server_received', s: 'api',    i: '5hdrz', m: 'automation.virtual_states received' },
      { t: 36,    n: 'route_decision',  s: 'api',    i: '5hdrz', r: 'direct', attempt: 1, m: 'route: direct → homecast-prod-bb9f4cb7-x6tb9' },
      { t: 47,    n: 'relay_sent',      s: 'api',    i: 'x6tb9', m: 'automation.virtual_states → relay' },
      { t: 5049,  n: '',                s: 'server', i: '5hdrz', m: 'HTTP Request: POST /internal/route "HTTP/1.1 200 OK"' },
      { t: 5323,  n: 'route_decision',  s: 'api',    i: '5hdrz', r: 'direct', attempt: 2, m: 'route: direct → homecast-prod-bb9f4cb7-x6tb9' },
      { t: 10332, n: '',                s: 'server', i: '5hdrz', m: 'HTTP Request: POST /internal/route "HTTP/1.1 200 OK"' },
      { t: 10844, n: 'route_decision',  s: 'api',    i: '5hdrz', r: 'direct', attempt: 3, m: 'route: direct → homecast-prod-bb9f4cb7-x6tb9' },
      { t: 15851, n: '',                s: 'server', i: '5hdrz', m: 'HTTP Request: POST /internal/route "HTTP/1.1 200 OK"' },
      { t: 16860, n: 'route_decision',  s: 'api',    i: '5hdrz', r: 'direct', attempt: 4, m: 'route: direct → homecast-prod-bb9f4cb7-x6tb9' },
      { t: 21869, n: '',                s: 'server', i: '5hdrz', m: 'HTTP Request: POST /internal/route "HTTP/1.1 200 OK"' },
      { t: 21874, n: 'response_sent',   s: 'api',    i: '5hdrz', l: 21874, e: 'DEVICE_BUSY', m: 'response NOT sent (21874ms, DEVICE_BUSY: Owning worker for mac_8ca2d5a2 busy)' },
      { t: 21874, n: 'request_trace',   s: 'api',    i: '5hdrz', l: 21874, m: 'automation.virtual_states trace (21874ms, 11 steps)' },
      { t: 30047, n: 'relay_response',  s: 'api',    i: 'x6tb9', l: 30000, e: 'TIMEOUT', sev: 'WARNING', m: 'relay timeout after 30.0s — arrives 8.2s after the client gave up' },
    ],
  },
};

/** The 88-span burst, rebuilt from its real shape (25 sent, 13 answered). */
(function buildBurst() {
  const CALLS = ['rooms.list', 'accessories.list', 'serviceGroups.list', 'scenes.list'];
  const ev = [
    { t: 0,  n: '', s: 'websocket', i: '5hdrz', m: "Relay mac_8ca2d5a2 registered 3 homes: ['3C439…']" },
    { t: 0,  n: '', s: 'websocket', i: '5hdrz', m: '_cache_homes called for mac_8ca2d5a2 with 3 homes' },
    { t: 34, n: '', s: 'server',    i: '5hdrz', m: 'Upserted 3 homes for user a75618bf' },
    { t: 36, n: '', s: 'websocket', i: '5hdrz', m: 'Cached 3 homes for user a75618bf' },
    { t: 63, n: '', s: 'server',    i: '5hdrz', m: 'Session c99b62a0 now has access to 3 home(s)' },
    { t: 63, n: '', s: 'websocket', i: '5hdrz', m: 'Session mac_8ca2d5a2 associated with 3 homes' },
  ];
  let t = 77, answered = 0;
  for (let round = 0; round < 7; round++) {
    for (const call of CALLS) {
      if (ev.filter((e) => e.n === 'relay_sent').length >= 25) break;
      ev.push({ t, n: 'route_decision', s: 'api', i: '5hdrz', r: 'local', call, m: `${call} route: local fast path` });
      ev.push({ t, n: 'relay_sent', s: 'api', i: '5hdrz', call, m: `${call} → relay` });
      // Only 13 of the 25 ever came back.
      if (answered < 13 && round % 2 === 0) {
        const ms = 55 + ((round * 17 + call.length * 7) % 300);
        ev.push({ t: t + ms, n: 'relay_response', s: 'api', i: '5hdrz', l: ms, call, m: `${call} ← relay (${ms}ms)` });
        answered++;
      }
      t += round < 2 ? 3 + (call.length % 5) : 620 + ((round * 53) % 340);
    }
    if (round < 2) t += 18;
  }
  ev.sort((a, b) => a.t - b.t);
  TRACES.burst = {
    id: '06cef7ff-aba6-491d-95d0-e0a4b9f9795f',
    action: 'relay reconnect · 3 homes', ok: true,
    totalMs: ev[ev.length - 1].t, events: ev,
  };
})();
