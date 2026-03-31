/**
 * Client-side log capture for the managed relay dashboard.
 * Captures WebSocket messages, GraphQL operations, and JS errors
 * in a circular buffer for display in the Browser tab.
 */

export interface BrowserLogEntry {
  id: number;
  timestamp: number;
  type: 'WS' | 'GQL' | 'ERR' | 'LOG';
  severity: 'info' | 'warn' | 'error';
  direction?: '→' | '←';
  summary: string;
  details?: string;
}

type Listener = () => void;

const MAX_ENTRIES = 500;
let nextId = 1;

class BrowserLogger {
  private entries: BrowserLogEntry[] = [];
  private listeners: Set<Listener> = new Set();
  private installed = false;

  install() {
    if (this.installed) return;
    this.installed = true;

    // Capture unhandled errors
    window.addEventListener('error', (e) => {
      this.add({
        type: 'ERR',
        severity: 'error',
        summary: e.message || 'Uncaught error',
        details: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : undefined,
      });
    });

    window.addEventListener('unhandledrejection', (e) => {
      const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
      this.add({
        type: 'ERR',
        severity: 'error',
        summary: `Unhandled rejection: ${msg}`,
      });
    });

    // Intercept console.error and console.warn
    const origError = console.error;
    const origWarn = console.warn;

    console.error = (...args: unknown[]) => {
      this.add({
        type: 'LOG',
        severity: 'error',
        summary: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 200),
      });
      origError.apply(console, args);
    };

    console.warn = (...args: unknown[]) => {
      this.add({
        type: 'LOG',
        severity: 'warn',
        summary: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ').slice(0, 200),
      });
      origWarn.apply(console, args);
    };
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
    this.notify();
  }

  /** Log an outgoing WebSocket message */
  logWsSend(type: string, details?: string) {
    this.add({ type: 'WS', severity: 'info', direction: '→', summary: type, details });
  }

  /** Log an incoming WebSocket message */
  logWsReceive(type: string, details?: string) {
    this.add({ type: 'WS', severity: 'info', direction: '←', summary: type, details });
  }

  /** Log a GraphQL operation */
  logGql(operation: string, details?: string, severity: 'info' | 'warn' | 'error' = 'info') {
    this.add({ type: 'GQL', severity, summary: operation, details });
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
      try { listener(); } catch {}
    }
  }
}

export const browserLogger = new BrowserLogger();
