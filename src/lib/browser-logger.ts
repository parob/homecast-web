/**
 * Client-side log capture.
 *
 * Two jobs:
 *   1. Local ring buffer (display in the Diagnostics / Browser tab).
 *   2. Ship to the server via POST /internal/logs so ERROR/WARN entries
 *      land in Cloud Logging alongside server events, correlated by user_id.
 *
 * Shipping is opt-in per call (error/warn entries auto-flag themselves);
 * Community mode / shared view is a no-op because there's no cloud API.
 */

export interface BrowserLogEntry {
  id: number;
  timestamp: number;
  type: 'WS' | 'GQL' | 'ERR' | 'LOG';
  severity: 'info' | 'warn' | 'error';
  direction?: '→' | '←';
  summary: string;
  details?: string;
  /** Set when the entry should be shipped to the server on the next flush. */
  ship?: boolean;
  /** Optional trace_id to correlate with server logs. */
  traceId?: string;
}

type Listener = () => void;

const MAX_ENTRIES = 500;
let nextId = 1;

/** Stable per-tab session id so server-side logs can group entries from
 *  the same browser session without using user_id (which the server
 *  already has via Bearer auth). */
function getBrowserSessionId(): string {
  try {
    const key = 'homecast-browser-session';
    let v = sessionStorage.getItem(key);
    if (!v) {
      v = `web-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      sessionStorage.setItem(key, v);
    }
    return v;
  } catch {
    return `web-ephemeral-${Math.random().toString(36).slice(2, 10)}`;
  }
}

// Ship config — set by install() via shipOptions. Community mode skips.
interface ShipOptions {
  /** Returns the /internal/logs URL, or null if shipping should be disabled. */
  url: () => string | null;
  /** Returns the current user auth token, or null if not logged in. */
  token: () => string | null;
  /** Label sent as `source` on the server side. */
  source?: 'web' | 'mac' | 'web-vitals';
  /** Flush every N ms (default 30_000). */
  flushIntervalMs?: number;
  /** Max entries sent per batch (default 100). */
  batchSize?: number;
}

class BrowserLogger {
  private entries: BrowserLogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private installed = false;

  // Shipping
  private shipOpts: ShipOptions | null = null;
  private pending: Array<{
    level: string;
    message: string;
    timestamp: string;
    trace_id?: string;
    metadata?: Record<string, unknown>;
  }> = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private inFlight = false;
  private readonly sessionId = getBrowserSessionId();

  install(shipOpts?: ShipOptions) {
    if (this.installed) {
      // Allow updating ship opts after first install (e.g. once user logs in)
      if (shipOpts) this.configureShipping(shipOpts);
      return;
    }
    this.installed = true;

    // Capture unhandled errors
    window.addEventListener('error', (e) => {
      this.add({
        type: 'ERR',
        severity: 'error',
        summary: e.message || 'Uncaught error',
        details: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
        ship: true,
      });
      this.kickFlush();
    });

    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
      this.add({
        type: 'ERR',
        severity: 'error',
        summary: `Unhandled rejection: ${msg}`,
        ship: true,
      });
      this.kickFlush();
    });

    // Intercept console.error and console.warn
    const origError = console.error;
    const origWarn = console.warn;

    console.error = (...args: unknown[]) => {
      this.add({
        type: 'LOG',
        severity: 'error',
        summary: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 200),
        ship: true,
      });
      origError.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      this.add({
        type: 'LOG',
        severity: 'warn',
        summary: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 200),
        ship: true,
      });
      origWarn.apply(console, args);
    };

    // Flush on page-hide / unload using sendBeacon so in-flight logs don't get lost.
    window.addEventListener('pagehide', () => { void this.flushNow({ beacon: true }); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void this.flushNow({ beacon: true });
    });

    if (shipOpts) this.configureShipping(shipOpts);
  }

  /** Enable server-side shipping. Safe to call multiple times. */
  configureShipping(opts: ShipOptions) {
    this.shipOpts = opts;
    const interval = opts.flushIntervalMs ?? 30_000;
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.flushTimer = setInterval(() => { void this.flushNow(); }, interval);
  }

  add(entry: Omit<BrowserLogEntry, 'id' | 'timestamp'>) {
    const full: BrowserLogEntry = {
      ...entry,
      id: nextId++,
      timestamp: Date.now(),
    };
    this.entries.push(full);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries = this.entries.slice(-MAX_ENTRIES);
    }
    if (entry.ship) {
      this.pending.push({
        level: entry.severity === 'error' ? 'ERROR' : entry.severity === 'warn' ? 'WARNING' : 'INFO',
        message: entry.summary + (entry.details ? ` | ${entry.details}` : ''),
        timestamp: new Date(full.timestamp).toISOString(),
        trace_id: entry.traceId,
        metadata: { type: entry.type, direction: entry.direction },
      });
    }
    this.notify();
  }

  /** Ship an INFO entry with metadata — for web-vitals and other telemetry
   *  that isn't an error but IS worth sending to the server. */
  logInfo(message: string, metadata?: Record<string, unknown>, traceId?: string) {
    this.add({
      type: 'LOG',
      severity: 'info',
      summary: message.slice(0, 200),
      details: metadata ? JSON.stringify(metadata).slice(0, 500) : undefined,
      ship: true,
      traceId,
    });
    const last = this.pending[this.pending.length - 1];
    if (last && metadata) {
      last.metadata = { ...(last.metadata || {}), ...metadata };
    }
    if (traceId && last) last.trace_id = traceId;
  }

  /** Explicit error logging — prefer this over raw console.error for
   *  catch blocks where you want structured metadata on the server side. */
  logError(message: string, metadata?: Record<string, unknown>, traceId?: string) {
    this.add({
      type: 'ERR',
      severity: 'error',
      summary: message.slice(0, 200),
      details: metadata ? JSON.stringify(metadata).slice(0, 500) : undefined,
      ship: true,
      traceId,
    });
    if (metadata || traceId) {
      // Replace the plain metadata-less entry pushed by add() with a richer one
      const last = this.pending[this.pending.length - 1];
      if (last && last.message.startsWith(message.slice(0, 200))) {
        last.metadata = { ...(last.metadata || {}), ...(metadata || {}) };
        last.trace_id = traceId || last.trace_id;
      }
    }
    this.kickFlush();
  }

  /** Log an outgoing WebSocket message */
  logWsSend(type: string, details?: string) {
    this.add({ type: 'WS', severity: 'info', direction: '→', summary: type, details });
  }

  /** Log an incoming WebSocket message */
  logWsReceive(type: string, details?: string) {
    this.add({ type: 'WS', severity: 'info', direction: '←', summary: type, details });
  }

  /** Log a connection state transition — always shipped so disconnects
   *  appear in Cloud Logging alongside server-side relay lifecycle events. */
  logConnection(state: string, details?: string) {
    this.add({
      type: 'WS',
      severity: state === 'disconnected' ? 'warn' : 'info',
      summary: `connection: ${state}`,
      details,
      ship: true,
    });
    this.kickFlush();
  }

  /** Log a GraphQL operation */
  logGql(operation: string, details?: string, severity: 'info' | 'warn' | 'error' = 'info') {
    this.add({
      type: 'GQL',
      severity,
      summary: operation,
      details,
      ship: severity !== 'info',
    });
    if (severity !== 'info') this.kickFlush();
  }

  getEntries(): BrowserLogEntry[] {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
    this.notify();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try { listener(); } catch { /* noop */ }
    }
  }

  private kickFlush() {
    // Debounce: if there's no flush in-flight and we have ≥10 pending, flush eagerly
    if (!this.inFlight && this.pending.length >= 10) {
      void this.flushNow();
    }
  }

  /** Flush pending entries to the server. Safe to call anytime. */
  async flushNow(opts?: { beacon?: boolean }): Promise<void> {
    const ship = this.shipOpts;
    if (!ship || this.pending.length === 0 || this.inFlight) return;
    const url = ship.url();
    const token = ship.token();
    if (!url || !token) return;

    const batchSize = ship.batchSize ?? 100;
    const batch = this.pending.splice(0, batchSize);
    const body = JSON.stringify({
      source: ship.source ?? 'web',
      session_id: this.sessionId,
      entries: batch,
    });

    // pagehide / visibilitychange → sendBeacon (fire-and-forget, survives nav).
    // Beacon doesn't support custom headers, so we stuff the token in a
    // URL query param. The endpoint still enforces auth.
    if (opts?.beacon && 'sendBeacon' in navigator) {
      try {
        const beaconUrl = `${url}?access_token=${encodeURIComponent(token)}`;
        navigator.sendBeacon(beaconUrl, new Blob([body], { type: 'application/json' }));
      } catch {
        // If beacon fails there's no recovery path — we're unloading.
      }
      return;
    }

    this.inFlight = true;
    try {
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body,
        keepalive: true,
      });
    } catch {
      // Re-queue the batch to try again next tick. Cap pending at 2000 to
      // avoid unbounded growth if the endpoint stays down.
      if (this.pending.length < 2000) this.pending.unshift(...batch);
    } finally {
      this.inFlight = false;
    }
  }
}

export const browserLogger = new BrowserLogger();
