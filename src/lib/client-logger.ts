/**
 * Client-side logger that sends logs to the server for GCP Cloud Logging.
 *
 * Usage:
 *   import { clientLogger } from '@/lib/client-logger';
 *
 *   clientLogger.info('User clicked button', { action: 'button_click' });
 *   clientLogger.error('Failed to load data', { error: 'Network error' });
 */

import { apolloClient } from './apollo';
import { gql } from '@apollo/client/core';
import { getClientType, generateTraceId } from './tracing';

const LOG_MUTATION = gql`
  mutation ClientLog(
    $source: String!
    $level: String!
    $message: String!
    $traceId: String
    $spanName: String
    $action: String
    $accessoryId: String
    $deviceId: String
    $error: String
    $latencyMs: Int
    $metadata: String
  ) {
    log(
      source: $source
      level: $level
      message: $message
      traceId: $traceId
      spanName: $spanName
      action: $action
      accessoryId: $accessoryId
      deviceId: $deviceId
      error: $error
      latencyMs: $latencyMs
      metadata: $metadata
    ) {
      success
      error
    }
  }
`;

interface LogOptions {
  traceId?: string;
  spanName?: string;
  action?: string;
  accessoryId?: string;
  deviceId?: string;
  error?: string;
  latencyMs?: number;
  metadata?: Record<string, unknown>;
}

type LogLevel = 'debug' | 'info' | 'warning' | 'error';

// Queue for batching logs
let logQueue: Array<{
  level: LogLevel;
  message: string;
  options: LogOptions;
  timestamp: string;
}> = [];

let flushTimeout: ReturnType<typeof setTimeout> | null = null;
const FLUSH_DELAY_MS = 500;
const MAX_QUEUE_SIZE = 20;

async function flushLogs() {
  if (logQueue.length === 0) return;

  const logsToSend = [...logQueue];
  logQueue = [];

  const source = getClientType();

  // Send logs in parallel (fire and forget)
  for (const log of logsToSend) {
    try {
      await apolloClient.mutate({
        mutation: LOG_MUTATION,
        variables: {
          source,
          level: log.level,
          message: log.message,
          traceId: log.options.traceId,
          spanName: log.options.spanName,
          action: log.options.action,
          accessoryId: log.options.accessoryId,
          deviceId: log.options.deviceId,
          error: log.options.error,
          latencyMs: log.options.latencyMs,
          metadata: log.options.metadata ? JSON.stringify(log.options.metadata) : null,
        },
      });
    } catch (e) {
      // Silently fail - we don't want logging failures to affect the app
      console.warn('[ClientLogger] Failed to send log:', e);
    }
  }
}

function scheduleFlush() {
  if (flushTimeout) {
    clearTimeout(flushTimeout);
  }

  if (logQueue.length >= MAX_QUEUE_SIZE) {
    // Flush immediately if queue is full
    flushLogs();
  } else {
    // Schedule flush after delay
    flushTimeout = setTimeout(flushLogs, FLUSH_DELAY_MS);
  }
}

function log(level: LogLevel, message: string, options: LogOptions = {}) {
  logQueue.push({
    level,
    message,
    options,
    timestamp: new Date().toISOString(),
  });
  scheduleFlush();
}

/**
 * Client logger for sending logs to GCP Cloud Logging via the server.
 */
export const clientLogger = {
  /**
   * Log a debug message.
   */
  debug(message: string, options?: LogOptions) {
    log('debug', message, options);
  },

  /**
   * Log an info message.
   */
  info(message: string, options?: LogOptions) {
    log('info', message, options);
  },

  /**
   * Log a warning message.
   */
  warning(message: string, options?: LogOptions) {
    log('warning', message, options);
  },

  /**
   * Log an error message.
   */
  error(message: string, options?: LogOptions) {
    log('error', message, options);
  },

  /**
   * Log a trace span (info level with span name).
   */
  traceSpan(spanName: string, message: string, traceId?: string, options?: Omit<LogOptions, 'spanName' | 'traceId'>) {
    log('info', message, {
      ...options,
      spanName,
      traceId: traceId || generateTraceId(),
    });
  },

  /**
   * Force flush any queued logs immediately.
   */
  flush() {
    if (flushTimeout) {
      clearTimeout(flushTimeout);
      flushTimeout = null;
    }
    return flushLogs();
  },
};

// Flush logs before page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    // Use sendBeacon for more reliable delivery on page unload
    // For now, just try to flush synchronously
    clientLogger.flush();
  });
}
