/**
 * Client-side trace spans.
 *
 * The server can see everything from the moment a request arrives to the moment
 * the relay answers. It cannot see what happened before that — how long the
 * client spent getting the request out, or how much of the round trip the user
 * actually waited through. These two spans close that gap, and they are the
 * only thing that makes the Client stage of the trace visualiser real rather
 * than "not reporting".
 *
 * Deliberately cheap and deliberately off by default. Emission is gated by
 * `activityLoggingEnabled()` (analytics consent + Developer Mode + Send activity
 * logs), and everything here is fire-and-forget — a span that fails to send must
 * never affect the request it was describing.
 */

import { activityLoggingEnabled } from './activity-logging';
import { browserLogger } from './browser-logger';
import { generateTraceId } from './tracing';

/** A trace id for one client-originated request. */
export function newTraceId(): string {
  return generateTraceId();
}

interface SpanFields {
  action: string;
  traceId: string;
  latencyMs?: number;
  success?: boolean;
  error?: string;
  transport?: string;
}

function emit(spanName: string, message: string, fields: SpanFields): void {
  if (!activityLoggingEnabled()) return;
  try {
    // Rides browserLogger, which already batches to /internal/logs and already
    // carries a trace id — the field existed and no call site ever set it.
    browserLogger.logInfo(message, {
      span_name: spanName,
      action: fields.action,
      latency_ms: fields.latencyMs,
      success: fields.success,
      error: fields.error,
      client_type: fields.transport,
    }, fields.traceId);
  } catch {
    // Telemetry must never break the thing it is measuring.
  }
}

/**
 * Wrap one client request in a span pair.
 *
 * Returns the trace id so the caller can put it on the wire — without that the
 * spans are correlatable to nothing and the exercise is pointless.
 */
export function traceClientRequest(action: string): {
  traceId: string;
  done: (outcome: { success: boolean; transport?: string; error?: string }) => void;
} {
  const traceId = newTraceId();
  const startedAt = Date.now();

  emit('client_sent', `${action} → server`, { action, traceId });

  return {
    traceId,
    done: ({ success, transport, error }) => {
      emit('client_received', `${action} ← server (${Date.now() - startedAt}ms)`, {
        action,
        traceId,
        latencyMs: Date.now() - startedAt,
        success,
        transport,
        error,
      });
    },
  };
}

/**
 * Relay-side spans.
 *
 * The relay is the one place that knows what HomeKit actually cost. The server
 * can only see the round trip to the relay and back; everything between — the
 * dispatch, the native bridge, Apple's own write — is inside this process and
 * has never reported anything. `homekit_call` already existed as a step on the
 * ephemeral `_trace` blob, but that blob is only ever looked at when a request
 * fails, so in practice the relay was silent.
 *
 * The trace id arrives on every request the server sends and had never been
 * read. These spans use it, which is what joins them to the rest of the journey
 * rather than leaving them as an unattached island.
 */
export function traceRelayRequest(action: string, traceId: string | undefined): {
  dispatched: () => void;
  done: (outcome: { success: boolean; error?: string }) => void;
} {
  const noop = { dispatched: () => {}, done: () => {} };
  if (!traceId || !activityLoggingEnabled()) return noop;

  const startedAt = Date.now();
  emit('relay_received', `${action} received by relay`, {
    action, traceId, transport: 'relay',
  });

  return {
    dispatched: () => {
      emit('relay_dispatch', `${action} → HomeKit`, {
        action,
        traceId,
        latencyMs: Date.now() - startedAt,
        transport: 'relay',
      });
    },
    done: ({ success, error }) => {
      emit('relay_responded', `${action} ← HomeKit (${Date.now() - startedAt}ms)`, {
        action,
        traceId,
        latencyMs: Date.now() - startedAt,
        success,
        error,
        transport: 'relay',
      });
    },
  };
}
