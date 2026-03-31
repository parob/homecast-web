/**
 * Request trace types for diagnostic error displays.
 *
 * The server attaches a `_trace` field to protocol messages that flows
 * through every hop of the stack (server → Pub/Sub → relay → response).
 * Each hop appends its own steps with timing information.
 */

export interface TraceStep {
  name: string;
  status: 'ok' | 'fail';
  ms: number | null;
  detail: string | null;
}

export interface TraceRouting {
  mode: 'local' | 'pubsub';
  sourceInstance: string | null;
  targetInstance: string | null;
  sourceSlot: string | null;
  targetSlot: string | null;
  retried: boolean;
}

export interface RequestTrace {
  id: string | null;
  totalMs: number;
  steps: TraceStep[];
  routing?: TraceRouting;
}

/** Friendly labels for trace step names */
export const STEP_LABELS: Record<string, string> = {
  received: 'Request received',
  auth: 'Permission check',
  home_lookup: 'Device lookup',
  session_lookup: 'Session lookup',
  route_decision: 'Route decision',
  pubsub_publish: 'Pub/Sub publish',
  remote_receive: 'Remote receive',
  lock_acquire: 'Lock acquire',
  relay_send: 'Send to relay',
  homekit_call: 'HomeKit call',
  relay_response: 'Relay response',
  sub_request: 'Sub-request',
};
