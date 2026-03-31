import { useState, useEffect, useCallback, useMemo } from 'react';
import { HomeKit } from '@/native/homekit-bridge';
import type { RelayLogEntry } from '@/native/homekit-bridge';

export interface MetricBucket {
  timestamp: number;
  requests: number;
  responses: number;
  errors: number;
  avgDurationMs: number;
  maxDurationMs: number;
}

interface RelayMetricsSummary {
  totalCount: number;
  errorCount: number;
  avgDurationMs: number;
}

interface UseRelayMetricsResult {
  logs: RelayLogEntry[];
  buckets: MetricBucket[];
  summary: RelayMetricsSummary;
  clear: () => void;
  loading: boolean;
}

const POLL_INTERVAL = 3000;
const BUCKET_INTERVAL_MS = 10000;

/**
 * Parse "HH:mm:ss.SSS" time string into a timestamp (ms) for today.
 */
function parseTimeString(timeStr: string): number {
  const parts = timeStr.split(':');
  if (parts.length < 3) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const secParts = parts[2].split('.');
  const seconds = parseInt(secParts[0], 10);
  const ms = secParts[1] ? parseInt(secParts[1], 10) : 0;

  const d = new Date();
  d.setHours(hours, minutes, seconds, ms);
  return d.getTime();
}

function bucketize(logs: RelayLogEntry[]): MetricBucket[] {
  if (logs.length === 0) return [];

  const timestamps = logs.map((l) => parseTimeString(l.timestamp));
  const validLogs = logs.filter((_, i) => timestamps[i] > 0);
  const validTimestamps = timestamps.filter((t) => t > 0);
  if (validLogs.length === 0) return [];

  const minTime = Math.min(...validTimestamps);
  const maxTime = Math.max(...validTimestamps);

  const bucketStart = Math.floor(minTime / BUCKET_INTERVAL_MS) * BUCKET_INTERVAL_MS;
  const bucketEnd = Math.ceil(maxTime / BUCKET_INTERVAL_MS) * BUCKET_INTERVAL_MS;

  // Create empty buckets
  const bucketMap = new Map<number, RelayLogEntry[]>();
  for (let t = bucketStart; t <= bucketEnd; t += BUCKET_INTERVAL_MS) {
    bucketMap.set(t, []);
  }

  // Assign logs to buckets
  for (let i = 0; i < validLogs.length; i++) {
    const key = Math.floor(validTimestamps[i] / BUCKET_INTERVAL_MS) * BUCKET_INTERVAL_MS;
    bucketMap.get(key)?.push(validLogs[i]);
  }

  const buckets: MetricBucket[] = [];
  for (const [timestamp, entries] of bucketMap) {
    const requests = entries.filter((e) => e.direction === 'REQ').length;
    const responses = entries.filter((e) => e.direction === 'RESP').length;
    const errors = entries.filter((e) => !!e.error).length;
    const durations = entries
      .filter((e) => e.durationMs != null && e.durationMs > 0)
      .map((e) => e.durationMs!);
    const avgDurationMs =
      durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    const maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;

    buckets.push({ timestamp, requests, responses, errors, avgDurationMs, maxDurationMs });
  }

  return buckets;
}

export function useRelayMetrics(): UseRelayMetricsResult {
  const [logs, setLogs] = useState<RelayLogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchLogs = useCallback(async () => {
    try {
      const entries = await HomeKit.getRelayLogs();
      setLogs(entries);
    } catch {
      // Bridge not available (browser mode) - leave empty
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const buckets = useMemo(() => bucketize(logs), [logs]);

  const summary = useMemo<RelayMetricsSummary>(() => {
    if (logs.length === 0) {
      return { totalCount: 0, errorCount: 0, avgDurationMs: 0 };
    }
    const errorCount = logs.filter((e) => !!e.error).length;
    const withDuration = logs.filter((e) => e.durationMs != null && e.durationMs > 0);
    const avgDurationMs =
      withDuration.length > 0
        ? Math.round(
            withDuration.reduce((sum, e) => sum + e.durationMs!, 0) / withDuration.length
          )
        : 0;
    return { totalCount: logs.length, errorCount, avgDurationMs };
  }, [logs]);

  const clear = useCallback(async () => {
    try {
      await HomeKit.clearRelayLogs();
      setLogs([]);
    } catch {
      // ignore
    }
  }, []);

  return { logs, buckets, summary, clear, loading };
}
