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
  /** ms from the first span in the trace. Null when nothing reported. */
  startMs: number | null;
  endMs: number | null;
  /** Spans attributed to this stage. */
  spans: TraceSpanInput[];
  /** Sub-steps, from the RequestTrace step list where one exists. */
  steps: StageStep[];
  error: string | null;
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

  const traceSpan = ordered.find((s) => s.spanName === 'request_trace');
  const trigger = traceSpan
    ? ((parsePayload(traceSpan.payload).trigger as string | undefined) ?? null)
    : ((parsePayload(ordered[0].payload).trigger as string | undefined) ?? null);

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

  for (const span of ordered) {
    if (span.spanName !== 'request_trace') continue;
    for (const step of stepsFromSpan(span)) {
      const stage = STEP_STAGE[step.name];
      if (!stage) continue;
      const list = stepsByStage.get(stage) ?? [];
      list.push(step);
      stepsByStage.set(stage, list);
    }
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
      // The edge is still real even with no telemetry — a request that reached
      // the server necessarily crossed it.
      status = def.id === 'edge' ? 'inferred' : 'not-reporting';
      reason = 'never-instrumented';
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

    return {
      ...def,
      status,
      reason,
      startMs: times.length ? Math.min(...times) : null,
      endMs: times.length ? Math.max(...times) : null,
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
    gaps,
    ok: !stages.some((s) => s.status === 'failed'),
  };
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
      return 'Not instrumented — inferred from surrounding spans';
    case 'not-on-this-path':
      return 'Not part of this request';
    default:
      return 'No data';
  }
}
