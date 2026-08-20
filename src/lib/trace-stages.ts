/**
 * Maps a trace's spans onto the architecture a request actually travels through.
 *
 * The waterfall in the log explorer answers "what happened, in what order". This
 * answers a different question: "where did it go, and where did the time go" —
 * client, edge, server, routing, relay, bridge, HomeKit, the accessory.
 *
 * The honesty rule is the whole point. Most stages have no telemetry most of the
 * time: the Swift and relay spans are opt-in (analytics + Developer Mode +
 * "Send activity logs"), and the accessory itself can never report. So a stage
 * is never *invented*. It is `observed` when spans say so, `inferred` only where
 * one span proves another hop must have happened (a `direct` route decision
 * means the request crossed pods, whether or not the peer reported), and
 * `not-reporting` otherwise — with the reason, so the picture reads as a known
 * gap rather than a failure.
 *
 * Pure and unit-tested, and it lives in the host app because the cloud package
 * has no test runner of its own.
 */

export type StageId =
  | 'client'
  | 'edge'
  | 'ingress'
  | 'core'
  | 'routing'
  | 'peer'
  | 'relay_socket'
  | 'relay_web'
  | 'bridge'
  | 'homekit'
  | 'accessory';

export type StageStatus = 'observed' | 'inferred' | 'not-reporting' | 'skipped' | 'failed';

/** Why a stage has nothing to show. Rendered to the user verbatim. */
export type MissingReason =
  | 'activity-logs-off'
  | 'never-instrumented'
  | 'not-measurable'
  | 'not-on-this-path';

export interface TraceSpanInput {
  id: string;
  timestamp: string;
  severity: string;
  message: string;
  spanName: string | null;
  action: string | null;
  source: string | null;
  latencyMs: number | null;
  success: boolean | null;
  error: string | null;
  instanceId: string | null;
  routingMode: string | null;
  targetSlot: string | null;
  clientType: string | null;
  deviceId: string | null;
  /** Full jsonPayload, as text. `request_trace` carries its steps in here. */
  payload: string | null;
}

export interface StageStep {
  name: string;
  offsetMs: number | null;
  detail: string | null;
  status: 'ok' | 'fail';
}

export interface Stage {
  id: StageId;
  label: string;
  /** Where this code runs, shown as a sub-label. */
  runtime: string;
  status: StageStatus;
  reason?: MissingReason;
  /**
   * ms from the first span in the trace to this stage's first span — i.e. when
   * the request *reached* here. This is a real, observed instant.
   */
  startMs: number | null;
  endMs: number | null;
  /**
   * A genuinely measured duration for this stage, or null.
   *
   * Deliberately not `endMs - startMs`. Most stages emit one span on the way
   * out and another on the way back, so that difference is the bracket around
   * everything downstream, not the stage's own cost — which is how the server
   * stage came to claim it took the entire request. Only two durations in the
   * system are real: the relay round trip, and the HomeKit call the relay
   * itself times.
   */
  measuredMs: number | null;
  /** Spans attributed to this stage. */
  spans: TraceSpanInput[];
  /** Sub-steps, from the RequestTrace step list where one exists. */
  steps: StageStep[];
  error: string | null;
}

/** The routing block `RequestTrace` carries. Real values, straight off the wire. */
export interface RoutingInfo {
  mode: RoutingMode | null;
  sourceInstance: string | null;
  sourceSlot: string | null;
  targetInstance: string | null;
  targetSlot: string | null;
  retried: boolean;
}

export interface TraceJourney {
  stages: Stage[];
  /** Wall-clock span of everything observed. */
  totalMs: number;
  baseTime: number;
  routingMode: RoutingMode | null;
  action: string | null;
  /** What started this, for server-initiated work. */
  trigger: string | null;
  clientType: string | null;
  /** The pod that took the request. */
  instanceId: string | null;
  /** The relay this request was for, as its device id. */
  relayDeviceId: string | null;
  /** The device that asked, as its device id. */
  clientDeviceId: string | null;
  /** Routing metadata, when a `request_trace` span carried it. */
  routing: RoutingInfo | null;
  /** Unaccounted time between adjacent observed stages — where latency hides. */
  gaps: Array<{ afterStage: StageId; ms: number }>;
  ok: boolean;
}

/**
 * Live routing modes. There is no `pubsub` — Pub/Sub routing was removed in
 * April 2026 and only the string survives in old schemas.
 */
export type RoutingMode = 'local' | 'sibling' | 'direct' | 'unknown';

const STAGE_DEFS: Array<{ id: StageId; label: string; runtime: string }> = [
  { id: 'client', label: 'Client', runtime: 'browser · iOS · Mac · Tauri · HA · MQTT · API' },
  { id: 'edge', label: 'Edge', runtime: 'GCP load balancer → Envoy' },
  { id: 'ingress', label: 'Server', runtime: 'uvicorn worker · Python' },
  { id: 'core', label: 'Core', runtime: 'auth · home lookup · id translation' },
  { id: 'routing', label: 'Routing', runtime: 'local · sibling · direct' },
  { id: 'peer', label: 'Peer pod', runtime: 'HMAC POST /internal/route' },
  { id: 'relay_socket', label: 'Relay socket', runtime: 'Swift URLSessionWebSocketTask' },
  { id: 'relay_web', label: 'Relay app', runtime: 'WKWebView · TypeScript' },
  { id: 'bridge', label: 'Native bridge', runtime: 'window.homekit → HomeKitBridge' },
  { id: 'homekit', label: 'HomeKit', runtime: 'HMCharacteristic.writeValue' },
  { id: 'accessory', label: 'Accessory', runtime: 'HAP · Wi-Fi · Thread · Matter' },
];

/** Which stage a span belongs to. Unknown span names are ignored, not guessed. */
const SPAN_STAGE: Record<string, StageId> = {
  client_sent: 'client',
  client_received: 'client',
  server_received: 'ingress',
  request_trace: 'core',
  route_decision: 'routing',
  peer_forward: 'peer',
  peer_received: 'peer',
  relay_sent: 'relay_socket',
  relay_response: 'relay_socket',
  relay_ws_received: 'relay_socket',
  relay_received: 'relay_web',
  relay_dispatch: 'relay_web',
  relay_responded: 'relay_web',
  bridge_in: 'bridge',
  bridge_out: 'bridge',
  homekit_write: 'homekit',
  response_sent: 'ingress',
};

/** RequestTrace step names, folded into the stage they describe. */
const STEP_STAGE: Record<string, StageId> = {
  received: 'ingress',
  auth: 'core',
  home_lookup: 'core',
  session_lookup: 'routing',
  route_decision: 'routing',
  sibling_route: 'routing',
  remote_receive: 'peer',
  lock_acquire: 'relay_socket',
  relay_send: 'relay_socket',
  relay_response: 'relay_socket',
  homekit_call: 'homekit',
};

/** Stages that no code will ever report, so the UI can say so plainly. */
const NEVER_INSTRUMENTED = new Set<StageId>(['edge', 'accessory']);

/** Stages whose spans only arrive when the user has opted in. */
const OPT_IN = new Set<StageId>(['client', 'relay_web', 'bridge', 'homekit']);

function parsePayload(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Pull the RequestTrace step list out of a `request_trace` span. */
export function stepsFromSpan(span: TraceSpanInput): StageStep[] {
  const payload = parsePayload(span.payload);
  const metadata = payload.metadata as { steps?: unknown } | undefined;
  const raw = Array.isArray(metadata?.steps) ? metadata.steps : [];
  return raw.flatMap((s): StageStep[] => {
    if (!s || typeof s !== 'object') return [];
    const step = s as Record<string, unknown>;
    if (typeof step.name !== 'string') return [];
    return [{
      name: step.name,
      offsetMs: typeof step.ms === 'number' ? step.ms : null,
      detail: typeof step.detail === 'string' ? step.detail : null,
      status: step.status === 'fail' ? 'fail' : 'ok',
    }];
  });
}

/** Pull the routing block out of a `request_trace` span. camelCase on the wire. */
export function routingFromSpan(span: TraceSpanInput): RoutingInfo | null {
  const metadata = parsePayload(span.payload).metadata as
    { routing?: Record<string, unknown> } | undefined;
  const r = metadata?.routing;
  if (!r || typeof r !== 'object') return null;
  const str = (k: string): string | null =>
    typeof r[k] === 'string' && r[k] !== '' ? (r[k] as string) : null;
  return {
    mode: normaliseRoutingMode(str('mode')),
    sourceInstance: str('sourceInstance'),
    sourceSlot: str('sourceSlot'),
    targetInstance: str('targetInstance'),
    targetSlot: str('targetSlot'),
    retried: r.retried === true,
  };
}

function normaliseRoutingMode(value: string | null): RoutingMode | null {
  if (value === 'local' || value === 'sibling' || value === 'direct') return value;
  if (value === 'unknown') return 'unknown';
  return null;
}

/**
 * Build the journey.
 *
 * `activityLogsExpected` says whether the opt-in spans *should* be here. When
 * false, an absent client/relay/HomeKit stage is reported as
 * `activity-logs-off` rather than looking like a fault — which is the normal
 * state, since those spans are off by default.
 */
export function buildJourney(
  spans: TraceSpanInput[],
  options: { activityLogsExpected?: boolean } = {},
): TraceJourney {
  const ordered = [...spans]
    .filter((s) => !Number.isNaN(Date.parse(s.timestamp)))
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  if (!ordered.length) {
    return {
      stages: STAGE_DEFS.map((d) => ({
        ...d,
        status: 'not-reporting' as StageStatus,
        reason: NEVER_INSTRUMENTED.has(d.id) ? 'never-instrumented' : 'not-on-this-path',
        startMs: null,
        endMs: null,
        measuredMs: null,
        spans: [],
        steps: [],
        error: null,
      })),
      totalMs: 0,
      baseTime: 0,
      routingMode: null,
      action: null,
      trigger: null,
      clientType: null,
      instanceId: null,
      relayDeviceId: null,
      clientDeviceId: null,
      routing: null,
      gaps: [],
      ok: true,
    };
  }

  const baseTime = Date.parse(ordered[0].timestamp);
  const at = (s: TraceSpanInput) => Date.parse(s.timestamp) - baseTime;

  const routingMode = normaliseRoutingMode(
    ordered.find((s) => s.routingMode)?.routingMode ?? null,
  );
  const action = ordered.find((s) => s.action)?.action ?? null;
  const clientType = ordered.find((s) => s.clientType)?.clientType ?? null;

  const instanceId = ordered.find((s) => s.instanceId)?.instanceId ?? null;
  // The relay is named on the spans that talk to it; the caller on the spans
  // that bracket the request. Both are device ids and they are easy to swap.
  const relayDeviceId = ordered.find(
    (s) => s.deviceId && (s.spanName === 'relay_sent' || s.spanName === 'relay_response'),
  )?.deviceId ?? null;
  const clientDeviceId = ordered.find(
    (s) => s.deviceId && (s.spanName === 'server_received' || s.spanName === 'response_sent'),
  )?.deviceId ?? null;

  const traceSpan = ordered.find((s) => s.spanName === 'request_trace');
  const trigger = traceSpan
    ? ((parsePayload(traceSpan.payload).trigger as string | undefined) ?? null)
    : ((parsePayload(ordered[0].payload).trigger as string | undefined) ?? null);
  const routing = traceSpan ? routingFromSpan(traceSpan) : null;

  // Bucket spans and RequestTrace steps by stage.
  const spansByStage = new Map<StageId, TraceSpanInput[]>();
  const stepsByStage = new Map<StageId, StageStep[]>();

  for (const span of ordered) {
    const stage = span.spanName ? SPAN_STAGE[span.spanName] : undefined;
    if (!stage) continue;
    const list = spansByStage.get(stage) ?? [];
    list.push(span);
    spansByStage.set(stage, list);
  }

  // A routed request produces a RequestTrace on the origin pod AND on the pod
  // that served it, and the two are merged before being logged — so the same
  // step can arrive twice, milliseconds apart and out of order. Keep the first
  // of each (name, offset) pair and sort, or the step list reads as a stutter.
  const seenSteps = new Set<string>();
  for (const span of ordered) {
    if (span.spanName !== 'request_trace') continue;
    for (const step of stepsFromSpan(span)) {
      const stage = STEP_STAGE[step.name];
      if (!stage) continue;
      const key = `${step.name}@${step.offsetMs ?? '?'}:${step.detail ?? ''}`;
      if (seenSteps.has(key)) continue;
      seenSteps.add(key);
      const list = stepsByStage.get(stage) ?? [];
      list.push(step);
      stepsByStage.set(stage, list);
    }
  }
  for (const list of stepsByStage.values()) {
    list.sort((a, b) => (a.offsetMs ?? 0) - (b.offsetMs ?? 0));
  }

  const stages: Stage[] = STAGE_DEFS.map((def) => {
    const stageSpans = spansByStage.get(def.id) ?? [];
    const stageSteps = stepsByStage.get(def.id) ?? [];

    const times = [
      ...stageSpans.map(at),
      ...stageSteps.map((s) => s.offsetMs).filter((n): n is number => n !== null),
    ];
    const failed = stageSpans.some((s) => s.success === false || s.severity === 'ERROR')
      || stageSteps.some((s) => s.status === 'fail');
    const error = stageSpans.find((s) => s.error)?.error
      ?? stageSteps.find((s) => s.status === 'fail')?.detail
      ?? null;

    let status: StageStatus;
    let reason: MissingReason | undefined;

    if (times.length) {
      status = failed ? 'failed' : 'observed';
    } else if (NEVER_INSTRUMENTED.has(def.id)) {
      // The edge is real even with no telemetry — a request that reached the
      // server necessarily crossed it. The accessory is different: it sits
      // behind Apple's stack and nothing we ship could ever measure it.
      status = def.id === 'edge' ? 'inferred' : 'not-reporting';
      reason = def.id === 'edge' ? 'never-instrumented' : 'not-measurable';
    } else if (def.id === 'peer') {
      // Only crossed on a `direct` route, and the decision span proves it even
      // when the peer itself reported nothing.
      if (routingMode === 'direct') {
        status = 'inferred';
      } else if (routingMode) {
        status = 'skipped';
        reason = 'not-on-this-path';
      } else {
        status = 'not-reporting';
        reason = 'not-on-this-path';
      }
    } else if (OPT_IN.has(def.id)) {
      status = 'not-reporting';
      reason = options.activityLogsExpected ? 'not-on-this-path' : 'activity-logs-off';
    } else {
      status = 'not-reporting';
      reason = 'not-on-this-path';
    }

    // Only trust a latency the emitter actually measured, and only where it
    // describes this stage rather than the whole request. `response_sent`
    // carries the end-to-end total and belongs at the top of the view, not on
    // the server card.
    let measuredMs: number | null = null;
    const roundTrip = stageSpans.find((s) => s.spanName === 'relay_response');
    if (roundTrip?.latencyMs != null) {
      measuredMs = roundTrip.latencyMs;
    } else {
      const timed = stageSteps.find((s) => /^\d+ms/.test(s.detail ?? '')
        || /\b(\d+)ms\b/.test(s.detail ?? ''));
      const match = timed?.detail?.match(/(\d+)\s*ms/);
      if (match) measuredMs = Number(match[1]);
    }

    return {
      ...def,
      status,
      reason,
      startMs: times.length ? Math.min(...times) : null,
      endMs: times.length ? Math.max(...times) : null,
      measuredMs,
      spans: stageSpans,
      steps: stageSteps,
      error,
    };
  });

  // Unaccounted time between adjacent observed stages. This is where latency
  // nobody has instrumented actually lives, so it is worth drawing.
  const gaps: TraceJourney['gaps'] = [];
  const seen = stages.filter((s) => s.startMs !== null && s.endMs !== null);
  for (let i = 0; i < seen.length - 1; i++) {
    const gap = (seen[i + 1].startMs as number) - (seen[i].endMs as number);
    if (gap > 0) gaps.push({ afterStage: seen[i].id, ms: gap });
  }

  const totalMs = Math.max(...ordered.map(at), 0);

  return {
    stages,
    totalMs,
    baseTime,
    routingMode,
    action,
    trigger,
    clientType,
    instanceId,
    relayDeviceId,
    clientDeviceId,
    routing,
    gaps,
    ok: !stages.some((s) => s.status === 'failed'),
  };
}

/**
 * Where each stage physically runs.
 *
 * Eleven stages in a flat row gave no sense of place — you could not tell which
 * part was the phone in your hand, which was a pod in europe-west1 and which was
 * a Mac in someone's kitchen. Grouping by machine is what makes the picture
 * readable, and it mirrors how the public /how-it-works diagram is arranged.
 */
export type PlaceId = 'client' | 'cloud' | 'relay' | 'home';

export interface Place {
  id: PlaceId;
  label: string;
  stages: Stage[];
  /** Sum of what was genuinely measured here. Null when nothing reported. */
  measuredMs: number | null;
  /** When the request first reached this machine. */
  startMs: number | null;
  anyObserved: boolean;
}

const STAGE_PLACE: Record<StageId, PlaceId> = {
  client: 'client',
  edge: 'cloud',
  ingress: 'cloud',
  core: 'cloud',
  routing: 'cloud',
  peer: 'cloud',
  relay_socket: 'relay',
  relay_web: 'relay',
  bridge: 'relay',
  homekit: 'home',
  accessory: 'home',
};

const PLACE_LABELS: Record<PlaceId, string> = {
  client: 'Your device',
  cloud: 'homecast.cloud',
  relay: 'Your Mac',
  home: 'Your home',
};

/** Group the drawn stages by the machine they run on, in journey order. */
export function placesOf(journey: TraceJourney): Place[] {
  const order: PlaceId[] = ['client', 'cloud', 'relay', 'home'];
  return order.map((id) => {
    const stages = visibleStages(journey).filter((s) => STAGE_PLACE[s.id] === id);
    const measured = stages
      .map((s) => s.measuredMs)
      .filter((n): n is number => n !== null);
    const starts = stages
      .map((s) => s.startMs)
      .filter((n): n is number => n !== null);
    return {
      id,
      label: PLACE_LABELS[id],
      stages,
      measuredMs: measured.length ? measured.reduce((a, b) => a + b, 0) : null,
      startMs: starts.length ? Math.min(...starts) : null,
      anyObserved: stages.some((s) => s.status === 'observed' || s.status === 'failed'),
    };
  });
}

/** The stages a journey should actually draw, given how it was routed. */
export function visibleStages(journey: TraceJourney): Stage[] {
  return journey.stages.filter((s) => s.status !== 'skipped');
}

/** Human wording for why a stage is blank. */
export function reasonLabel(reason: MissingReason | undefined): string {
  switch (reason) {
    case 'activity-logs-off':
      return 'Activity logs are off for this device';
    case 'never-instrumented':
      return 'Not instrumented — inferred from the spans either side';
    case 'not-measurable':
      return 'Outside our code — nothing here can report';
    case 'not-on-this-path':
      return 'Not part of this request';
    default:
      return 'No data';
  }
}

// ---------------------------------------------------------------------------
// Real values, for the drill-down
// ---------------------------------------------------------------------------

/**
 * What this trace actually did inside one stage.
 *
 * The first drill-down was a paragraph of prose per stage — the same words for
 * every request, which told you how the system works and nothing about the
 * request in front of you. These pull the values out of the spans instead: the
 * pod that took it, the worker it routed to, the relay it went to, the round
 * trip it measured. Static explanation is a caption on the picture, not the
 * content of the panel.
 *
 * Absent means absent. Nothing here substitutes a plausible-looking default,
 * because a made-up pod name in a debugging tool is worse than a blank.
 */
export interface StageFact {
  label: string;
  value: string;
  /** The untruncated form, when `value` had to be shortened to fit. */
  full?: string;
}

/** `homecast-prod-786fc87f4b-6dm4f` → `6dm4f`. The suffix is what identifies it. */
export function shortInstance(id: string | null): string | null {
  if (!id) return null;
  const parts = id.split('-');
  return parts.length > 1 ? (parts[parts.length - 1] as string) : id;
}

/** `mac_8ca2d5a2-36f2-…` → `mac_8ca2d5a2`. Matches how the server logs them. */
export function shortDevice(id: string | null): string | null {
  if (!id) return null;
  const underscore = id.indexOf('_');
  if (underscore === -1) return id.slice(0, 12);
  return id.slice(0, underscore + 9);
}

function ms(value: number | null): string | null {
  if (value === null) return null;
  return value < 1000 ? `${Math.round(value)}ms` : `${(value / 1000).toFixed(2)}s`;
}

function stepDetail(stage: Stage, name: string): string | null {
  return stage.steps.find((s) => s.name === name)?.detail ?? null;
}

function spanNamed(stage: Stage, name: string): TraceSpanInput | undefined {
  return stage.spans.find((s) => s.spanName === name);
}

function fact(label: string, value: string | null, full?: string | null): StageFact[] {
  if (!value) return [];
  return [{ label, value, ...(full && full !== value ? { full } : {}) }];
}

/**
 * Live values for the nodes of a stage's sub-diagram, keyed by node.
 *
 * The keys are part of the contract with `StageDiagram` — a node whose key is
 * missing here simply draws without a caption, which is the honest rendering
 * for a stage that reports nothing.
 */
export function stageNodeValues(
  stage: Stage,
  journey: TraceJourney,
): Record<string, string | null> {
  const pod = shortInstance(journey.instanceId);
  const relay = shortDevice(journey.relayDeviceId);
  const routing = journey.routing;
  const mode = journey.routingMode;

  switch (stage.id) {
    case 'client':
      return {
        app: journey.clientType ?? shortDevice(journey.clientDeviceId),
        router: journey.action,
        cloud: pod,
      };
    case 'edge':
      return {
        lb: null,
        envoy: routing?.targetSlot ?? null,
        pod,
      };
    case 'ingress':
      return {
        worker: pod,
        trace: stepDetail(stage, 'received') ? 'established' : null,
        handler: journey.action,
      };
    case 'core':
      return {
        auth: stepDetail(stage, 'auth'),
        home: (stepDetail(stage, 'home_lookup') ?? '').replace(/^device=/, '') || null,
        translate: relay,
      };
    case 'routing':
      return {
        owner: relay,
        local: mode === 'local' ? (pod ?? 'this worker') : null,
        sibling: mode === 'sibling' ? 'same pod' : null,
        direct: mode === 'direct'
          ? (shortInstance(routing?.targetInstance ?? null) ?? routing?.targetSlot ?? 'peer')
          : null,
      };
    case 'peer':
      return {
        from: shortInstance(routing?.sourceInstance ?? null) ?? pod,
        post: routing?.retried ? 'retried' : null,
        to: shortInstance(routing?.targetInstance ?? null) ?? routing?.targetSlot ?? null,
      };
    case 'relay_socket':
      return {
        server: pod,
        socket: ms(stage.measuredMs),
        relay,
      };
    case 'relay_web':
      return {
        dispatch: spanNamed(stage, 'relay_received') ? 'received' : null,
        decide: spanNamed(stage, 'relay_dispatch')?.action ?? null,
        bridge: ms(spanNamed(stage, 'relay_responded')?.latencyMs ?? null),
      };
    case 'bridge':
      return {
        js: spanNamed(stage, 'bridge_in') ? 'called' : null,
        native: ms(spanNamed(stage, 'bridge_out')?.latencyMs ?? null),
        homekit: null,
      };
    case 'homekit':
      return {
        write: ms(spanNamed(stage, 'homekit_write')?.latencyMs ?? stage.measuredMs),
        hub: null,
        accessory: null,
      };
    default:
      return {};
  }
}

/** The values worth reading in full, above the picture. */
export function stageFacts(stage: Stage, journey: TraceJourney): StageFact[] {
  const routing = journey.routing;
  const facts: StageFact[] = [];

  switch (stage.id) {
    case 'client':
      facts.push(
        ...fact('Client', journey.clientType),
        ...fact('Device', shortDevice(journey.clientDeviceId), journey.clientDeviceId),
        ...fact('Asked for', journey.action),
        ...fact('Started by', journey.trigger),
      );
      break;
    case 'edge':
      facts.push(
        ...fact('Landed on', shortInstance(journey.instanceId), journey.instanceId),
        ...fact('Affinity slot', routing?.targetSlot ?? null),
      );
      break;
    case 'ingress':
      facts.push(
        ...fact('Pod', shortInstance(journey.instanceId), journey.instanceId),
        ...fact('Action', journey.action),
        ...fact('Round trip', ms(spanNamed(stage, 'response_sent')?.latencyMs ?? null)),
      );
      break;
    case 'core':
      facts.push(
        ...fact('Auth', stepDetail(stage, 'auth')),
        ...fact('Resolved', (stepDetail(stage, 'home_lookup') ?? '').replace(/^device=/, '') || null),
      );
      break;
    case 'routing':
      facts.push(
        ...fact('Mode', journey.routingMode),
        ...fact('Decision', stepDetail(stage, 'route_decision')),
        ...fact(
          'Target',
          shortInstance(routing?.targetInstance ?? null) ?? routing?.targetSlot ?? null,
          routing?.targetInstance ?? null,
        ),
        ...(routing?.retried ? [{ label: 'Retried', value: 'yes' }] : []),
      );
      break;
    case 'peer':
      facts.push(
        ...fact('From', shortInstance(routing?.sourceInstance ?? journey.instanceId),
          routing?.sourceInstance ?? journey.instanceId),
        ...fact('To', shortInstance(routing?.targetInstance ?? null) ?? routing?.targetSlot ?? null,
          routing?.targetInstance ?? null),
      );
      break;
    case 'relay_socket':
      facts.push(
        ...fact('Relay', shortDevice(journey.relayDeviceId), journey.relayDeviceId),
        ...fact('Round trip', ms(stage.measuredMs)),
        ...fact('Queued for', ms(stepDetailMs(stage, 'lock_acquire'))),
      );
      break;
    case 'homekit':
      facts.push(...fact('HomeKit call', ms(stage.measuredMs)));
      break;
    default:
      break;
  }

  // Whatever else the spans measured, said once and only when it is real.
  const failed = stage.spans.find((s) => s.success === false);
  if (failed) facts.push({ label: 'Result', value: 'failed' });

  return facts;
}

/** `lock_acquire` and friends record their cost inside the step detail text. */
function stepDetailMs(stage: Stage, name: string): number | null {
  const detail = stepDetail(stage, name);
  const match = detail?.match(/(\d+(?:\.\d+)?)\s*ms/);
  return match ? Number(match[1]) : null;
}

/**
 * Which machine this actually was.
 *
 * The place cards say "Your Mac" and "homecast.cloud", which is the right
 * headline but tells you nothing about the request in front of you. This is the
 * concrete identity underneath: the client that asked, the pod that took it,
 * the relay it reached. Null where the trace never names one — the home, in
 * particular, is only ever known by the accessory it touched.
 */
export function placeIdentity(place: PlaceId, journey: TraceJourney): string | null {
  switch (place) {
    case 'client':
      return shortDevice(journey.clientDeviceId) ?? journey.clientType;
    case 'cloud':
      return shortInstance(journey.instanceId);
    case 'relay':
      return shortDevice(journey.relayDeviceId);
    default:
      return null;
  }
}
